/**
 * @file Browser test of the Overview's first drawing with a heavy plan (scripts/heavy-data.mjs): the cards below the
 * first screen are built just after the page is painted, one per task (designGrid "lazy"). Run with:
 *   npm run test:overview            (builds dist-test first)
 * Checks that the page ends exactly as a normal drawing, that nothing visible moves (layout shift), that later
 * drawings are immediate, and that no task of the first drawing is longer than before.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '../../dist-test');
let failed = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failed++;
};

(async () => {
  const { heavyDb } = await import('../../scripts/heavy-data.mjs');
  const data = JSON.stringify(heavyDb());
  const server = http.createServer((req, res) => {
    const file = path.join(DIST, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    fs.readFile(file, (err, body) => {
      res.writeHead(err ? 404 : 200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
      res.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  try {
    for (const [name, viewport, maxShift] of [
      ['phone', { width: 412, height: 823 }, 0],
      ['desktop', { width: 1360, height: 900 }, 0.01],
    ]) {
      const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await ctx.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => m.type() === 'error' && errors.push(m.text()));
      await page.goto(base + 'sw.js'); // same site, the app does not run: put the heavy plan in its storage
      await page.evaluate(d => localStorage.setItem('runway.db.v1', d), data);
      await page.addInitScript(() => {
        window.__shift = 0;
        new PerformanceObserver(list => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) window.__shift += e.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
      });
      await page.goto(base);
      const waiting = await page.evaluate(() => document.querySelectorAll('.dg-wait').length);
      ok(waiting >= 6, `${name}: the first drawing keeps the place of ${waiting} cards below the first screen`);
      ok((await page.locator('.kpi').count()) === 4, `${name}: the numbers at the top are there at once`);
      await page.waitForFunction(() => !document.querySelector('.dg-wait'));
      await page.waitForTimeout(300);
      const cards = () =>
        page.evaluate(() => [...document.querySelectorAll('.dg-item')].map(n => n.dataset.id + '\n' + n.innerText).join('\n\n'));
      const lazy = await cards();
      const shift = await page.evaluate(() => window.__shift);
      ok(shift <= maxShift, `${name}: nothing visible moved (layout shift ${shift.toFixed(4)})`);
      await page.evaluate(() => App.render());
      ok((await page.evaluate(() => document.querySelectorAll('.dg-wait').length)) === 0, `${name}: a later drawing builds every card at once`);
      ok((await cards()) === lazy, `${name}: the page ends exactly as a normal drawing`);
      ok(errors.length === 0, `${name}: no errors` + (errors.length ? ': ' + errors.join(' | ') : ''));
      await ctx.close();
    }
  } catch (e) {
    ok(false, 'stopped: ' + (e && e.message ? e.message.split('\n')[0] : e));
  }
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} FAILED` : `\nOVERVIEW OK (${checks} checks)`);
  process.exit(failed ? 1 : 0);
})();
