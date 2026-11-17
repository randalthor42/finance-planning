/**
 * @file Browser test of QR transfers (ui/modals/qrTransfer.js) between a computer (A) and a phone (B), each its own
 * browser context. Run with: npm run test:qr
 *
 * The sender is the real app: its QR codes are taken from its screen (the canvas), frame by frame. The receiver's
 * camera is a stand-in that films a canvas (canvas.captureStream) on which this script shows those images, in any
 * order, with repeats, a code of another transfer and one that is not Runway's; the app reads them from the video with
 * its QR reader, as it would from a real camera. Then the one-time code, the import preview, and the merge.
 * Last, the file to hand out (runway-money-planner.html) is opened from disk: its embedded QR modules must load.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '../../dist-test');
const SHOTS = path.join(__dirname, 'shots');
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

/** The camera: a canvas filmed at 15 frames a second. __show(image) puts a picture in front of it. */
const FAKE_CAMERA = `(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const g = canvas.getContext('2d');
  g.fillStyle = '#556';
  g.fillRect(0, 0, 640, 480);
  window.__show = src => new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      g.fillStyle = '#ccc';
      g.fillRect(0, 0, 640, 480);
      g.drawImage(img, 110, 20, 440, 440);
      resolve();
    };
    img.src = src;
  });
  window.__cameras = 0;
  navigator.mediaDevices.getUserMedia = async constraints => {
    if (window.__cameraDenied) throw new DOMException('Permission denied', 'NotAllowedError');
    window.__cameras++;
    window.__constraints = constraints;
    return canvas.captureStream(15);
  };
})();`;

(async () => {
  const server = await serve();
  const URL = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const errors = [];
  fs.mkdirSync(SHOTS, { recursive: true });

  async function device(name, contextOptions) {
    const ctx = await browser.newContext(contextOptions);
    await ctx.addInitScript(FAKE_CAMERA);
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', e => errors.push(`${name} PAGEERR ${e.message}`));
    page.on('console', m => m.type() === 'error' && errors.push(`${name} CONSOLE ${m.text()}`));
    await page.goto(URL);
    return { name, ctx, page };
  }
  const texts = d => d.page.evaluate(() => Store.planList().map(p => p.text));
  const bills = d => d.page.evaluate(() => (Store.plan ? Store.plan.bills.map(b => b.name) : []));

  /** Opens Send on a device, shows the codes fast, and takes every frame from its screen. */
  async function send(d, scope) {
    await d.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await d.page.getByRole('button', { name: 'Send', exact: true }).click();
    if (scope) await d.page.locator('dialog .qr-scope').getByRole('button', { name: scope }).click();
    await d.page.getByRole('button', { name: 'Show the QR codes' }).click();
    await d.page.waitForSelector('dialog canvas.qr-canvas[data-frame]');
    await d.page.locator('dialog .qr-speed').getByRole('button', { name: 'Fast' }).click();
    const code = await d.page.locator('[data-transfer-code]').getAttribute('data-transfer-code');
    ok((await d.page.locator('[data-transfer-code]').textContent()) !== code, 'send: the code is hidden while the loop runs');
    await d.page.getByRole('button', { name: 'Show the code' }).click();
    ok((await d.page.locator('[data-transfer-code]').textContent()) === code, 'send: shown when asked for');
    const total = +(/of (\d+)/.exec(await d.page.locator('[data-qr-counter]').textContent())[1]);
    const frames = new Map();
    const end = Date.now() + 10000;
    while (frames.size < total && Date.now() < end) {
      const [n, url] = await d.page.evaluate(() => {
        const c = document.querySelector('dialog canvas.qr-canvas');
        return [+c.dataset.frame, c.toDataURL()];
      });
      frames.set(n, url);
      await d.page.waitForTimeout(40);
    }
    return { code, total, frames };
  }
  /**
   * Shows one image to the receiving device's camera and waits until the app has read the code in it: the start of
   * the last code read matches `expect` (frame n of a transfer: 'RW1:<id>:n:'; another code: its start).
   */
  async function show(d, image, expect) {
    await d.page.evaluate(src => window.__show(src), image);
    const pattern = typeof expect === 'number' ? `^RW1:[a-z0-9]{6}:${expect}:` : '^' + expect.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    await d.page.waitForFunction(
      p => new RegExp(p).test(document.querySelector('.qr-receive').dataset.last || ''),
      pattern,
      { timeout: 4000 },
    );
  }
  const progress = d => d.page.locator('[data-qr-progress]').textContent();
  const message = d => d.page.locator('[data-qr-message]').textContent();

  try {
    // ---------------------------------------------------------------------------- A sends all its plans
    const A = await device('A', { viewport: { width: 1360, height: 900 } });
    await A.page.getByText('Look around with a sample plan').click();
    await A.page.evaluate(() => {
      Actions.save('bills', { name: 'Only on A', amount: 42 });
      Store.addPlan(normPlan({ name: 'Trip plan' }), false);
      Store.flush();
    });
    const sent = await send(A, 'All plans');
    ok(sent.total > 1 && sent.frames.size === sent.total, `A: the codes loop; all ${sent.total} taken from the screen`);
    ok(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(sent.code), 'A: a one-time code is shown: ' + sent.code);
    await A.page.screenshot({ path: path.join(SHOTS, 'qr-1-send.png') });

    // ------------------------------------------------------------------------- B receives on the phone
    const B = await device('B', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await B.page.getByRole('button', { name: 'Receive with QR codes' }).click();
    await B.page.waitForFunction(() => window.__cameras === 1);
    ok(await B.page.evaluate(() => window.__constraints.video.facingMode === 'environment'), 'B: the back camera is asked for');
    ok(/Point the camera/.test(await progress(B)), 'B: asks to point the camera at the codes');

    // not a Runway code, then a code of another transfer: said clearly, nothing taken
    const foreign = await A.page.evaluate(async () => {
      const { drawFrame } = await loadQr('encode');
      const c = document.createElement('canvas');
      drawFrame(c, 'https://example.com/not-runway');
      const other = document.createElement('canvas');
      drawFrame(other, makeFrames('x'.repeat(900), { id: 'zzzzzz' })[0]);
      return [c.toDataURL(), other.toDataURL()];
    });
    await show(B, foreign[0], 'https://example.com');
    ok(/not a Runway transfer/.test(await message(B)), 'B: a QR code that is not Runway’s is refused: ' + (await message(B)));

    // the frames in a shuffled order, some twice
    const order = [...sent.frames.keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const firstHalf = order.slice(0, Math.ceil(order.length / 2));
    for (const n of firstHalf) await show(B, sent.frames.get(n), n);
    ok((await progress(B)) === `Scanned ${firstHalf.length} of ${sent.total}`, `B: progress “${await progress(B)}”`);
    await show(B, sent.frames.get(firstHalf[0]), firstHalf[0]);
    ok((await progress(B)) === `Scanned ${firstHalf.length} of ${sent.total}`, 'B: a repeated code does not count twice');
    await show(B, foreign[1], 'RW1:zzzzzz:1:');
    ok(/another transfer/.test(await message(B)), 'B: a code of another transfer is refused: ' + (await message(B)));
    await B.page.screenshot({ path: path.join(SHOTS, 'qr-2-receive.png') });
    for (const n of order.slice(firstHalf.length)) await show(B, sent.frames.get(n), n);
    await B.page.waitForSelector('.qr-code-input');
    ok(true, 'B: every code in: it asks for the one-time code');
    ok(await B.page.evaluate(() => !document.querySelector('.qr-video') || !document.querySelector('.qr-video').srcObject), 'B: the camera is off');

    await B.page.locator('.qr-code-input').fill('ABCD-EFGH-JKLM');
    await B.page.getByRole('button', { name: 'Open', exact: true }).click();
    await B.page.waitForFunction(() => /does not match/.test(document.querySelector('[data-qr-message]').textContent));
    ok(true, 'B: a wrong code is refused');
    await B.page.locator('.qr-code-input').fill(sent.code.toLowerCase().replace(/-/g, ' '));
    await B.page.getByRole('button', { name: 'Open', exact: true }).click();
    await B.page.waitForSelector('[data-import-preview]');
    const rows = await B.page.locator('[data-import-preview] [data-merge]').evaluateAll(r => r.map(e => e.dataset.merge));
    ok(rows.length === 2 && rows.every(s => s === 'new'), 'B: the preview lists both plans as new: ' + rows);
    await B.page.screenshot({ path: path.join(SHOTS, 'qr-3-preview.png') });
    await B.page.locator('dialog').getByRole('button', { name: 'Merge' }).click();
    ok(JSON.stringify(await texts(B)) === JSON.stringify(await texts(A)), 'B: after Merge, B holds exactly A’s plans, text for text');
    ok((await bills(B)).includes('Only on A'), 'B: including the bill only A had');

    // ------------------------------------------------------------- changes on both, B sends one plan back
    await A.page.keyboard.press('Escape');
    await A.page.evaluate(() => {
      Actions.save('bills', { name: 'Added on A later', amount: 7 });
      Actions.remove('bills', Store.plan.bills.find(b => b.name === 'Only on A').id);
      Store.flush();
    });
    await B.page.evaluate(() => {
      Actions.save('bills', { name: 'Added on B', amount: 11 });
      Store.flush();
    });
    const back = await send(B, 'This plan');
    await B.page.keyboard.press('Escape');
    await A.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await A.page.getByRole('button', { name: 'Receive', exact: true }).click();
    for (const n of back.frames.keys()) await show(A, back.frames.get(n), n);
    await A.page.locator('.qr-code-input').fill(back.code);
    await A.page.getByRole('button', { name: 'Open', exact: true }).click();
    await A.page.waitForSelector('[data-import-preview]');
    const updated = await A.page.locator('[data-merge="merged"]').textContent();
    ok(/1 added/.test(updated), 'A: the preview says what changes: ' + updated);
    await A.page.locator('dialog').getByRole('button', { name: 'Merge' }).click();
    const merged = await bills(A);
    ok(
      merged.includes('Added on B') && merged.includes('Added on A later') && !merged.includes('Only on A'),
      'A: after Merge, B’s new bill is in, A’s own change stays, A’s deletion stays',
    );

    // the same again: nothing to merge; adding a copy is still possible
    await A.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await A.page.getByRole('button', { name: 'Receive', exact: true }).click();
    for (const n of back.frames.keys()) await show(A, back.frames.get(n), n);
    await A.page.locator('.qr-code-input').fill(back.code);
    await A.page.getByRole('button', { name: 'Open', exact: true }).click();
    await A.page.waitForSelector('[data-import-preview]');
    ok(await A.page.locator('dialog').getByRole('button', { name: 'Merge' }).isDisabled(), 'A: received again: Merge has nothing to do');
    const plansBefore = await A.page.evaluate(() => Object.keys(Store.db.plans).length);
    await A.page.locator('dialog').getByRole('button', { name: 'Add as separate copies' }).click();
    ok((await A.page.evaluate(() => Object.keys(Store.db.plans).length)) === plansBefore + 1, 'A: Add as separate copies adds it as a new plan');

    // ----------------------------------------------- a backup file, imported: the same preview, then a merge
    await A.page.evaluate(() => {
      Actions.save('bills', { name: 'In the backup file', amount: 5 });
      Store.flush();
    });
    const backupText = await A.page.evaluate(() => IO.backup(Object.values(Store.db.plans), '', { deletedPlans: Store.db.deletedPlans }));
    await B.page.evaluate(() => App.go('settings', { stab: 'backup' }));
    const chooser = B.page.waitForEvent('filechooser');
    await B.page.getByRole('button', { name: 'Import backup' }).click();
    await (await chooser).setFiles({ name: 'runway-backup.json', mimeType: 'application/json', buffer: Buffer.from(backupText) });
    await B.page.waitForSelector('[data-import-preview]');
    const fileRows = await B.page.locator('[data-import-preview] [data-merge]').evaluateAll(r => r.map(e => e.dataset.merge));
    ok(fileRows.includes('merged') && fileRows.includes('new'), 'B: importing a backup file shows the preview first: ' + fileRows);
    const bPlans = await B.page.evaluate(() => Object.keys(Store.db.plans).length);
    await B.page.locator('dialog').getByRole('button', { name: 'Merge' }).click();
    const everyBill = await B.page.evaluate(() => Object.values(Store.db.plans).flatMap(p => p.bills.map(b => b.name)));
    const bSample = await B.page.evaluate(() => Object.values(Store.db.plans).find(p => p.name === 'Sample plan').bills.map(b => b.name));
    ok(
      everyBill.includes('In the backup file') && bSample.includes('Added on A later') && !bSample.includes('Only on A'),
      'B: merged from the file: the new bill in, A’s later bill in, the bill deleted on A gone',
    );
    ok(
      JSON.stringify(await texts(B)) === JSON.stringify(await texts(A)),
      'B: after merging A’s full backup, B holds exactly A’s plans, text for text',
    );
    ok((await B.page.evaluate(() => Object.keys(Store.db.plans).length)) === bPlans + 1, 'B: the copy A made is a new plan here; nothing duplicated');

    // -------------------------------------------------------------------------------- camera refused
    await B.page.evaluate(() => (window.__cameraDenied = true));
    await B.page.evaluate(() => App.go('settings', { stab: 'storage' }));
    await B.page.getByRole('button', { name: 'Receive', exact: true }).click();
    await B.page.waitForFunction(() => /may not use the camera/.test(document.querySelector('[data-qr-message]').textContent));
    ok(true, 'B: camera refused: says how to allow it');

    // ------------------------------------------------------------------- the file to hand out, from disk
    const F = await browser.newContext();
    const page = await F.newPage();
    page.on('pageerror', e => errors.push(`file PAGEERR ${e.message}`));
    const violations = [];
    page.on('console', m => /Content Security Policy/.test(m.text()) && violations.push(m.text()));
    await page.goto('file://' + path.join(DIST, 'runway-money-planner.html'));
    const offline = await page.evaluate(async () => {
      const { drawFrame } = await loadQr('encode');
      const { decode } = await loadQr('decode');
      const c = document.createElement('canvas');
      drawFrame(c, 'RW1:abcdef:1:1:00000000:hello', { size: 300 });
      return decode(c.getContext('2d').getImageData(0, 0, c.width, c.height));
    });
    ok(offline === 'RW1:abcdef:1:1:00000000:hello', 'file://: the embedded QR maker and reader load and work (no network, no other file)');
    const embeddedTexts = await page.evaluate(async () => (await I18N.loadTexts()).keys.length);
    ok(embeddedTexts > 1000, `file://: the texts to translate are inside it too (${embeddedTexts})`);
    ok(violations.length === 0, 'file://: no security policy violation' + (violations.length ? ': ' + violations.join(' | ') : ''));
    await F.close();

    ok(errors.length === 0, 'no errors in the pages' + (errors.length ? ': ' + errors.join(' | ') : ''));
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
