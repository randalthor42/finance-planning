/**
 * @file Browser test of the data file (state/fileSync.js), with two "devices". Run with: npm run test:file
 *
 * Each device is its own browser context (its own localStorage, IndexedDB and private file system), like two
 * computers. The file pickers cannot be clicked in a headless browser, so they return a real FileSystemFileHandle
 * from the device's Origin Private File System: writing, reading, permissions and remembering the handle in
 * IndexedDB are the browser's own. This script plays the sync client (OneDrive, Dropbox…): cloud(a, b) copies the
 * file from one device's disk to the other's. The page is served from localhost, since the private file system is
 * not available to file:// pages.
 *
 * After each change it checks that the file holds exactly the plans the app holds (what "perfectly" means here), and
 * that the other device shows the change after the file reached it.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '../../dist-test');
const FILE = 'runway-data.json';
const results = [];
let failed = 0;
const ok = (cond, msg) => {
  results.push((cond ? 'ok   ' : 'FAIL ') + msg);
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failed++;
};

/** Stubs the pickers with the private file system and records how the app asks for files. */
function pickerStub({ unsupported = false, askPermission = false } = {}) {
  return `(() => {
    ${unsupported ? 'delete window.showSaveFilePicker; delete window.showOpenFilePicker; return;' : ''}
    window.__pickers = [];
    const file = async create => (await navigator.storage.getDirectory()).getFileHandle(${JSON.stringify(FILE)}, { create });
    window.showSaveFilePicker = async options => { window.__pickers.push(['save', options]); return file(true); };
    window.showOpenFilePicker = async options => { window.__pickers.push(['open', options]); return [await file(false)]; };
    window.showDirectoryPicker = async () => { window.__pickers.push(['directory']); throw new Error('never used'); };
    ${
      askPermission
        ? `// a new visit where the browser asks again before the remembered file may be used; once allowed, every tab
    // of this visit may use it (like the browser's permission for the site)
    const visit = ${JSON.stringify(String(Math.random()))};
    const proto = FileSystemHandle.prototype;
    proto.queryPermission = async function () { return localStorage.getItem('__granted') === visit ? 'granted' : 'prompt'; };
    proto.requestPermission = async function () { localStorage.setItem('__granted', visit); return 'granted'; };`
        : ''
    }
  })();`;
}

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : req.url.slice(1));
    fs.readFile(file, (err, data) => {
      // like a real host: the service worker (sw.js) must be served as JavaScript
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/json';
      res.writeHead(err ? 404 : 200, { 'content-type': type });
      res.end(err ? 'not found' : data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const server = await serve();
  const URL = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  const devices = [];

  async function device(name, options) {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await ctx.addInitScript(pickerStub(options));
    const page = await ctx.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', e => errors.push(`${name} PAGEERR ${e.message}`));
    page.on('console', m => m.type() === 'error' && errors.push(`${name} CONSOLE ${m.text()}`));
    await page.goto(URL);
    const d = { name, ctx, page, options };
    devices.push(d);
    return d;
  }
  /** Opens the same device again (a new visit), with other picker options if given. */
  async function reopen(d, options) {
    await d.page.close();
    if (options) await d.ctx.addInitScript(pickerStub(options)); // later scripts run after, and win
    d.page = await d.ctx.newPage();
    d.page.setDefaultTimeout(5000);
    d.page.on('pageerror', e => errors.push(`${d.name} PAGEERR ${e.message}`));
    await d.page.goto(URL);
  }
  const readDisk = d =>
    d.page.evaluate(async name => {
      try {
        const h = await (await navigator.storage.getDirectory()).getFileHandle(name);
        return await (await h.getFile()).text();
      } catch (e) {
        return null;
      }
    }, FILE);
  const writeDisk = (d, text) =>
    d.page.evaluate(
      async ([name, text]) => {
        const h = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true });
        const w = await h.createWritable();
        await w.write(text);
        await w.close();
      },
      [FILE, text],
    );
  /** The sync client: brings the file from one device to the other. */
  const cloud = async (from, to) => writeDisk(to, await readDisk(from));
  const state = d =>
    d.page.evaluate(() => ({
      status: Sync.status,
      texts: Store.planList().map(p => p.text),
      names: Object.values(Store.db.plans).map(p => p.name),
    }));
  /** Waits (up to 5 s) until the file on the device's disk holds exactly the plans of the app. */
  async function synced(d) {
    const until = Date.now() + 5000;
    let s;
    let file;
    do {
      s = await state(d);
      const text = await readDisk(d);
      try {
        file = text && JSON.parse(text).plans.map(p => JSON.stringify(p));
      } catch (e) {
        file = null;
      }
      if (file && JSON.stringify(file) === JSON.stringify(s.texts)) return true;
      await d.page.waitForTimeout(50);
    } while (Date.now() < until);
    return false;
  }
  const same = async (a, b) => JSON.stringify((await state(a)).texts) === JSON.stringify((await state(b)).texts);
  const bills = d => d.page.evaluate(() => (Store.plan ? Store.plan.bills.map(b => b.name) : []));
  const badge = d => d.page.locator('.side-foot .save-state').first();
  const goStorage = d => d.page.evaluate(() => App.go('settings', { stab: 'storage' }));
  /** Adds a bill the way a person does: the page, the button, the window, Save. */
  async function addBillByHand(d, name, amount) {
    await d.page.locator('.nav button[title="Income and bills"]').click();
    await d.page.getByRole('button', { name: 'Add a bill' }).first().click();
    await d.page.getByPlaceholder('Rent, groceries, phone…').fill(name);
    await d.page.locator('dialog input[inputmode=decimal]').first().pressSequentially(String(amount));
    await d.page.locator('dialog').getByRole('button', { name: 'Save' }).click();
  }
  const focus = d => d.page.evaluate(() => window.dispatchEvent(new Event('focus')));

  try {
    // ---------------------------------------------------------------------------------------------- device A
    const A = await device('A');
    ok((await A.page.locator('.welcome').count()) === 1, 'A: welcome screen');
    ok(
      (await A.page.getByRole('button', { name: 'Open a data file' }).count()) === 1,
      'A: the welcome screen offers to open a data file',
    );
    await A.page.getByText('Look around with a sample plan').click();
    ok((await A.page.evaluate(() => Store.db.fileSync)) === true, 'A: saving to a file is on by default');
    ok((await badge(A).textContent()) === 'Choose a file', 'A: the menu asks to choose a file');
    await badge(A).click();
    ok((await A.page.locator('[role=tab][aria-selected=true]').textContent()) === 'Storage', 'A: it leads to Settings › Storage');
    ok(await A.page.getByRole('checkbox', { name: 'Save to a file you choose' }).isChecked(), 'A: the switch is on');
    ok((await A.page.locator('[data-file-status]').getAttribute('data-file-status')) === 'unlinked', 'A: no file chosen yet');
    await A.page.screenshot({ path: path.join(__dirname, 'shots', 'file-1-unlinked.png') });

    await A.page.getByRole('button', { name: 'Choose where to save' }).click();
    ok(await synced(A), 'A: choosing where to save writes every plan to the file');
    const pick = await A.page.evaluate(() => window.__pickers);
    ok(
      pick.length === 1 &&
        pick[0][0] === 'save' &&
        pick[0][1].suggestedName === FILE &&
        pick[0][1].excludeAcceptAllOption === true &&
        JSON.stringify(pick[0][1].types[0].accept) === '{"application/json":[".json"]}',
      'A: the save picker asks for one .json file only: ' + JSON.stringify(pick),
    );
    ok((await state(A)).status === 'ok', 'A: status ok');
    ok((await badge(A).textContent()) === 'Saved', 'A: the menu says Saved');
    ok((await A.page.locator('[data-file-status]').getAttribute('data-file-status')) === 'ok', 'A: settings shows Saving');
    ok((await A.page.locator('.rows .amt', { hasText: FILE }).count()) === 1, 'A: settings shows the file name');
    await A.page.screenshot({ path: path.join(__dirname, 'shots', 'file-2-linked.png') });
    const first = JSON.parse(await readDisk(A));
    ok(first.app === 'runway' && first.kind === 'data' && first.by === (await A.page.evaluate(() => Sync.device)), 'A: the file says what it is and who saved it');

    // every change, one after the other, is in the file
    await addBillByHand(A, 'Climbing gym', 45);
    ok((await bills(A)).includes('Climbing gym') && (await synced(A)), 'A: a bill added by hand is in the file');
    await A.page.evaluate(() => Actions.save('goals', { id: 'goaltest1', name: 'New bike', target: 900, monthly: 75 }));
    ok(await synced(A), 'A: a savings goal is in the file');
    await A.page.evaluate(() => Store.undo());
    ok(await synced(A), 'A: undo is in the file');
    {
      // an undone addition is a deletion: the goal leaves the plan's goals, and is kept as deleted (deletedAt)
      const plan = JSON.parse(await readDisk(A)).plans[0];
      const kept = plan.deleted.goals.find(g => g.name === 'New bike');
      ok(!plan.goals.some(g => g.name === 'New bike') && kept && kept.deletedAt > 0, 'A: the undone goal is out of the goals, kept as deleted');
    }
    await A.page.evaluate(() => Store.redo());
    ok(
      (await synced(A)) && JSON.parse(await readDisk(A)).plans[0].goals.some(g => g.name === 'New bike' && g.deletedAt === null),
      'A: redo is in the file (the goal is live again)',
    );
    await A.page.evaluate(() => Store.renamePlan(Store.db.active, 'Household'));
    ok((await synced(A)) && JSON.parse(await readDisk(A)).plans[0].name === 'Household', 'A: renaming the plan is in the file');
    const savedBefore = JSON.parse(await readDisk(A)).saved;
    await A.page.evaluate(() => Store.setPref('theme', 'dark'));
    await A.page.waitForTimeout(450);
    ok(JSON.parse(await readDisk(A)).saved === savedBefore, 'A: a theme change does not rewrite the file');
    ok(!(await readDisk(A)).includes('"theme"'), 'A: browser preferences are not in the file');
    // a burst of changes is written together, and the last one wins
    const writes = await A.page.evaluate(async () => {
      let n = 0;
      const write = FileAccess.write;
      FileAccess.write = function (...args) {
        n++;
        return write.apply(this, args);
      };
      for (let i = 0; i < 10; i++) Actions.save('bills', { id: 'burst' + i, name: 'Burst ' + i, amount: i + 1 });
      await new Promise(r => setTimeout(r, 10));
      for (let i = 0; i < 10; i++) Actions.save('bills', { id: 'burstb' + i, name: 'Burst b' + i, amount: i + 1 });
      await new Promise(r => setTimeout(r, 0));
      await Sync.idle();
      FileAccess.write = write;
      return n;
    });
    ok((await synced(A)) && writes <= 2, 'A: 20 quick changes, ' + writes + ' file write(s)');

    // a new visit: the remembered file is used again without asking (permission still granted)
    await reopen(A);
    await A.page.waitForFunction(() => Sync.status === 'ok');
    ok(await synced(A), 'A: after a reload the file is found again and in step');
    ok((await A.page.evaluate(() => window.__pickers.length)) === 0, 'A: no picker needed after a reload');

    // ---------------------------------------------------------------------------------------------- device B
    const B = await device('B');
    await cloud(A, B); // the file arrives on the second computer
    await B.page.getByRole('button', { name: 'Open a data file' }).click();
    await B.page.waitForFunction(() => Sync.status === 'ok' && !!Store.plan);
    ok(await same(A, B), 'B: opening the data file brings every plan of A');
    ok((await B.page.locator('main h1').first().textContent()).length > 0 && (await B.page.locator('.welcome').count()) === 0, 'B: the app opens on the plan');
    ok((await B.page.evaluate(() => window.__pickers.map(p => p[0]).join())) === 'open', 'B: the open picker was used');
    ok(
      (await B.page.evaluate(() => window.__pickers[0][1].multiple === false && window.__pickers[0][1].excludeAcceptAllOption === true)),
      'B: the open picker allows one .json file only',
    );
    ok((await B.page.evaluate(() => Store.db.theme)) === 'auto', 'B: A’s theme stays on A');

    // A changes → the file → B shows it (found by B's own timer: no event needed)
    await addBillByHand(A, 'Piano lessons', 80);
    ok(await synced(A), 'A: piano lessons in A’s file');
    await cloud(A, B);
    await B.page.locator('.nav button[title="Income and bills"]').click();
    await B.page.waitForFunction(() => Store.plan.bills.some(b => b.name === 'Piano lessons'), null, { timeout: 5000 });
    ok(await same(A, B), 'B: the change made on A appears on B (watcher)');
    await B.page.locator('.row .t', { hasText: 'Piano lessons' }).first().waitFor();
    ok(true, 'B: the page shows it without a reload');
    ok((await B.page.locator('.toast', { hasText: 'Loaded changes from ' + FILE }).count()) >= 1, 'B: a message says where it came from');
    await B.page.screenshot({ path: path.join(__dirname, 'shots', 'file-3-device-b.png') });

    // B changes → the file → A (back in view: the focus event)
    await B.page.evaluate(() => {
      const b = Store.plan.bills.find(x => x.name === 'Piano lessons');
      Actions.save('bills', { ...b, name: 'Piano lessons (group)', amount: 60 });
    });
    ok(await synced(B), 'B: the edit is in B’s file');
    await cloud(B, A);
    await focus(A);
    await A.page.waitForFunction(() => Store.plan.bills.some(b => b.name === 'Piano lessons (group)'));
    ok(await same(A, B), 'A: the edit made on B appears on A');
    ok(await synced(A), 'A: and A’s file is the same (not rewritten needlessly)');

    // ten changes alternating between the devices, each carried over at once
    for (let i = 0; i < 5; i++) {
      await A.page.evaluate(i => Actions.save('items', { id: 'a' + i + 'item', name: 'A item ' + i, amount: 10 + i, kind: 'out' }), i);
      await synced(A);
      await cloud(A, B);
      await focus(B);
      await B.page.waitForFunction(i => Store.plan.items.some(x => x.name === 'A item ' + i), i);
      await B.page.evaluate(i => Actions.save('items', { id: 'b' + i + 'item', name: 'B item ' + i, amount: 20 + i, kind: 'out' }), i);
      await synced(B);
      await cloud(B, A);
      await focus(A);
      await A.page.waitForFunction(i => Store.plan.items.some(x => x.name === 'B item ' + i), i);
    }
    ok(await same(A, B), 'A and B: the same plans after ten alternating changes');
    ok((await state(A)).names.length === 1, 'A and B: no conflict copies');

    // both change the same plan before either sees the other: both changes are kept in it, on both (no copy)
    await A.page.evaluate(() => Actions.save('bills', { id: 'conflicta', name: 'Made on A', amount: 5 }));
    await B.page.evaluate(() => Actions.save('bills', { id: 'conflictb', name: 'Made on B', amount: 6 }));
    ok((await synced(A)) && (await synced(B)), 'conflict: each device wrote its own file');
    await cloud(A, B);
    await focus(B);
    await B.page.waitForFunction(() => Store.plan.bills.some(x => x.name === 'Made on A'));
    ok(await synced(B), 'conflict: B merged both changes and wrote them');
    await cloud(B, A);
    await focus(A);
    await A.page.waitForFunction(() => Store.plan.bills.some(x => x.name === 'Made on B'));
    ok(await same(A, B), 'conflict: A and B hold the same plan, with both bills');
    ok((await state(A)).names.length === 1, 'conflict: no copy of the plan was made');
    await B.page.screenshot({ path: path.join(__dirname, 'shots', 'file-4-conflict.png') });
    // a plan made on B reaches A; deleted on B, it is deleted on A
    await B.page.evaluate(() => Store.addPlan({ name: 'Spare plan' }, false));
    await synced(B);
    await cloud(B, A);
    await focus(A);
    await A.page.waitForFunction(() => Object.keys(Store.db.plans).length === 2);
    await B.page.evaluate(() => Store.removePlan(Object.values(Store.db.plans).find(p => p.name === 'Spare plan').id));
    await synced(B);
    await cloud(B, A);
    await focus(A);
    await A.page.waitForFunction(() => Object.keys(Store.db.plans).length === 1);
    ok(await same(A, B), 'a plan deleted on B is deleted on A');

    // ------------------------------------------------------------------- a visit where the browser asks again
    await reopen(A, { askPermission: true });
    await A.page.waitForFunction(() => Sync.status === 'prompt');
    ok((await badge(A).textContent()) === 'Reconnect file', 'A: the menu asks to reconnect the file');
    const before = await readDisk(A);
    await A.page.evaluate(() => Actions.save('bills', { id: 'offline1', name: 'Made before reconnecting', amount: 7 }));
    await A.page.waitForTimeout(450);
    ok((await readDisk(A)) === before, 'A: nothing is written without permission');
    ok((await A.page.evaluate(() => localStorage.getItem(APP.key))).includes('Made before reconnecting'), 'A: the change is safe in the browser');
    await goStorage(A);
    await A.page.screenshot({ path: path.join(__dirname, 'shots', 'file-5-reconnect.png') });
    await badge(A).click();
    await A.page.waitForFunction(() => Sync.status === 'ok');
    ok((await synced(A)) && (await readDisk(A)).includes('Made before reconnecting'), 'A: after reconnecting, the change is in the file');
    await cloud(A, B);
    await focus(B);
    await B.page.waitForFunction(() => Store.plan.bills.some(b => b.name === 'Made before reconnecting'));
    ok(await same(A, B), 'B: and it reaches B');

    // ------------------------------------------------------------------------------------ the switch
    await goStorage(A);
    await A.page.getByRole('checkbox', { name: 'Save to a file you choose' }).uncheck();
    ok((await A.page.evaluate(() => [Sync.status, Store.db.fileSync].join())) === 'off,false', 'A: turned off');
    ok((await A.page.locator('[data-file-status]').count()) === 0, 'A: no file details while off');
    const offBefore = await readDisk(A);
    await A.page.evaluate(() => Actions.save('bills', { id: 'whileoff1', name: 'Made while off', amount: 8 }));
    await A.page.waitForTimeout(450);
    ok((await readDisk(A)) === offBefore, 'A: off: the file is not written');
    await A.page.getByRole('checkbox', { name: 'Save to a file you choose' }).check();
    await A.page.waitForFunction(() => Sync.status === 'ok');
    ok((await synced(A)) && (await readDisk(A)).includes('Made while off'), 'A: on again: it catches up with the same file');

    // following other devices can be turned off (and back on)
    await B.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await B.page.getByRole('checkbox', { name: 'Load changes from other devices' }).uncheck();
    await A.page.evaluate(() => Actions.save('bills', { id: 'notwatched', name: 'Not followed', amount: 9 }));
    await synced(A);
    await cloud(A, B);
    await focus(B);
    await B.page.waitForTimeout(600);
    ok(!(await bills(B)).includes('Not followed'), 'B: not following: the change is not loaded');
    await B.page.getByRole('checkbox', { name: 'Load changes from other devices' }).check();
    await focus(B);
    await B.page.waitForFunction(() => Store.plan.bills.some(b => b.name === 'Not followed'));
    ok(await same(A, B), 'B: following again: it is loaded');

    // --------------------------------------------------------------------------------- a damaged file
    await writeDisk(A, '{"app":"runway","kind":"da');
    await focus(A);
    await A.page.waitForFunction(() => Sync.status === 'error');
    ok((await badge(A).textContent()) === 'File not saved', 'A: a damaged file is reported');
    await A.page.evaluate(() => Actions.save('bills', { id: 'afterdamage', name: 'After the damage', amount: 3 }));
    await A.page.waitForTimeout(450);
    ok((await readDisk(A)) === '{"app":"runway","kind":"da', 'A: a damaged file is not overwritten on its own');
    await goStorage(A);
    await A.page.screenshot({ path: path.join(__dirname, 'shots', 'file-6-error.png') });
    await A.page.getByRole('button', { name: 'Replace its content with this browser’s plans' }).click();
    await A.page.waitForFunction(() => Sync.status === 'ok');
    ok(await synced(A), 'A: replaced when the person asked');

    // ----------------------------------------------------------------------- stop using / delete everything
    await goStorage(A);
    await A.page.getByRole('button', { name: 'Stop using this file' }).click();
    ok((await A.page.evaluate(() => Sync.status)) === 'unlinked', 'A: stopped using the file');
    const kept = await readDisk(A);
    await A.page.evaluate(() => Actions.save('bills', { id: 'afterstop', name: 'After stopping', amount: 2 }));
    await A.page.waitForTimeout(450);
    ok((await readDisk(A)) === kept, 'A: the file is left as it was');
    ok((await A.page.evaluate(() => HandleStore.get('file'))) === undefined, 'A: the file is forgotten');

    await B.page.evaluate(() => App.go('settings', { stab: 'backup' }));
    await B.page.getByRole('button', { name: 'Delete everything' }).click();
    ok((await B.page.locator('dialog', { hasText: 'is disconnected and left as it is' }).count()) === 1, 'B: Delete everything says the file is left alone');
    const bFile = await readDisk(B);
    await B.page.locator('dialog').getByRole('button', { name: 'Delete everything' }).click();
    await B.page.waitForTimeout(450);
    ok((await readDisk(B)) === bFile && JSON.parse(bFile).plans.length === 1, 'B: Delete everything does not empty the file');
    ok((await B.page.locator('.welcome').count()) === 1, 'B: back to the welcome screen');
    // and the file brings everything back
    await B.page.getByRole('button', { name: 'Open a data file' }).click();
    await B.page.waitForFunction(() => Sync.status === 'ok' && !!Store.plan);
    ok((await B.page.evaluate(() => Store.plan.name)) === 'Household', 'B: opening the file again brings the plans back');

    // ------------------------------------------------------------------------- a browser without the API
    const C = await device('C', { unsupported: true });
    ok((await C.page.getByRole('button', { name: 'Open a data file' }).count()) === 0, 'C: no file option on the welcome screen');
    await C.page.getByText('Look around with a sample plan').click();
    ok((await badge(C).textContent()) === 'Saved', 'C: the menu says Saved (in the browser)');
    await goStorage(C);
    ok((await C.page.locator('.note', { hasText: 'This browser cannot save to a file you choose' }).count()) === 1, 'C: Settings explains why');
    await C.page.screenshot({ path: path.join(__dirname, 'shots', 'file-7-unsupported.png') });
    await C.page.evaluate(() => Actions.save('bills', { id: 'cbill', name: 'Works anyway', amount: 1 }));
    await C.page.waitForTimeout(50);
    ok((await C.page.evaluate(() => localStorage.getItem(APP.key))).includes('Works anyway'), 'C: saved in the browser');

    // ------------------------------------------------------- two tabs of one browser (same storage, same file)
    await A.page.getByRole('button', { name: 'Choose where to save' }).click(); // A was disconnected above
    await A.page.waitForFunction(() => Sync.status === 'ok');
    const A2 = await A.ctx.newPage();
    A2.setDefaultTimeout(5000);
    A2.on('pageerror', e => errors.push('A2 PAGEERR ' + e.message));
    await A2.goto(URL);
    await A2.waitForFunction(() => Sync.status === 'ok');
    await A2.evaluate(() => {
      window.__writes = 0;
      const write = FileAccess.write;
      FileAccess.write = function (...args) {
        window.__writes++;
        return write.apply(this, args);
      };
    });
    await A.page.evaluate(() => Actions.save('bills', { id: 'othertab', name: 'From the first tab', amount: 4 }));
    ok(await synced(A), 'tabs: the first tab wrote the file');
    await A2.waitForFunction(() => Store.plan.bills.some(b => b.name === 'From the first tab'));
    await A2.evaluate(() => window.dispatchEvent(new Event('focus')));
    await A2.waitForTimeout(400);
    ok((await A2.evaluate(() => window.__writes)) === 0, 'tabs: the second tab shows it without writing the file again');
    ok(
      (await A2.evaluate(() => JSON.stringify(Store.planList().map(p => p.text)))) === JSON.stringify((await state(A)).texts),
      'tabs: both tabs hold the same plans',
    );
    await A2.close();

    // ------------------------------------------------------------------------------- on a phone-sized screen
    await A.page.setViewportSize({ width: 390, height: 800 });
    await goStorage(A);
    await A.page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
    await A.page.waitForTimeout(350); // the menu drawer's slide
    const overflow = await A.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(overflow <= 1, 'phone width: Settings › Storage fits (overflow ' + overflow + ')');
    await A.page.screenshot({ path: path.join(__dirname, 'shots', 'file-8-phone.png'), fullPage: true });
    await A.page.setViewportSize({ width: 1360, height: 900 });

    // a change still waiting to be written when the page is closed reaches the file on the next visit
    await A.page.evaluate(() => {
      Actions.save('bills', { id: 'atclose1', name: 'Made just before closing', amount: 1 });
      Store.flush();
    });
    await reopen(A);
    await A.page.waitForFunction(() => Sync.status === 'ok');
    ok((await synced(A)) && (await readDisk(A)).includes('Made just before closing'), 'a change made just before closing is in the file');

    // never a folder
    for (const d of [A, B]) {
      ok(!(await d.page.evaluate(() => window.__pickers.some(p => p[0] === 'directory'))), d.name + ': no folder was ever asked for');
    }
  } catch (e) {
    ok(false, 'stopped: ' + (e && e.message ? e.message.split('\n')[0] : e));
    for (const d of devices) {
      const info = await d.page
        .evaluate(() => ({ status: Sync.status, error: Sync.error, toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent) }))
        .catch(() => null);
      console.log(d.name, JSON.stringify(info));
    }
  }
  ok(errors.length === 0, 'no errors in the pages' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} FAILED` : `\nFILE SYNC OK (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
})();
