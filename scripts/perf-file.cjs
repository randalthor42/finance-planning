/**
 * @file How much main-thread time the data file adds to a change, on a heavy plan, CPU slowed down like a mid-range
 * phone. Run on the test build: node scripts/perf-file.cjs [cpu slowdown, default 4] [page, default dist-test/index.html]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const throttle = +(process.argv[2] || 4);
const build = process.argv[3] || path.resolve(__dirname, '../dist-test/index.html');
(async () => {
  const html = fs.readFileSync(build);
  const server = http.createServer((q, r) => r.end(html));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('perf.json', { create: true });
    window.showOpenFilePicker = async () => [await (await navigator.storage.getDirectory()).getFileHandle('perf.json')];
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => {
    for (const name of ['A', 'B', 'C']) {
      const p = normPlan(samplePlan());
      p.name = name;
      p.settings.horizon = 120;
      p.items = Array.from({ length: 2400 }, (_, i) => ({ id: 'h' + i, name: 'Spend ' + i, amount: 5 + (i % 50), kind: 'out', date: `2027-01-${String(1 + (i % 27)).padStart(2, '0')}`, cat: 'food' }));
      delete p.id;
      Store.addPlan(p, false);
    }
    Store.switchTo(Object.keys(Store.db.plans)[0]);
  });
  const withFile = await page.evaluate(() => typeof Sync !== 'undefined');
  if (withFile) {
    await page.evaluate(() => Sync.linkNew());
    await page.waitForFunction(() => Sync.status === 'ok');
  }
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  if (!withFile) {
    // a build without the data file (the baseline): only the change and the save
    const r = await page.evaluate(() => {
      const N = 12;
      let commit = 0;
      let flush = 0;
      let k = 0;
      for (let i = 0; i < N; i++) {
        let s = performance.now();
        Store.commit(p => { p.settings.cushion = ++k; }, 'x');
        commit += performance.now() - s;
        s = performance.now();
        Store.flush();
        flush += performance.now() - s;
      }
      return { commit: commit / N, flush: flush / N };
    });
    console.log(`CPU ${throttle}x slower (build without the data file)`);
    console.log('change (commit, incl. projection)   ' + r.commit.toFixed(1).padStart(6) + ' ms');
    console.log('save to this browser (flush)        ' + r.flush.toFixed(1).padStart(6) + ' ms');
    await browser.close();
    server.close();
    return;
  }
  const r = await page.evaluate(async () => {
    const N = 12;
    const t = { commit: 0, flush: 0, fileBefore: 0, fileAfter: 0, fileMs: 0 };
    const wrap = (name, key) => {
      const fn = Sync[name].bind(Sync);
      Sync[name] = (...a) => {
        const s = performance.now();
        const out = fn(...a);
        t[key] += performance.now() - s;
        return out;
      };
    };
    wrap('setBase', 'fileAfter');
    wrap('settle', 'fileAfter');
    let k = 0;
    for (let i = 0; i < N; i++) {
      let s = performance.now();
      Store.commit(p => { p.settings.cushion = ++k; }, 'x');
      t.commit += performance.now() - s;
      s = performance.now();
      Store.flush();
      t.flush += performance.now() - s;
      clearTimeout(Sync.timer); // write now, and time its parts
      Sync.timer = 0;
      const gen = Sync.gen;
      const w0 = performance.now();
      s = performance.now();
      const p = Sync.run(async () => {
        const before = performance.now(); // the chain starts here (stat + compare + encode until the first await)
        await Sync.push(gen);
        return before;
      });
      await p;
      t.fileMs += performance.now() - w0;
    }
    // the synchronous part of push (read texts, compare, clocks, encode) measured apart
    Store.commit(p => { p.settings.cushion = ++k; }, 'x');
    Store.flush();
    clearTimeout(Sync.timer);
    Sync.timer = 0;
    let s = performance.now();
    const list = Store.planList();
    const v = localVersions({ me: Sync.device, base: Sync.base, local: list, deleted: Sync.deleted, hash: Sync.hash });
    encodeDataFile(list.map(p => p.text), { versions: v.versions, deleted: v.deleted });
    t.fileBefore = performance.now() - s;
    await Sync.run(gen => Sync.push(gen));
    s = performance.now();
    Sync.flushMeta();
    const meta = performance.now() - s;
    return { commit: t.commit / N, flush: t.flush / N, fileBefore: t.fileBefore, fileAfter: t.fileAfter / N, wall: t.fileMs / N, meta, chars: Store.dbText().length };
  });
  const f = n => n.toFixed(1).padStart(6) + ' ms';
  console.log(`CPU ${throttle}x slower, ${(r.chars / 1e6).toFixed(2)} M characters of plans`);
  console.log('change (commit, incl. projection)   ' + f(r.commit));
  console.log('save to this browser (flush)        ' + f(r.flush));
  console.log('file: texts, clocks, file text      ' + f(r.fileBefore) + '   (main thread, per write)');
  console.log('file: record after the write        ' + f(r.fileAfter) + '   (main thread, per write)');
  console.log('file: whole write, wall clock       ' + f(r.wall) + '   (mostly the browser writing, off the main thread)');
  console.log('sync record, when idle (fingerprint)' + f(r.meta) + '   (once per quiet moment, not per change)');
  await browser.close();
  server.close();
})();
