/**
 * @file Browser test of Google Drive sync (state/driveSync.js) with two devices: a computer (A) and a phone (B).
 * Run with: npm run test:drive
 *
 * Each device is its own browser context (its own localStorage and IndexedDB), like two devices signed in to one
 * Google account. Google is played by this script: Playwright's network routing answers Google's sign-in script
 * (accounts.google.com/gsi/client, a stand-in that hands out tokens) and the Drive API (www.googleapis.com) with the
 * fake Drive of the unit tests (tests/unit/helpers/fakeDrive.js). Everything else is the real app, test build.
 *
 * After each change it checks that both devices and the cloud file hold exactly the same plans (what "perfectly"
 * means here): the plan texts of A, of B and of the file, compared one by one.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '../../dist-test');
const SHOTS = path.join(__dirname, 'shots');
const PASSPHRASE = 'drive-test-' + Math.random().toString(36).slice(2);
let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failed++;
};

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : req.url.slice(1));
    fs.readFile(file, (err, data) => {
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/json';
      res.writeHead(err ? 404 : 200, { 'content-type': type });
      res.end(err ? 'not found' : data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Google's sign-in library, as far as the app uses it (the token model). */
const GIS_STUB = `
window.google = { accounts: { oauth2: {
  initTokenClient(config) {
    return {
      requestAccessToken(options) {
        window.__fakeGoogle(options || {}).then(r =>
          r.error ? config.error_callback && config.error_callback({ type: r.error }) : config.callback(r));
      },
    };
  },
  hasGrantedAllScopes: () => true,
} } };`;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type, If-Match',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE',
  'access-control-expose-headers': 'ETag',
};

(async () => {
  const { FakeDrive } = await import('../unit/helpers/fakeDrive.js');
  const drive = new FakeDrive();
  const server = await serve();
  const URL = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  const google = { refuse: false, signIns: 0, gisLoads: 0 };
  fs.mkdirSync(SHOTS, { recursive: true });

  async function device(name, contextOptions) {
    const ctx = await browser.newContext(contextOptions);
    await ctx.exposeFunction('__fakeGoogle', () => {
      if (google.refuse) return { error: 'popup_closed' };
      google.signIns++;
      return { access_token: drive.grant(), expires_in: 3599, scope: 'https://www.googleapis.com/auth/drive.appdata' };
    });
    await ctx.route('https://accounts.google.com/gsi/client', route => {
      google.gisLoads++;
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB });
    });
    await ctx.route('https://www.googleapis.com/**', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      let res;
      try {
        res = await drive.fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postData() });
      } catch (e) {
        return route.abort('internetdisconnected'); // drive.offline
      }
      const headers = { ...CORS, 'content-type': res.headers.get('content-type') || 'application/json' };
      if (res.headers.get('etag')) headers.etag = res.headers.get('etag');
      return route.fulfill({ status: res.status, headers, body: await res.text() });
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', e => errors.push(`${name} PAGEERR ${e.message}`));
    page.on('console', m => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(`${name} CONSOLE ${m.text()}`));
    await page.goto(URL);
    // quicker than a person needs: changes go after 300 ms (not 5 s); focus looks for changes every time
    await page.evaluate(() => {
      DRIVE.quiet = 0;
      Drive.debounce = 300;
    });
    return { name, ctx, page };
  }

  /** The plans of a device, as texts; and of the cloud file (opened with the passphrase when it is encrypted). */
  const texts = d => d.page.evaluate(() => Store.planList().map(p => p.text));
  const cloud = async (d, passphrase = '') => {
    const file = drive.file();
    if (!file) return null;
    return d.page.evaluate(
      async ([text, pw]) => {
        const read = await IO.read(text, pw);
        return read.needsPassword ? 'locked' : read.plans.map(p => JSON.stringify(p));
      },
      [file.content, passphrase],
    );
  };
  const status = d => d.page.evaluate(() => Drive.status);
  /** Waits (up to 5 s) for a condition checked in Node. */
  async function until(fn, ms = 5000) {
    const end = Date.now() + ms;
    do {
      if (await fn()) return true;
      await new Promise(r => setTimeout(r, 50));
    } while (Date.now() < end);
    return false;
  }
  /** Both devices and the cloud file hold the same plans, text for text. */
  async function allSame(A, B, passphrase = '') {
    return until(async () => {
      const [a, b, c] = [await texts(A), await texts(B), await cloud(A, passphrase)];
      return a.length > 0 && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) === JSON.stringify(c);
    });
  }
  /** The device saves, waits for its short delay, and finishes syncing. */
  const settle = d => d.page.evaluate(() => (Store.flush(), Drive.idle()));
  /** The other device comes back to the app: it looks for changes. */
  const comeBack = d => d.page.evaluate(() => (window.dispatchEvent(new Event('focus')), Drive.idle()));
  const bills = d => d.page.evaluate(() => (Store.plan ? Store.plan.bills.map(b => b.name) : []));
  const icon = (d, where) => d.page.locator(`${where} [data-sync-status]`);
  async function addBillByHand(d, name, amount) {
    await d.page.evaluate(() => App.go('recurring'));
    await d.page.getByRole('button', { name: 'Add a bill' }).first().click();
    await d.page.getByPlaceholder('Rent, groceries, phone…').fill(name);
    await d.page.locator('dialog input[inputmode=decimal]').first().pressSequentially(String(amount));
    await d.page.locator('dialog').getByRole('button', { name: 'Save' }).click();
  }

  try {
    // ------------------------------------------------------------------------------------- A: the computer
    const A = await device('A', { viewport: { width: 1360, height: 900 } });
    await A.page.getByText('Look around with a sample plan').click();
    ok(google.gisLoads === 0 && drive.calls.length === 0, 'A: nothing goes to Google before sync is turned on');
    ok((await icon(A, '.side-foot').count()) === 0, 'A: no sync icon while sync is off');
    await A.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    const turnOn = A.page.locator('[data-drive-on]');
    ok((await turnOn.count()) === 1, 'A: Settings › Storage offers Turn on sync');
    await turnOn.hover();
    await turnOn.focus();
    await A.page.waitForTimeout(100);
    ok(google.gisLoads === 0, 'A: not even Google’s script is loaded before the click');
    await A.page.screenshot({ path: path.join(SHOTS, 'drive-1-off.png'), fullPage: true });

    // declining Google's window changes nothing
    google.refuse = true;
    await turnOn.click();
    await A.page.waitForTimeout(100);
    ok((await status(A)) === 'off' && !drive.file(), 'A: Google’s window closed: sync stays off, nothing written');
    google.refuse = false;

    await turnOn.click();
    ok(await until(async () => (await status(A)) === 'synced'), 'A: Turn on sync → synced');
    const backups = await A.page.evaluate(async () => (await backups()).filter(b => /Drive/.test(b.reason)).length);
    ok(backups === 1, 'A: a backup of this device’s data was kept before the first sync');
    ok(JSON.stringify(await cloud(A)) === JSON.stringify(await texts(A)), 'A: the cloud file holds exactly A’s plans');
    const listed = drive.calls.find(c => c.startsWith('GET /drive/v3/files') && !c.includes('/files/'));
    ok(!!listed, 'A: the file is looked for in the app data folder (the only place the app can reach)');
    ok((await A.page.locator('[data-drive-status]').getAttribute('data-drive-status')) === 'synced', 'A: settings says Synced');
    ok((await icon(A, '.side-foot').getAttribute('data-sync-status')) === 'synced', 'A: the menu shows the Synced icon');
    await A.page.screenshot({ path: path.join(SHOTS, 'drive-2-synced.png'), fullPage: true });

    // ---------------------------------------------------------------------------------------- B: the phone
    const B = await device('B', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    ok((await B.page.locator('.welcome').count()) === 1, 'B: a new phone shows the welcome screen');
    await B.page.screenshot({ path: path.join(SHOTS, 'drive-3-phone-welcome.png'), fullPage: true });
    await B.page.locator('[data-drive-on]').click();
    ok(await allSame(A, B), 'B: Sync with Google Drive on the welcome screen brings A’s plans, no pairing');
    await B.page.waitForSelector('#top [data-sync-status]');
    ok(await until(async () => (await icon(B, '#top').getAttribute('data-sync-status')) === 'synced'), 'B: the top bar shows the Synced icon');
    await B.page.screenshot({ path: path.join(SHOTS, 'drive-4-phone-synced.png') });

    // ---------------------------------------------------------------------------------- changes, both ways
    await addBillByHand(A, 'Climbing gym', 45);
    await settle(A);
    await comeBack(B);
    ok((await bills(B)).includes('Climbing gym') && (await allSame(A, B)), 'A → B: a bill added by hand on A is on B');
    await B.page.evaluate(() => App.go('recurring'));
    ok((await B.page.getByText('Climbing gym').count()) > 0, 'B: and on its screen');

    await B.page.evaluate(() => Actions.save('goals', { id: 'goalsync1', name: 'New bike', target: 900, monthly: 75 }));
    await settle(B);
    await comeBack(A);
    ok(
      (await A.page.evaluate(() => Store.plan.goals.some(g => g.name === 'New bike'))) && (await allSame(A, B)),
      'B → A: a savings goal added on B is on A',
    );

    // the same bill edited on both: the later edit wins on both
    const gym = await A.page.evaluate(() => Store.plan.bills.find(b => b.name === 'Climbing gym').id);
    await A.page.evaluate(id => Actions.save('bills', { ...Store.plan.bills.find(b => b.id === id), amount: 50 }), gym);
    await B.page.waitForTimeout(5);
    await B.page.evaluate(id => Actions.save('bills', { ...Store.plan.bills.find(b => b.id === id), amount: 55 }), gym);
    await settle(A);
    await settle(B);
    await comeBack(A);
    const amounts = [
      await A.page.evaluate(id => Store.plan.bills.find(b => b.id === id).amount, gym),
      await B.page.evaluate(id => Store.plan.bills.find(b => b.id === id).amount, gym),
    ];
    ok(amounts[0] === 55 && amounts[1] === 55 && (await allSame(A, B)), 'both edit one bill: the later edit (55) wins on both: ' + amounts);

    // a deletion travels (the record is kept as deleted)
    await A.page.evaluate(id => Actions.remove('bills', id), gym);
    await settle(A);
    await comeBack(B);
    ok(!(await bills(B)).includes('Climbing gym') && (await allSame(A, B)), 'A deletes the bill: it is gone on B');
    ok(
      await B.page.evaluate(id => Store.plan.deleted.bills.some(b => b.id === id && b.deletedAt > 0), gym),
      'B: the bill is kept as deleted (a tombstone), so it cannot come back from an old copy',
    );

    // edits at the same moment on both devices, synced at the same moment
    await A.page.evaluate(() => Actions.save('bills', { name: 'From A, meanwhile', amount: 10 }));
    await B.page.evaluate(() => Actions.save('bills', { name: 'From B, meanwhile', amount: 20 }));
    await Promise.all([A.page.evaluate(() => (Store.flush(), Drive.sync('now'))), B.page.evaluate(() => (Store.flush(), Drive.sync('now')))]);
    await comeBack(A);
    await comeBack(B);
    const both = [await bills(A), await bills(B)].every(list => list.includes('From A, meanwhile') && list.includes('From B, meanwhile'));
    ok(both && (await allSame(A, B)), 'simultaneous changes and syncs: both kept on both devices and in the file');

    // ------------------------------------------------------------------------------------------- offline
    await B.ctx.setOffline(true);
    ok(await until(async () => (await icon(B, '#top').getAttribute('data-sync-status')) === 'offline'), 'B offline: the icon says Offline');
    await addBillByHand(B, 'Added offline', 12);
    ok((await bills(B)).includes('Added offline'), 'B offline: the change is made at once');
    ok(await B.page.evaluate(() => localStorage.getItem('runway.db.v1').includes('Added offline')), 'B offline: and saved on the phone');
    await settle(B);
    ok((await B.page.evaluate(() => Drive.pending)) === true, 'B offline: the change waits to be synced');
    await A.page.evaluate(() => Actions.save('bills', { name: 'A while B was offline', amount: 8 }));
    await settle(A);
    await B.ctx.setOffline(false);
    await B.page.evaluate(() => Drive.idle());
    await comeBack(A);
    ok(
      (await bills(A)).includes('Added offline') && (await bills(B)).includes('A while B was offline') && (await allSame(A, B)),
      'B back online: its change goes up, A’s comes down',
    );
    ok((await icon(B, '#top').getAttribute('data-sync-status')) === 'synced', 'B: the icon says Synced again');

    // ---------------------------------------------------------------------------- the token runs out
    const token = await A.page.evaluate(async () => (await kv.get('driveToken')).token);
    drive.expire(token);
    await A.page.evaluate(() => Actions.save('bills', { name: 'After the hour', amount: 9 }));
    await settle(A);
    ok((await icon(A, '.side-foot').getAttribute('data-sync-status')) === 'signin', 'A: token expired → the icon says Sign in again');
    ok((await bills(A)).includes('After the hour'), 'A: the change is kept meanwhile');
    await A.page.screenshot({ path: path.join(SHOTS, 'drive-5-signin.png') });
    const signIns = google.signIns;
    await icon(A, '.side-foot').click();
    ok(await until(async () => (await status(A)) === 'synced'), 'A: a click on the icon signs in again and syncs');
    ok(google.signIns === signIns + 1, 'A: one sign-in');
    await comeBack(B);
    ok((await bills(B)).includes('After the hour') && (await allSame(A, B)), 'A’s waiting change reached B');

    // ----------------------------------------------------------------------------------------- passphrase
    await A.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await A.page.getByRole('button', { name: 'Encrypt with a passphrase' }).click();
    const fields = A.page.locator('dialog input[type=password]');
    await fields.nth(0).fill(PASSPHRASE);
    await fields.nth(1).fill(PASSPHRASE);
    await A.page.locator('dialog').getByRole('button', { name: 'Encrypt' }).click();
    ok(await until(() => JSON.parse(drive.file().content).kind === 'encrypted'), 'A: with a passphrase the cloud file is encrypted');
    ok(!drive.file().content.includes('After the hour'), 'A: nothing readable in it');
    ok((await cloud(A)) === 'locked' && (await allSame(A, B, PASSPHRASE)), 'the encrypted file opens with the passphrase, and holds every plan');
    await B.page.evaluate(() => Actions.save('bills', { name: 'B before unlocking', amount: 3 }));
    await settle(B);
    ok((await status(B)) === 'locked', 'B: the cloud copy is now encrypted: Passphrase needed');
    ok((await bills(B)).includes('B before unlocking'), 'B: its changes are kept meanwhile');
    await B.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await B.page.screenshot({ path: path.join(SHOTS, 'drive-6-phone-locked.png'), fullPage: true });
    await B.page.getByRole('button', { name: 'Enter the passphrase' }).click();
    await B.page.locator('dialog input[type=password]').fill('not the passphrase');
    await B.page.locator('dialog').getByRole('button', { name: 'Unlock' }).click();
    await B.page.evaluate(() => Drive.idle());
    ok((await status(B)) === 'locked', 'B: a wrong passphrase is refused');
    await B.page.getByRole('button', { name: 'Enter the passphrase' }).click();
    await B.page.locator('dialog input[type=password]').fill(PASSPHRASE);
    await B.page.locator('dialog').getByRole('button', { name: 'Unlock' }).click();
    ok(await until(async () => (await status(B)) === 'synced'), 'B: the right passphrase unlocks it');
    await comeBack(A);
    ok((await bills(A)).includes('B before unlocking') && (await allSame(A, B, PASSPHRASE)), 'B’s waiting change reached A, encrypted');

    // ----------------------------------------------------------------------------- plans and deletion
    await A.page.evaluate(() => Store.addPlan(normPlan({ name: 'Second plan' }), false));
    await settle(A);
    await comeBack(B);
    ok((await B.page.evaluate(() => Object.values(Store.db.plans).map(p => p.name))).includes('Second plan'), 'a new plan on A appears on B');
    const second = await B.page.evaluate(() => Object.values(Store.db.plans).find(p => p.name === 'Second plan').id);
    await B.page.evaluate(id => Store.removePlan(id), second);
    await settle(B);
    await comeBack(A);
    ok(!(await A.page.evaluate(id => !!Store.db.plans[id], second)) && (await allSame(A, B, PASSPHRASE)), 'a plan deleted on B is deleted on A');

    // ----------------------------------------------------------------------------------- delete cloud data
    await A.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await A.page.getByRole('button', { name: 'Delete my cloud data' }).click();
    await A.page.locator('dialog').getByRole('button', { name: 'Delete my cloud data' }).click();
    ok(await until(async () => (await status(A)) === 'off' && !drive.file()), 'A: Delete my cloud data removes the file and turns sync off');
    ok((await bills(A)).includes('After the hour'), 'A: the plans here stay');
    await B.page.evaluate(() => Actions.save('bills', { name: 'After the deletion', amount: 1 }));
    await settle(B);
    ok((await status(B)) === 'off' && !drive.file(), 'B: notices, stops syncing, and does not upload the data again');
    ok((await B.page.locator('.toast').allTextContents()).some(t => /deleted from another device/.test(t)), 'B: and says so');
    ok(
      (await B.page.locator('#top [data-sync-status]').count()) === 0 && !/null/.test(await B.page.locator('#top').textContent()),
      'B: sync off: no icon in the top bar, and nothing in its place',
    );

    ok(errors.length === 0, 'no errors in either page' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) {
    console.error(e);
    failed++;
  } finally {
    await browser.close();
    server.close();
    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    process.exit(failed ? 1 : 0);
  }
})();
