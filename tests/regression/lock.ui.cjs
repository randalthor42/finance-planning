// Browser tests for the app lock, encryption at rest, hidden amounts and bill reminders.
// Part 1 opens the built file (file://), as people do. Part 2 serves it from localhost, where WebAuthn works, with
// Chrome's virtual authenticator standing in for a fingerprint. Run with: npm run test:ui (sample plan only).
const path = require('path');
const fs = require('fs');
const http = require('http');
const { chromium } = require('playwright');
const FILE = path.resolve(__dirname, '../../dist-test/index.html');

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const errs = [];
  let passed = 0;
  const ok = (c, m) => {
    if (!c) errs.push('FAIL ' + m);
    else {
      passed++;
      console.log('ok', m);
    }
  };
  const T0 = new Date('2026-11-05T10:00:00').getTime();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
  // a stand-in for the system's notifications: allowed, and every one is recorded
  await ctx.addInitScript(() => {
    window.__notes = [];
    window.Notification = class {
      static permission = 'granted';
      static requestPermission() {
        return Promise.resolve('granted');
      }
      constructor(title, options) {
        window.__notes.push({ title, body: options && options.body });
      }
      close() {}
    };
  });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(8000);
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  let now = T0;
  const later = ms => pg.clock.setFixedTime((now += ms));
  await pg.clock.setFixedTime(T0);
  await pg.goto('file://' + FILE);
  await pg.getByText('Look around with a sample plan').click();
  const dialog = () => pg.locator('dialog.modal[open]').last();
  const lockScreen = pg.locator('dialog.lockscreen[open]');
  const lastLog = () => pg.evaluate(() => Store.db.log.at(-1).text);
  const unlockWith = async pin => {
    await lockScreen.locator('input.lock-pin').fill(pin);
    await lockScreen.getByRole('button', { name: 'Unlock' }).click();
    await pg.waitForFunction(() => !document.querySelector('dialog.lockscreen[open]') || document.querySelector('.lock-msg').textContent !== 'Checking…');
  };
  const setVisibility = (hidden) =>
    pg.evaluate(h => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);

  /* ---------- the settings say what a PIN is ---------- */
  await pg.evaluate(() => App.go('settings', { stab: 'security' }));
  const main = () => pg.locator('main').textContent();
  ok((await main()).includes('A PIN is a screen lock only: it does not encrypt the data stored in this browser.'), 'the settings say a PIN is a screen lock only and does not encrypt the data');
  ok((await main()).includes('Off: anyone who can open this browser can open your plans.'), 'the lock is off at first');

  /* ---------- set a PIN ---------- */
  await pg.getByRole('button', { name: 'Set a PIN' }).click();
  await dialog().locator('#pin-new').fill('4821');
  await dialog().locator('#pin-again').fill('4812');
  await dialog().getByRole('button', { name: 'Save' }).click();
  ok((await dialog().locator('.form-err').textContent()) === 'The two PINs are not the same.', 'the PIN is typed twice, and must match');
  await dialog().locator('#pin-new').fill('48');
  await dialog().locator('#pin-again').fill('48');
  await dialog().getByRole('button', { name: 'Save' }).click();
  ok((await dialog().locator('.form-err').textContent()) === 'A PIN is 4 to 12 digits.', 'a PIN is 4 to 12 digits');
  await dialog().locator('#pin-new').fill('4821');
  await dialog().locator('#pin-again').fill('4821');
  await dialog().getByRole('button', { name: 'Save' }).click();
  await pg.waitForFunction(() => Lock.enabled());
  const stored = await pg.evaluate(() => localStorage.getItem('runway.lock.v1'));
  ok(!stored.includes('4821') && /"salt":"[^"]{20,}"/.test(stored) && /"hash":"[^"]{40,}"/.test(stored), 'the PIN is stored as a salted hash only');
  ok((await lastLog()) === 'App lock turned on', 'and written in the activity log');

  /* ---------- lock on open ---------- */
  // "Lock after: 1 minute" is the default: the app is in use until the tab closes, so reopening sooner stays open
  await pg.reload();
  ok((await lockScreen.count()) === 0, 'reopened within a minute: still open');
  await pg.evaluate(() => Lock.setTimeout(0, 'Immediately'));
  await pg.reload();
  await lockScreen.waitFor();
  ok((await lockScreen.count()) === 1, 'opened again: locked');
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('app')).visibility === 'hidden'), 'nothing of the app shows behind the lock');
  await pg.keyboard.press('Escape');
  ok((await lockScreen.count()) === 1, 'Esc does not close it');
  await pg.keyboard.press('Control+k');
  ok((await pg.locator('dialog.modal[open]').count()) === 0, 'shortcuts do nothing while locked');

  /* ---------- the attempt limit ---------- */
  await unlockWith('0000');
  ok((await lockScreen.locator('.lock-msg').textContent()) === 'Wrong PIN. 4 tries left before a pause.', 'a wrong PIN says how many tries are left');
  for (let i = 2; i <= 4; i++) {
    await unlockWith('0000');
  }
  ok((await lockScreen.locator('.lock-msg').textContent()) === 'Wrong PIN. 1 try left before a pause.', 'counting down to the last one');
  await unlockWith('0000');
  ok((await lockScreen.locator('.lock-msg').textContent()).startsWith('Too many wrong PINs. Try again in 30'), 'the fifth wrong PIN: a 30 second pause');
  ok(await lockScreen.locator('input.lock-pin').isDisabled(), 'and the field waits');
  await pg.reload();
  await lockScreen.waitFor();
  ok(await lockScreen.locator('input.lock-pin').isDisabled(), 'a reload does not end the pause');
  await later(31000);
  await pg.waitForFunction(() => !document.querySelector('input.lock-pin').disabled, null, { timeout: 3000 });
  ok(true, 'after 30 seconds the PIN can be tried again');
  await unlockWith('4821');
  ok((await lockScreen.count()) === 0, 'the right PIN unlocks');
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('app')).visibility === 'visible'), 'and the app shows');
  ok((await lastLog()) === '5 wrong PINs before the app was unlocked', 'the wrong tries are written in the activity log');
  ok((await pg.evaluate(() => JSON.parse(localStorage.getItem('runway.lock.v1')).fails)) === 0, 'and the count starts again');

  /* ---------- lock after time in the background ---------- */
  await pg.evaluate(() => Lock.setTimeout(60, '1 minute'));
  await setVisibility(true);
  await later(50000);
  await setVisibility(false);
  ok((await lockScreen.count()) === 0, 'back after 50 seconds, with "1 minute": still open');
  await setVisibility(true);
  await later(61000);
  await setVisibility(false);
  ok((await lockScreen.count()) === 1, 'back after 61 seconds: locked');
  await unlockWith('4821');
  await pg.evaluate(() => Lock.setTimeout(0, 'Immediately'));
  await setVisibility(true);
  ok((await lockScreen.count()) === 1, '"Immediately": locked as soon as it goes to the background (the app switcher shows the lock)');
  await setVisibility(false);
  await unlockWith('4821');

  /* ---------- hide amounts until tapped ---------- */
  await pg.evaluate(() => Lock.setTimeout(3600, '1 hour'));
  await pg.evaluate(() => Store.setPref('hideAmounts', true, 'Hide amounts: on'));
  await pg.evaluate(() => App.go('overview'));
  const kpi = pg.locator('.kpi .v').first();
  ok((await kpi.textContent()) === '•••', 'amounts are hidden');
  ok(!(await pg.locator('#main').textContent()).match(/\d[\d.,]*\s?€|€\s?\d/), 'no amount anywhere on the Overview');
  await kpi.click();
  ok((await pg.locator('.kpi .v').first().textContent()).includes('€'), 'a tap on one shows them');
  ok((await pg.locator('dialog.modal[open]').count()) === 0, 'and the tap does nothing else');
  await setVisibility(true);
  await setVisibility(false);
  ok((await pg.locator('.kpi .v').first().textContent()) === '•••', 'back from the background: hidden again');
  await pg.setViewportSize({ width: 390, height: 844 });
  const top = pg.locator('#top');
  ok((await top.getByRole('button', { name: 'Show amounts' }).isVisible()) && (await top.getByRole('button', { name: 'Lock now' }).isVisible()), 'on a phone the top bar has the eye and the lock');
  ok(!(await top.textContent()).includes('null'), 'and no stray text');
  await pg.setViewportSize({ width: 1366, height: 900 });
  await pg.locator('#side').getByRole('button', { name: 'Show amounts' }).click();
  ok((await pg.locator('.kpi .v').first().textContent()).includes('€'), 'the eye button shows them too (keyboard, screen readers)');
  await pg.evaluate(() => {
    UI.revealed = false;
    Actions.setEnd(Store.proj.months[0].key, 1234);
  });
  ok((await pg.locator('#toasts').textContent()).includes('•••'), 'a notification in the app hides the amount too');
  ok((await lastLog()).includes('1.234') || (await lastLog()).includes('1,234'), 'the activity log keeps the real amount');
  await pg.evaluate(() => Store.undo());
  await pg.evaluate(() => Store.setPref('hideAmounts', false, 'Hide amounts: off'));
  ok(!(await pg.locator('#top').textContent()).includes('null'), 'with amounts shown, the top bar has no eye (and no stray text)');

  /* ---------- encryption at rest ---------- */
  await pg.evaluate(() => App.go('settings', { stab: 'security' }));
  await pg.locator('.row', { hasText: 'Encrypt the data on this device' }).locator('.switch').click();
  await dialog().locator('#pin-now').fill('1111');
  await dialog().getByRole('button', { name: 'Confirm' }).click();
  await dialog().locator('.form-err', { hasText: /./ }).waitFor();
  ok((await dialog().locator('.form-err').textContent()) === 'That is not your PIN.', 'encrypting asks for the PIN');
  await dialog().locator('#pin-now').fill('4821');
  await dialog().getByRole('button', { name: 'Confirm' }).click();
  await pg.waitForFunction(() => Store.adapter.sealed(), null, { timeout: 10000 });
  const raw = await pg.evaluate(() => localStorage.getItem('runway.db.v1'));
  ok(!raw.includes('Sample plan') && !raw.includes('Rent') && raw.includes('"runway":"sealed"'), 'the stored data is encrypted: no plan name, no bill in it');
  ok((await main()).includes('Your data on this device is encrypted with a key made from your PIN.'), 'the settings say it is encrypted, and what forgetting the PIN means');
  await pg.evaluate(() => Actions.settings('Encrypted plan', {}));
  await pg.evaluate(() => Store.adapter.settled());
  await pg.reload();
  await lockScreen.waitFor();
  ok((await lockScreen.textContent()).includes('Enter your PIN to open your encrypted data.'), 'opened again: the PIN opens the encrypted data');
  await unlockWith('4821');
  await pg.waitForSelector('#main h1');
  ok((await pg.evaluate(() => Store.plan.name)) === 'Encrypted plan', 'and the last change is there');
  await pg.evaluate(() => App.go('settings', { stab: 'security' }));
  await pg.locator('.row', { hasText: 'Encrypt the data on this device' }).locator('.switch').click();
  await dialog().locator('#pin-now').fill('4821');
  await dialog().getByRole('button', { name: 'Confirm' }).click();
  await pg.waitForFunction(() => !Store.adapter.sealed(), null, { timeout: 10000 });
  ok((await pg.evaluate(() => localStorage.getItem('runway.db.v1'))).includes('Encrypted plan'), 'turned off: stored as before');

  /* ---------- bill reminders ---------- */
  await pg.evaluate(() => App.go('settings', { stab: 'reminders' }));
  ok((await main()).includes('Reminders come while it is open in a browser tab'), 'the settings say when reminders can come');
  await pg.locator('.row', { hasText: 'Remind me of payments' }).locator('.switch').click();
  await pg.locator('.row', { hasText: 'Also as system notifications' }).locator('.switch').click();
  await pg.waitForFunction(() => Store.db.reminders.notify);
  ok((await lastLog()) === 'System notifications: on', 'turning them on is written down');
  await pg.evaluate(() => {
    localStorage.removeItem('runway.reminded.v1');
    App.go('overview');
    App.tick();
  });
  const notes = await pg.evaluate(() => window.__notes);
  ok(notes.length === 1 && notes[0].title === 'Runway' && /^\d+ payments? due soon\. Open Runway to see them\.$/.test(notes[0].body), 'with the lock on, a system notification names no bill and no amount: ' + JSON.stringify(notes[0]));
  await pg.evaluate(() => App.tick());
  ok((await pg.evaluate(() => window.__notes.length)) === 1, 'each payment is told once');
  const dueCard = pg.locator('.card').filter({ has: pg.locator('h2', { hasText: 'Due soon' }) });
  ok((await dueCard.locator('.row').count()) >= 1, 'the Overview lists what is due');
  const firstDue = await dueCard.locator('.row .t').first().textContent();
  await dueCard.locator('.row').first().getByRole('button', { name: /Mark as paid|Paid/ }).click();
  ok(!(await dueCard.locator('.row .t').allTextContents()).includes(firstDue), 'marked as paid, it is not due any more');
  await pg.evaluate(() => {
    Lock.cfg.pin = null; // as if there were no lock: the notification may say what is due
    localStorage.removeItem('runway.reminded.v1');
    App.tick();
  });
  const named = await pg.evaluate(() => window.__notes.at(-1));
  ok(/ is due | was due /.test(named.body) && named.title !== 'Runway', 'without lock or hidden amounts it says what is due: ' + named.body.split('\n')[0]);

  /* ---------- forgot the PIN ---------- */
  await pg.evaluate(() => {
    Lock.reload(); // the stored lock settings again (the PIN was only hidden in memory above)
    Lock.lock();
  });
  await lockScreen.locator('summary', { hasText: 'Forgot your PIN?' }).click();
  const erase = lockScreen.getByRole('button', { name: 'Erase the data in this browser' });
  ok(await erase.isDisabled(), 'forgot the PIN: erasing waits for the tick that says every plan is deleted');
  await lockScreen.getByText('I understand that every plan in this browser is deleted.').click();
  await Promise.all([pg.waitForEvent('load'), erase.click()]);
  await pg.getByText('Look around with a sample plan').waitFor();
  ok((await pg.evaluate(() => [localStorage.getItem('runway.lock.v1'), Store.db && Store.db.plans.length])).every(x => !x), 'then the data and the lock are gone, and Runway starts again');
  await ctx.close();

  /* ---------- biometrics (WebAuthn) from a web address ---------- */
  const html = fs.readFileSync(FILE);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://localhost:${server.address().port}/`;
  const ctx2 = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.setDefaultTimeout(8000);
  p2.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const cdp = await ctx2.newCDPSession(p2);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await p2.goto(url);
  await p2.getByText('Look around with a sample plan').click();
  await p2.evaluate(() => Lock.enable('4821'));
  await p2.evaluate(() => App.go('settings', { stab: 'security' }));
  const bio = p2.locator('.row', { hasText: 'Fingerprint or face' });
  await p2.waitForFunction(() => !document.querySelector('main').textContent.includes('Checking this device'));
  ok(!(await bio.locator('input').isDisabled()), 'from a web address, with a fingerprint reader, biometric unlock can be turned on');
  await bio.locator('.switch').click();
  await p2.waitForFunction(() => !!Lock.cfg.bio, null, { timeout: 10000 });
  ok((await p2.evaluate(() => Lock.cfg.bio.alg)) === -7, 'a credential is made on the device, its public key kept');
  await p2.evaluate(() => Lock.lock());
  const ls = p2.locator('dialog.lockscreen[open]');
  await ls.getByRole('button', { name: 'Use fingerprint or face' }).click();
  await p2.waitForFunction(() => !Lock.locked, null, { timeout: 10000 });
  ok(true, 'a fingerprint unlocks (the signature is checked against the kept key)');
  // the person is not recognised: 5 failures, then only the PIN
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await p2.evaluate(() => Lock.lock());
  for (let i = 0; i < 5; i++) {
    await ls.getByRole('button', { name: 'Use fingerprint or face' }).click();
    await p2.waitForFunction(n => Lock.cfg.bioFails >= n, i + 1, { timeout: 10000 });
  }
  ok(await ls.getByRole('button', { name: 'Use fingerprint or face' }).isHidden(), 'after 5 failed tries, the fingerprint button goes');
  ok((await ls.locator('.lock-msg').textContent()) === 'Too many failed tries with fingerprint or face. Use your PIN.', 'and the PIN is asked for');
  await ls.locator('input.lock-pin').fill('4821');
  await ls.getByRole('button', { name: 'Unlock' }).click();
  await p2.waitForFunction(() => !Lock.locked);
  ok((await p2.evaluate(() => Lock.cfg.bioFails)) === 0, 'the PIN unlocks and gives biometrics back');
  await ctx2.close();
  server.close();

  console.log(errs.length ? errs.join('\n') : `LOCK UI OK (${passed} checks)`);
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
