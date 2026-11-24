// Accessibility in a browser: keyboard (skip link, Tab order, tabs, rows, the calendar grid, dialogs), screen readers
// (names, titles, language, no controls hidden inside other controls, nothing faded below WCAG AA) and touch screens
// (Android, iOS: target sizes, fields that do not make iOS zoom, pinch zoom allowed).
// Run with: npm run test:ui (needs only the sample plan; the clock is fixed). No extra dependency.
const path = require('path');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.resolve(__dirname, '../../dist-test/index.html');

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
  const open = async (options = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, ...options });
    const pg = await ctx.newPage();
    pg.setDefaultTimeout(5000);
    pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    await pg.clock.setFixedTime(new Date('2026-11-05T10:00:00'));
    await pg.goto(PAGE);
    await pg.getByText('Look around with a sample plan').click();
    await pg.waitForTimeout(300);
    return pg;
  };
  const VIEWS = ['overview', 'months', 'forecast', 'review', 'audit', 'accounts', 'recurring', 'subs', 'items', 'agenda', 'trips', 'wishes', 'goals', 'loans', 'tools', 'settings'];

  /* ---------- keyboard ---------- */
  const pg = await open();
  ok((await pg.evaluate(() => document.documentElement.lang)) === 'en', 'the page says its language');
  ok(!/user-scalable\s*=\s*no|maximum-scale/.test(await pg.evaluate(() => document.querySelector('meta[name=viewport]').content)), 'pinch zoom is allowed (Android, iOS)');
  ok((await pg.title()) === 'Overview · Runway', 'the tab is named after the page');
  // a fresh page: Tab starts from the top
  await pg.reload();
  await pg.waitForSelector('#main h1');
  await pg.keyboard.press('Tab');
  ok((await pg.evaluate(() => document.activeElement.className)) === 'skip', 'the first Tab stop is "Skip to the content"');
  ok(await pg.evaluate(() => getComputedStyle(document.activeElement).transform === 'none'), 'and it shows when it has the focus');
  await pg.keyboard.press('Enter');
  ok((await pg.evaluate(() => document.activeElement.id)) === 'main', 'it goes to the content');

  // opening a page from the menu: its title, and the focus on it
  await pg.locator('#side .navi[data-view="months"]').focus();
  await pg.keyboard.press('Enter');
  ok((await pg.title()) === 'Month planner · Runway', 'a page opened from the menu names the tab');
  ok(await pg.evaluate(() => document.activeElement.tagName === 'H1'), 'and the focus goes to its title, where a screen reader starts reading');

  // the months are tabs: one Tab stop, arrow keys
  const tabs = pg.locator('.strip [role="tablist"] [role="tab"]');
  ok((await pg.locator('.strip [role="tab"][tabindex="0"]').count()) === 1, 'the month tabs are one Tab stop');
  ok((await pg.locator('.strip [role="tablist"] button:not([role="tab"])').count()) === 0, '"+ Month" is next to the tab list, not a tab in it');
  const first = await tabs.first().getAttribute('aria-selected');
  await pg.locator('.strip [role="tab"][aria-selected="true"]').focus();
  await pg.keyboard.press('ArrowRight');
  ok(first === 'true' && (await tabs.nth(1).getAttribute('aria-selected')) === 'true', 'ArrowRight chooses the next month');
  ok(await pg.evaluate(() => document.activeElement.getAttribute('aria-selected') === 'true'), 'and keeps the focus on it');
  await pg.keyboard.press('Home');
  ok((await tabs.first().getAttribute('aria-selected')) === 'true', 'Home goes to the first month');

  // a row: its title is a button, the controls inside are separate
  const row = pg.locator('.row.click').filter({ has: pg.locator('.check') }).first();
  const go = row.locator('.row-go');
  ok((await go.count()) === 1 && (await go.evaluate(el => el.tagName)) === 'BUTTON', 'a row that opens something has a real button');
  await go.focus();
  ok(await row.evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), 'the whole row shows the focus');
  await pg.keyboard.press('Shift+Tab');
  ok(await pg.evaluate(() => document.activeElement.classList.contains('check')), 'the tick box before it is a Tab stop of its own (Shift+Tab)');
  await go.focus();
  await pg.keyboard.press('Enter');
  const dlg = pg.locator('dialog[open]');
  ok((await dlg.count()) === 1, 'Enter opens it');
  const dialogName = await dlg.evaluate(d => document.getElementById(d.getAttribute('aria-labelledby'))?.textContent);
  ok(!!dialogName && dialogName === (await dlg.locator('h2').textContent()), 'the window is named by its title: ' + dialogName);
  await pg.keyboard.press('Escape');
  // a click anywhere on the row still opens it
  const box = await row.boundingBox();
  await pg.mouse.click(box.x + box.width * 0.55, box.y + box.height / 2);
  ok((await pg.locator('dialog[open]').count()) === 1, 'a click anywhere on the row still opens it');
  await pg.keyboard.press('Escape');

  // the calendar grid: arrow keys, Enter, the menu key
  await pg.evaluate(() => {
    UI.mview = 'calendar';
    App.go('months', { month: null });
  });
  await pg.locator('[data-cal="months"] .cal-d[tabindex="0"]').focus();
  const d0 = await pg.evaluate(() => +document.activeElement.dataset.day);
  await pg.keyboard.press('ArrowDown');
  ok((await pg.evaluate(() => +document.activeElement.dataset.day)) === d0 + 7, 'arrow keys move between the days of the calendar');
  await pg.keyboard.press('Shift+F10');
  ok((await pg.locator('.mpop.menu').count()) === 1, 'Shift+F10 opens the day’s menu (no mouse needed to add something)');
  await pg.keyboard.press('Escape');

  /* ---------- screen readers ---------- */
  const problems = [];
  for (const v of VIEWS) {
    await pg.evaluate(v => {
      UI.mview = 'list';
      App.go(v);
    }, v);
    await pg.waitForTimeout(120);
    const found = await pg.evaluate(() => {
      const out = [];
      const focusable = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
      // a control inside another control is hidden from screen readers
      for (const el of document.querySelectorAll('#main [role="button"], #main button')) {
        if (el.querySelector(focusable)) {
          out.push('nested: ' + el.outerHTML.slice(0, 80));
        }
      }
      // every button and field has a name
      for (const el of document.querySelectorAll('#main button, #main input:not([type=hidden]), #main select')) {
        const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute('placeholder') || '').trim();
        if (!name && !el.getAttribute('aria-labelledby')) {
          out.push('no name: ' + el.outerHTML.slice(0, 80));
        }
      }
      // nothing with text in it is faded below AA by opacity (quiet things are quiet by colour)
      for (const el of document.querySelectorAll('#main .cal-e.done, #main .cal-d.out, #main tr.dim td, #main .grp-n, #main .row.off, #main .card.off, #main .legend button')) {
        if (+getComputedStyle(el).opacity < 0.99 && el.textContent.trim()) {
          out.push('faded text: ' + el.className);
        }
      }
      return out;
    });
    problems.push(...found.map(p => v + ': ' + p));
  }
  ok(!problems.length, 'on every page: no control inside another, every control named, no text faded by opacity' + (problems.length ? '\n  ' + problems.slice(0, 8).join('\n  ') : ''));
  ok((await pg.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--faint').trim())) === '#5f6978', 'faint text has the AA colour');
  await pg.context().close();

  /* ---------- touch screens: Android and iOS ---------- */
  const phone = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  ok(await phone.evaluate(() => matchMedia('(pointer: coarse)').matches), 'a phone has a coarse pointer');
  const small = [];
  for (const v of ['overview', 'months', 'agenda', 'forecast', 'trips', 'wishes', 'goals', 'items']) {
    await phone.evaluate(v => App.go(v), v);
    await phone.waitForTimeout(120);
    small.push(
      ...(await phone.evaluate(v => {
        const out = [];
        const size = el => el.getBoundingClientRect();
        for (const el of document.querySelectorAll('.btn.icon, .logobtn')) {
          const r = size(el);
          if (r.width && (r.width < 44 || r.height < 44)) out.push(`${v}: ${el.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
        for (const el of document.querySelectorAll('input.inp, select.inp, textarea.inp')) {
          if (parseFloat(getComputedStyle(el).fontSize) < 16) out.push(`${v}: field text under 16 px (iOS zooms in)`);
        }
        for (const el of document.querySelectorAll('.check')) {
          const r = size(el);
          if (r.width && r.width < 24) out.push(`${v}: tick box ${Math.round(r.width)} px`);
        }
        return out;
      }, v)),
    );
  }
  ok(!small.length, 'icon buttons are at least 44 px, tick boxes at least 24 px, fields at least 16 px (iOS keeps its zoom)' + (small.length ? '\n  ' + small.slice(0, 8).join('\n  ') : ''));
  // iOS has no long press menu: everything a right click does can also be reached by a button
  await phone.evaluate(() => App.go('agenda'));
  await phone.locator('[data-cal="agenda"] .cal-d[data-day]').nth(12).click();
  await phone.waitForTimeout(350);
  ok((await phone.locator('.sheet').getByRole('button', { name: 'Add' }).count()) === 1, 'on a phone, a day’s "Add" menu is a button (no long press needed, as on iOS)');
  ok((await phone.locator('.sheet').getAttribute('aria-modal')) === 'true' && !!(await phone.locator('.sheet').getAttribute('aria-label')), 'the day sheet is a named dialog');
  await phone.keyboard.press('Escape');
  await phone.context().close();

  console.log(errs.length ? errs.join('\n') : `A11Y UI OK (${passed} checks)`);
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
