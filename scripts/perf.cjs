/**
 * @file Performance probe (npm run perf). Builds nothing itself: run on the test build, which exposes the modules on window.
 *   npm run perf                      real plan (tests/fixtures/real.json), CPU slowed 4x like a mid-range phone
 *   node scripts/perf.cjs heavy 1 <backup.json> dist-test/index.html
 * Prints the measurements and exits with code 1 when a budget from the v0.9 audit (section 7.1) is exceeded.
 * Needs Playwright's Chromium once: npx playwright install chromium
 */
const { chromium } = require('playwright');
const fs = require('fs');
const mode = process.argv[2] || 'real';
const throttle = +(process.argv[3] || 1);
const backupFile = process.argv[4] || 'tests/fixtures/real.json';
const pageFile = process.argv[5] || 'dist-test/index.html';
const rawBackup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
const real = rawBackup.plans ? (Array.isArray(rawBackup.plans) ? rawBackup.plans[0] : Object.values(rawBackup.plans)[0]) : rawBackup;

function heavy(plan) {
  // a power user: 10-year horizon, 3 years of daily logging inside the plan, more bills, trips and wishes
  const p = JSON.parse(JSON.stringify(plan));
  p.settings.horizon = 120;
  const base = p.items.filter(i => i.date && i.kind === 'out');
  const items = [];
  let n = 0;
  for (let m = 0; m < 36; m++) {
    for (const it of base) {
      const d = new Date(Date.UTC(2026, 10 + m, 1 + (n % 27)));
      const key = d.toISOString().slice(0, 10);
      items.push({ ...it, id: 'h' + n++, date: key, month: key.slice(0, 7) });
    }
  }
  p.items = p.items.concat(items).slice(0, 2400);
  for (let i = 0; i < 25; i++) p.bills.push({ ...p.bills[2], id: 'hb' + i, name: 'Bill ' + i, day: 1 + (i % 28) });
  for (let i = 0; i < 12; i++) p.trips.push({ ...JSON.parse(JSON.stringify(p.trips[1])), id: 'ht' + i, name: 'Trip ' + i, month: `2027-${String(1 + (i % 12)).padStart(2, '0')}` });
  for (let i = 0; i < 10; i++) p.wishes.push({ ...p.wishes[3], id: 'hw' + i, name: 'Wish ' + i });
  return p;
}
const plan = mode === 'heavy' ? heavy(real) : real;

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (throttle > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.addInitScript(plan => {
    window.__firstPaint = null;
    new MutationObserver((list, obs) => {
      const main = document.getElementById('main');
      if (main && main.children.length && window.__firstPaint === null) {
        window.__firstPaint = performance.now();
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
    if (sessionStorage.getItem('s')) return;
    sessionStorage.setItem('s', '1');
    localStorage.setItem('runway.db.v1', JSON.stringify({ v: 6, active: plan.id, plans: { [plan.id]: plan }, theme: 'dark' }));
  }, plan);
  await page.goto('file://' + require('path').resolve(pageFile));
  await page.waitForTimeout(500);
  const res = await page.evaluate(() => {
    const med = a => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(2); };
    const time = (fn, n = 20) => { const t = []; for (let i = 0; i < n; i++) { const a = performance.now(); fn(); t.push(performance.now() - a); } return med(t); };
    const out = {};
    const nav = performance.getEntriesByType('navigation')[0];
    out.startup = { domContentLoaded: +nav.domContentLoadedEventEnd.toFixed(1), firstView: +(window.__firstPaint || 0).toFixed(1) };
    out.planSize = { items: Store.plan.items.length, bills: Store.plan.bills.length, months: Store.proj.months.length, entries: Store.proj.months.reduce((a, m) => a + m.entries.length, 0) };
    out.dbBytes = localStorage.getItem('runway.db.v1').length;
    out.project = time(() => project(Store.plan, { today: Store.day }), 50);
    out.normPlan = time(() => normPlan(JSON.parse(JSON.stringify(Store.plan))), 30);
    out.stringifyDb = time(() => JSON.stringify(Store.db), 30);
    out.saveLocalStorage = time(() => {
      Store.save();
      Store.flush();
    }, 30);
    const views = ['overview', 'months', 'forecast', 'review', 'audit', 'accounts', 'recurring', 'subs', 'items', 'trips', 'wishes', 'goals', 'loans', 'tools', 'settings'];
    out.render = {};
    out.nodes = {};
    for (const v of views) {
      UI.view = v;
      out.render[v] = time(() => App.render(), 8);
      out.nodes[v] = document.querySelectorAll('#main *').length;
    }
    UI.view = 'months'; UI.mview = 'days'; out.render['months:days'] = time(() => App.render(), 8); out.nodes['months:days'] = document.querySelectorAll('#main *').length; UI.mview = 'list';
    UI.view = 'forecast';
    for (const f of ['pace', 'trend', 'range']) { UI.ftab = f; out.render['forecast:' + f] = time(() => App.render(), 5); }
    UI.ftab = 'plan'; UI.auditScope = 'all'; UI.view = 'audit'; out.render['audit:all'] = time(() => App.render(), 5); out.nodes['audit:all'] = document.querySelectorAll('#main *').length; UI.auditScope = 'month';
    // one tick: the full commit pipeline (copy, normPlan, project, save) plus the redraw
    UI.view = 'months'; App.render();
    const m = Store.proj.months[0];
    const e = m.entries.find(x => x.group === 'bill' && !x.budget);
    out.tickCommitAndRender = time(() => { Actions.setPaid(m.key, { key: e.key, label: e.label, amount: e.amount, payTo: null, account: null }, !Store.proj.months[0].entries.find(x => x.key === e.key).paid); }, 10);
    out.undoStackKB = Math.round(Store.undoS.reduce((a, u) => a + u.snap.length, 0) / 1024);
    return out;
  });
  // typing in "Can I afford this?" on the Overview: time per keystroke
  await page.evaluate(() => { UI.view = 'overview'; App.render(); });
  const inp = await page.$('input[aria-label="Cost"]');
  if (inp) {
    await inp.click();
    const t0 = Date.now();
    await page.keyboard.type('123456', { delay: 0 });
    res.affordTyping6Keys_ms = Date.now() - t0;
  }
  console.log(JSON.stringify(res, null, 1));
  await b.close();
  // budgets from the audit, for the real plan at 4x CPU (heavy plans and 1x are printed but not judged)
  if (mode === 'real' && throttle >= 4) {
    const budgets = [
      ['project', res.project, 5],
      ['tick (commit + save + redraw)', res.tickCommitAndRender, 50],
      ['Overview render', res.render.overview, 50],
      ['Month planner render', res.render.months, 50],
      ['Wishlist render', res.render.wishes, 50],
      ['Trips render', res.render.trips, 50],
      ['Audit (whole plan)', res.render['audit:all'], 100],
    ];
    const over = budgets.filter(([, value, limit]) => value > limit);
    for (const [name, value, limit] of budgets) {
      console.log(`${value > limit ? 'OVER' : 'ok  '} ${name}: ${value} ms (budget ${limit} ms)`);
    }
    process.exitCode = over.length ? 1 : 0;
  }
})();
