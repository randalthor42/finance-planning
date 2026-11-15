// Browser tests for the calendars on the Overview (spending) and in the Month planner (Calendar mode). Run with: npm run test:ui
// Needs only the sample plan, no private fixtures. CHROMIUM=/path/to/chrome uses another browser than Playwright's own.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.resolve(__dirname, '../../dist-test/index.html');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const pg = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const errs = [];
  let passed = 0;
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  const ok = (c, m) => { if (!c) errs.push('FAIL ' + m); else { passed++; console.log('ok', m); } };
  const focusedDay = () => pg.evaluate(() => +document.activeElement.dataset.day);
  // the layout follows the width a frame or two after a resize: wait for it (up to 5 s) instead of a fixed pause
  const layoutOf = async (id, want) => {
    await pg.waitForFunction(([id, want]) => (document.querySelector(`[data-cal="${id}"]`) || {}).dataset?.mode === want, [id, want], { timeout: 5000 }).catch(() => {});
    return pg.locator(`[data-cal="${id}"]`).getAttribute('data-mode');
  };
  await pg.goto(PAGE);
  // the first time, the Overview calendar is drawn just after the page is painted (defer): catch the moment before
  await pg.evaluate(() => {
    window.__calSeen = null;
    new MutationObserver((list, obs) => {
      const cal = document.querySelector('[data-cal="overview"]');
      if (cal) {
        window.__calSeen = { children: cal.childElementCount, minHeight: parseInt(cal.style.minHeight) || 0 };
        obs.disconnect();
      }
    }).observe(document.getElementById('main'), { childList: true, subtree: true });
  });
  await pg.getByText('Look around with a sample plan').click();
  await pg.waitForSelector('[data-cal="overview"][data-mode]');
  const first = await pg.evaluate(() => { const m = Store.proj.months[0]; return { start: m.start, end: m.end, label: M.label(m.k, true) }; });
  const dayOf = label => pg.evaluate(l => Store.proj.months[0].entries.find(e => e.label === l).date, label);
  const rentDay = await dayOf('Rent');

  /* ================= Overview: spending calendar ================= */
  const ov = pg.locator('[data-cal="overview"]');
  const ovTitle = () => ov.locator('.cal-title b').textContent();
  ok(await ov.count() === 1, 'overview has a calendar');
  const seen = await pg.evaluate(() => window.__calSeen);
  ok(seen && seen.children === 0 && seen.minHeight > 500, 'its first drawing waits for the page to be painted, keeping its room meanwhile ' + JSON.stringify(seen));
  ok(await pg.evaluate(() => { App.render(); return document.querySelector('[data-cal="overview"]').childElementCount > 0; }), 'after that, redrawing the page draws it at once');
  ok(await ov.getAttribute('data-mode') === 'mini', 'the Overview shows the mini month (audit 6.6)');
  ok(await ovTitle() === first.label, 'opens on this month: ' + first.label);
  ok(await ov.locator('.cal-legend').count() === 0, 'the mini month has no legend');
  ok(JSON.stringify(await pg.evaluate(() => Store.db.calendar.overviewGroups)) === '["inc","bill","spend","trip","loan"]', 'by default it shows what is ahead: income, bills, planned one-offs, trips, loans');
  ok(await ov.locator('.cal-e', { hasText: 'Salary' }).count() === 0 && await ov.locator('.cal-e', { hasText: 'Emergency fund' }).count() === 0, 'no income or savings lines');
  const spent = await pg.evaluate(() => { const m = Store.proj.months[0]; return money(-m.entries.filter(e => e.amount < 0 && ['bill', 'loan', 'trip', 'wish', 'item'].includes(e.group) && !e.budget).reduce((s, e) => s + e.amount, 0)); });
  const sumText = await ov.locator('.cal-sum').textContent();
  ok(!/Money in|Net/.test(sumText) && sumText.includes(spent), 'summary is only Money out, and it adds up: ' + sumText + ' vs ' + spent);
  ok(await ov.locator(`.cal-d[data-day="${rentDay}"] .cal-v`).textContent() === '€820', 'each day shows what it costs');
  // change months
  ok(await ov.getByRole('button', { name: 'Previous month' }).isDisabled(), 'cannot page before the plan starts');
  await ov.getByRole('button', { name: 'Next month' }).click();
  const second = await ovTitle();
  ok(second !== first.label, 'next month: ' + second);
  ok(await ov.locator('.cal-e', { hasText: 'Rent' }).count() >= 1, 'the next month has its own spending');
  await pg.evaluate(() => App.render());
  ok(await ovTitle() === second, 'the month stays when the page redraws');
  await ov.getByRole('button', { name: 'Today' }).click();
  ok(await ovTitle() === first.label, 'Today goes back');
  // the day figure follows the legend filters
  const gymDay = await dayOf('Gym');
  const before = await ov.locator(`.cal-d[data-day="${gymDay}"] .cal-v`).textContent();
  await ov.locator('.cal-lg', { hasText: 'Bills' }).click();
  ok(await ov.locator(`.cal-d[data-day="${gymDay}"] .cal-v`).count() === 0 && !!before, 'hiding Bills takes them out of the day total (' + before + ')');
  await ov.locator('.cal-lg', { hasText: 'Bills' }).click();
  // a day, a line, a new spend
  await ov.locator(`.cal-d[data-day="${rentDay}"]`).locator('.cal-n').click();
  ok(await ov.locator('.cal-panel .row .t', { hasText: 'Rent' }).count() === 1, 'choosing a day lists its lines');
  const quick = await pg.evaluate(d => {
    const cal = document.querySelector('[data-cal="overview"]');
    const grid = cal.querySelector('.cal-grid');
    const cell = cal.querySelector(`.cal-d[data-day="${d + 1}"]`);
    cell.focus();
    cell.click();
    const out = { sameGrid: cal.querySelector('.cal-grid') === grid, focusKept: document.activeElement === cell, selected: cell.getAttribute('aria-selected'), oneSelected: cal.querySelectorAll('.cal-d.sel').length, tabStops: cal.querySelectorAll('.cal-d[tabindex="0"]').length };
    cal.querySelector('.cal-panel [aria-label="Close the day"]').focus();
    cal.querySelector('.cal-panel [aria-label="Close the day"]').click();
    out.closed = !cal.querySelector('.cal-panel') && cell.getAttribute('aria-selected') === 'false';
    out.focusBack = document.activeElement === cell;
    cal.querySelector(`.cal-d[data-day="${d}"]`).click();
    return out;
  }, rentDay);
  ok(quick.sameGrid && quick.focusKept && quick.selected === 'true' && quick.oneSelected === 1 && quick.tabStops === 1, 'choosing another day changes only that: same grid, focus kept, one day chosen ' + JSON.stringify(quick));
  ok(quick.closed && quick.focusBack, 'closing the day gives the focus back to the day');
  await ov.locator('.cal-panel .row', { hasText: 'Rent' }).click();
  ok(await pg.locator('dialog[open]').count() === 1, 'a line opens its window');
  await pg.keyboard.press('Escape');
  const free = first.start + 20;
  await ov.locator(`.cal-d[data-day="${free}"]`).hover();
  await ov.locator(`.cal-d[data-day="${free}"] .cal-add`).click();
  ok(await ov.locator('.cal-add').count() === 1 && await ov.locator(`.cal-d[data-day="${free}"] .cal-add`).count() === 1, 'one "+", on the day under the pointer');
  await ov.locator(`.cal-d[data-day="${free + 1}"]`).hover();
  ok(await ov.locator('.cal-add').count() === 1 && await ov.locator(`.cal-d[data-day="${free + 1}"] .cal-add`).getAttribute('aria-label') === 'Add something on ' + (await pg.evaluate(d => D.label(d), free + 1)), 'it moves to the next day, with that day in its label');
  await ov.locator('.cal-d.out').last().hover();
  ok(await ov.locator('.cal-add').count() === 0, 'no "+" on a day of another month');
  await ov.locator(`.cal-d[data-day="${free}"]`).hover();
  // "+" opens what can be added on that day
  ok(await pg.locator('.mpop.menu button', { hasText: 'Add an expense' }).count() === 1, '"+" opens the add menu');
  await pg.locator('.mpop.menu button', { hasText: 'Add an expense' }).click();
  await pg.getByPlaceholder('Water, trousers, concert tickets…').fill('Cal test');
  await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('12');
  await pg.locator('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  ok(await pg.evaluate(d => (Store.plan.items.find(i => i.name === 'Cal test') || {}).date === D.key(d), free), 'an expense added with "+" is dated that day');
  ok(await ov.locator(`.cal-d[data-day="${free}"] .cal-e`, { hasText: 'Cal test' }).count() === 1 && await ov.locator(`.cal-d[data-day="${free}"] .cal-v`).textContent() === '€12', 'and it shows there with its total');
  await ov.screenshot({ path: path.join(SHOTS, 'cal-overview.png') });

  /* ================= Month planner: Calendar mode ================= */
  await pg.evaluate(() => { UI.calendars.months = undefined; delete UI.calendars.months; App.go('months', { month: null }); });
  await pg.getByRole('button', { name: 'Calendar', exact: true }).click();
  const mc = pg.locator('[data-cal="months"]');
  const gridLabel = () => mc.locator('.cal-grid').getAttribute('aria-label');
  ok(await mc.count() === 1 && await pg.evaluate(() => UI.mview) === 'calendar', 'Calendar is a view mode of the planner');
  ok(await mc.locator('.cal-head').count() === 0, 'no second month header: the planner has its own');
  ok(await gridLabel() === first.label, 'shows the planner month');
  ok(await pg.locator('.cols.lead.cal-view').count() === 1, 'the month card takes the whole width');
  ok(await mc.locator('.cal-undated', { hasText: 'Groceries' }).count() === 1, 'budgets are under "No fixed day"');
  // the strip moves the calendar
  await pg.locator('.strip button').nth(2).click();
  const third = await pg.evaluate(() => M.label(Store.proj.summary.s0 + 2, true));
  ok(await gridLabel() === third, 'the month strip moves the calendar: ' + third);
  ok(await pg.evaluate(() => UI.mview) === 'calendar', 'and it stays in Calendar mode');
  await pg.getByRole('button', { name: 'This month', exact: true }).click();
  ok(await gridLabel() === first.label, '"This month" brings it back');
  // arrow keys move between days, not between months (the planner's own ← → must not fire too)
  await mc.locator(`.cal-d[data-day="${rentDay}"]`).focus();
  await pg.keyboard.press('ArrowRight');
  ok(await focusedDay() === rentDay + 1 && await gridLabel() === first.label, 'ArrowRight moves one day and keeps the month');
  // paging in the grid moves the planner, and the focus follows into the redrawn page
  await pg.keyboard.press('PageDown');
  const next = await pg.evaluate(() => M.label(Store.proj.summary.s0 + 1, true));
  ok(await gridLabel() === next && await pg.evaluate(() => UI.month === Store.proj.summary.s0 + 1), 'PageDown moves the planner to ' + next);
  ok(await pg.locator('.strip button.sel b').textContent() === await pg.evaluate(() => M.label(Store.proj.summary.s0 + 1)), 'the strip follows');
  ok(await pg.evaluate(() => document.activeElement.closest('[data-cal="months"]') !== null && document.activeElement.classList.contains('cal-d')), 'focus stays on a day after the page redraws');
  await pg.keyboard.press('PageUp');
  ok(await gridLabel() === first.label, 'PageUp back');
  // a day of the next month in the grid opens that month with the day chosen
  const outside = first.end + 1;
  await mc.locator(`.cal-d[data-day="${outside}"]`).locator('.cal-n').click();
  ok(await gridLabel() === next && await mc.locator('.cal-panel').count() === 1 && await mc.locator(`.cal-d[data-day="${outside}"]`).getAttribute('aria-selected') === 'true', 'clicking a day of the next month opens it, chosen');
  // a month chosen elsewhere forgets the chosen day
  await pg.locator('.strip button').nth(0).click();
  ok(await mc.locator('.cal-panel').count() === 0, 'changing month with the strip closes the day');
  // a line opens the same window as in the list
  await mc.locator('.cal-grid .cal-e', { hasText: 'Rent' }).first().click();
  ok(await pg.locator('dialog[open]').count() === 1, 'a line opens its window');
  await pg.keyboard.press('Escape');
  // the month equation and the last day of the grid agree
  const endText = await pg.locator('.meq-t.total .v').textContent();
  ok(await mc.locator(`.cal-d[data-day="${first.end}"] .cal-v`).textContent() === endText, 'last day of the grid = month-end balance: ' + endText);
  // trips with dates are bars in the planner too
  await pg.evaluate(s => Actions.save('trips', { ...Store.plan.trips[0], from: D.key(s + 8), to: D.key(s + 12) }), first.start);
  ok(await mc.locator('.cal-span').count() === 5 && await mc.locator('.cal-span.s', { hasText: 'Lisbon' }).count() === 1, 'a trip with dates is a bar over its 5 days');
  await pg.screenshot({ path: path.join(SHOTS, 'cal-planner.png'), fullPage: true });
  // the other two modes still work
  await pg.getByRole('button', { name: 'By type', exact: true }).click();
  ok(await pg.locator('.grp-toggle').count() > 0 && await pg.locator('[data-cal="months"]').count() === 0 && await pg.locator('.cal-view').count() === 0, 'By type still works');
  await pg.getByRole('button', { name: 'Day by day', exact: true }).click();
  ok(await pg.locator('.day').count() >= 28, 'Day by day still works');

  /* ================= context menus: add, tick off, skip, copy, delete ================= */
  await pg.evaluate(() => { UI.mview = 'calendar'; App.go('months', { month: null }); });
  const menu = () => pg.locator('.mpop.menu button').allTextContents();
  const pick = label => pg.locator('.mpop.menu button', { hasText: label }).first().click();
  const chip = t => mc.locator('.cal-e', { hasText: t }).first();
  const undo = () => pg.locator('#toasts').getByRole('button', { name: 'Undo' }).last().click();
  const entry = label => pg.evaluate(l => { const e = Store.proj.months[0].entries.find(x => x.label === l); return e ? { amount: e.amount, paid: e.paid, skipped: !!e.skipped } : null; }, label);
  // a line: the menu fits what it is
  await chip('Rent').click({ button: 'right' });
  ok(JSON.stringify(await menu()) === JSON.stringify(['Edit', 'Mark as paid', 'Skip this month', 'Delete']), 'a bill: ' + (await menu()).join(' | '));
  ok(await pg.locator('.mpop.menu button.danger').count() === 1, 'deleting is drawn red');
  await pick('Mark as paid');
  ok((await entry('Rent')).paid && await chip('Rent').evaluate(e => e.classList.contains('done')), 'Mark as paid ticks it off');
  await chip('Rent').click({ button: 'right' });
  ok((await menu()).includes('Mark as not paid'), 'and offers to untick it');
  await pick('Mark as not paid');
  ok(!(await entry('Rent')).paid, 'Mark as not paid');
  await chip('Rent').click({ button: 'right' });
  await pick('Skip this month');
  ok((await entry('Rent')).skipped && (await entry('Rent')).amount === 0, 'Skip this month sets it to 0 for this month only');
  ok(await pg.evaluate(() => Store.proj.months[1].entries.find(e => e.label === 'Rent').amount === -820), 'the next month keeps its rent');
  await chip('Rent').click({ button: 'right' });
  await pick('Back to usual');
  ok((await entry('Rent')).amount === -820, 'Back to usual');
  await chip('Salary').click({ button: 'right' });
  ok((await menu()).includes('Mark as received'), 'money in says "received"');
  await pg.keyboard.press('Escape');
  ok(await pg.locator('.mpop.menu').count() === 0, 'Escape closes the menu');
  await mc.locator('.cal-undated .cal-e', { hasText: 'Groceries' }).click({ button: 'right' });
  ok(JSON.stringify(await menu()) === JSON.stringify(['Edit', 'Log a spend', 'Close budget', 'Delete']), 'a budget: ' + (await menu()).join(' | '));
  await pg.keyboard.press('Escape');
  // delete a one-off at once, with Undo
  await chip('Supermarket').click({ button: 'right' });
  ok(JSON.stringify(await menu()) === JSON.stringify(['Edit', 'Copy', 'Delete']), 'a transaction: ' + (await menu()).join(' | '));
  await pick('Copy');
  const smDay = await pg.evaluate(() => D.parse(Store.plan.items.find(i => i.name === 'Supermarket').date));
  ok(await pg.evaluate(() => { const c = Store.plan.items.find(i => i.name === 'Supermarket copy'); return !!c && c.date === Store.plan.items.find(i => i.name === 'Supermarket').date; }), 'Copy adds "Supermarket copy" on the same day');
  ok(await mc.locator(`.cal-d[data-day="${smDay}"] .cal-e`, { hasText: 'Supermarket copy' }).count() === 1, 'and the calendar shows it there');
  // a copy is not a deletion, so its notification has no Undo (as on the Transactions page): Ctrl+Z takes it back
  await pg.locator('#main h1').click();
  await pg.keyboard.press('Control+z');
  ok(await pg.evaluate(() => !Store.plan.items.some(i => i.name === 'Supermarket copy') && Store.plan.items.some(i => i.name === 'Supermarket')), 'Ctrl+Z takes the copy back, and only the copy');
  // "Delete" is always just "Delete", and always asks first: what goes, from where, with Confirm and Cancel
  const dialog = pg.locator('dialog[open]');
  const asks = async (what, name, explains) => {
    await pick('Delete');
    const title = await dialog.locator('h2').first().textContent();
    const text = await dialog.locator('p').first().textContent();
    const buttons = await dialog.locator('.modal-f button').allTextContents();
    ok(title === `Delete “${name}”?` && explains.test(text) && JSON.stringify(buttons) === '["Cancel","Confirm"]', `${what}: "${title}" ${text} [${buttons.join(', ')}]`);
  };
  const deleteLabels = [];
  for (const t of ['Rent', 'Salary', 'Car loan', 'Emergency fund', 'Supermarket']) {
    await chip(t).click({ button: 'right' });
    deleteLabels.push(...(await menu()).filter(x => /delete/i.test(x)));
    await pg.keyboard.press('Escape');
  }
  ok(deleteLabels.length === 5 && deleteLabels.every(x => x === 'Delete'), 'every delete option reads just "Delete": ' + JSON.stringify(deleteLabels));
  // a spend from a budget: Cancel keeps it, Confirm deletes it, Undo brings it back
  await chip('Supermarket').click({ button: 'right' });
  await asks('a spend', 'Supermarket', /removed from your transactions and from the budget “Groceries”/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  ok(await dialog.count() === 0 && await pg.evaluate(() => Store.plan.items.some(i => i.name === 'Supermarket')), 'Cancel keeps it');
  await chip('Supermarket').click({ button: 'right' });
  await pick('Delete');
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  ok(await pg.evaluate(() => !Store.plan.items.some(i => i.name === 'Supermarket')) && await mc.locator('.cal-e', { hasText: 'Supermarket' }).count() === 0, 'Confirm removes the transaction from the plan and the calendar');
  await undo();
  ok(await pg.evaluate(() => Store.plan.items.filter(i => i.name === 'Supermarket').length) === 1 && await mc.locator('.cal-e', { hasText: 'Supermarket' }).count() === 1, 'Undo brings it back');
  // a recurring line: the question says it goes from every month
  await chip('Gym').click({ button: 'right' });
  await asks('a recurring bill', 'Gym', /deleted from every month of your plan, not only from November 2026/);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  ok(await pg.evaluate(() => !Store.plan.bills.some(x => x.name === 'Gym') && !Store.proj.months.some(m => m.entries.some(e => e.label === 'Gym'))), 'a recurring bill leaves every month');
  await undo();
  ok(await pg.evaluate(() => Store.plan.bills.some(x => x.name === 'Gym')), 'Undo brings the bill back');
  // a loan: the question names the loan and its payments, and it is asked once, not twice
  await chip('Car loan').click({ button: 'right' });
  await asks('a loan', 'Car loan', /The loan “Car loan” is deleted with all its payments, from every month/);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  ok(await dialog.count() === 0 && await pg.evaluate(() => !Store.plan.loans.some(l => l.name === 'Car loan') && !Store.proj.months.some(m => m.entries.some(e => e.label === 'Car loan'))), 'Confirm deletes the loan and its payments, with one question only');
  await undo();
  ok(await pg.evaluate(() => Store.plan.loans.some(l => l.name === 'Car loan')), 'Undo brings the loan back');
  // the rest say what they are
  await chip('Emergency fund').click({ button: 'right' });
  await asks('a savings goal', 'Emergency fund', /The savings goal “Emergency fund” is deleted with everything it puts aside/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await mc.locator('.cal-undated .cal-e', { hasText: 'Groceries' }).click({ button: 'right' });
  await asks('a budget', 'Groceries', /The budget “Groceries” is deleted from every month.*spends logged against it stay, as separate purchases/);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  ok(await pg.evaluate(() => { const i = Store.plan.items.find(x => x.name === 'Supermarket'); return !Store.plan.bills.some(b => b.name === 'Groceries') && !!i && i.budget === null; }), 'and it is true: the spends stay as separate purchases');
  await undo();

  // a day: what can be added there, in three sections
  const addDay = first.start + 17;
  const sections = () => pg.locator('.mpop.menu > *').evaluateAll(els => els.map(e => (e.tagName === 'BUTTON' ? '' : '# ') + e.textContent));
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  ok(JSON.stringify(await sections()) === JSON.stringify(['# On this day', 'Add an expense', 'Log a spend', 'Add income', '# Plans', 'Plan a trip', 'Plan an event', 'Add to wishlist', '# From this day on', 'Add a recurring bill', 'Add a subscription', 'Add a recurring income', 'Start a savings goal', 'Add a loan']), 'a day: ' + (await sections()).join(' | '));
  await pick('Add a recurring bill');
  await pg.locator('dialog[open] input').first().fill('Cal bill');
  await pg.locator('dialog[open] input[inputmode=decimal]').first().pressSequentially('30');
  await pg.locator('dialog[open]').getByRole('button', { name: 'Save', exact: true }).click();
  const calBill = await pg.evaluate(d => { const b = Store.plan.bills.find(x => x.name === 'Cal bill'); const onDay = Store.proj.months.slice(0, 3).map(m => (m.entries.find(e => e.label === 'Cal bill') || {}).date); return { day: b && b.day, from: b && b.from, dates: onDay.map(n => n && D.js(n).getUTCDate()), want: D.js(d).getUTCDate() }; }, addDay);
  ok(calBill.day === calBill.want && calBill.dates.every(x => x === calBill.want), 'a recurring bill from that day repeats on that day: ' + JSON.stringify(calBill));
  ok(await mc.locator(`.cal-d[data-day="${addDay}"] .cal-e`, { hasText: 'Cal bill' }).count() === 1, 'and shows on it');
  // a trip: the cell sets its first day and month; the last day is chosen in the window's date picker
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  await pick('Plan a trip');
  const dates = await dialog.locator('.fld.half .mbtn').allTextContents();
  ok(dates[0] === await pg.evaluate(d => D.label(d, { weekday: 'short', year: 'numeric' }), addDay) && dates[1] === 'Same day', 'trip window: first day set from the cell, last day left to choose: ' + JSON.stringify(dates));
  ok(await dialog.locator('.seg button[aria-pressed="true"]', { hasText: 'Trip' }).count() === 1, 'and its type is Trip');
  await pg.getByPlaceholder('Weekend in Lisbon, concert in Barcelona…').fill('Cal trip');
  await dialog.locator('.fld.half .mbtn').nth(1).click();
  ok(await pg.locator('.dpop-g button:disabled').count() > 0, 'the last-day picker does not allow days before the first day');
  await pg.locator('.dpop-g button:not(:disabled)', { hasText: new RegExp('^' + (await pg.evaluate(d => D.js(d + 3).getUTCDate(), addDay)) + '$') }).first().click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  const trip = await pg.evaluate(d => { const t = Store.plan.trips.find(x => x.name === 'Cal trip'); return t && { from: t.from === D.key(d), to: t.to === D.key(d + 3), month: t.month === M.key(Period.of(Store.plan.settings, d)), kind: t.kind }; }, addDay);
  ok(trip && trip.from && trip.to && trip.month && trip.kind === 'trip', 'the trip is saved from that day to the last day picked, in its month ' + JSON.stringify(trip));
  ok(await mc.locator('.cal-span', { hasText: 'Cal trip' }).count() === 1 && await mc.locator(`.cal-d[data-day="${addDay + 3}"] .cal-span.e`).count() === 1, 'and drawn as a bar over those four days');
  // an event: the same, as an event
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  await pick('Plan an event');
  await pg.getByPlaceholder('Weekend in Lisbon, concert in Barcelona…').fill('Cal event');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  ok(await pg.evaluate(d => { const t = Store.plan.trips.find(x => x.name === 'Cal event'); return !!t && t.kind === 'event' && t.from === D.key(d) && t.to === null; }, addDay), 'an event starts that day, with no last day unless one is picked');
  // a wish: planned for that month, so it shows on the calendar
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  await pick('Add to wishlist');
  await dialog.locator('input').first().fill('Cal wish');
  await dialog.locator('input[inputmode=decimal]').first().pressSequentially('40');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  ok(await pg.evaluate(k => { const w = Store.plan.wishes.find(x => x.name === 'Cal wish'); return !!w && w.on && !w.flex && w.month === M.key(k); }, await pg.evaluate(() => Store.proj.summary.s0)), 'a wish is planned for that month');
  ok(await mc.locator('.cal-undated .cal-e', { hasText: 'Cal wish' }).count() === 1, 'and shows in the month (a wish has no day)');
  await mc.locator('.cal-undated .cal-e', { hasText: 'Cal wish' }).click({ button: 'right' });
  await asks('a wish', 'Cal wish', /deleted from your wishlist and from every month it is planned in/);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  // a loan: its first payment is that month, on that day
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  await pick('Add a loan');
  await dialog.locator('input').first().fill('Cal loan');
  await dialog.locator('input[inputmode=decimal]').first().pressSequentially('1200');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  ok(await mc.locator(`.cal-d[data-day="${addDay}"] .cal-e`, { hasText: 'Cal loan' }).count() === 1, 'a loan added from a day has its first payment on that day');
  // subscription and savings goal open their windows with that month
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  await pick('Add a subscription');
  ok(await dialog.locator('h2').first().textContent() === 'Add subscription', 'Add a subscription opens the subscription window');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  await pick('Start a savings goal');
  ok(await dialog.locator('h2').first().textContent() === 'Add a savings goal' && (await dialog.locator('.mbtn').allTextContents()).includes('November 2026'), 'Start a savings goal starts that month');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await mc.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  await pick('Log a spend');
  await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('7');
  await pg.locator('dialog[open]').getByRole('button', { name: 'Save', exact: true }).click();
  const logged = await pg.evaluate(d => { const i = Store.plan.items.at(-1); return { date: i.date === D.key(d), budget: !!Store.plan.bills.find(b => b.id === i.budget && b.budget) }; }, addDay);
  ok(logged.date && logged.budget, 'Log a spend from the menu: dated that day, against a budget ' + JSON.stringify(logged));
  // deleting a trip from its bar asks too
  await mc.locator('.cal-span.s', { hasText: 'Cal trip' }).click({ button: 'right' });
  ok(JSON.stringify(await menu()) === '["Edit","Delete"]', 'a trip bar: Edit | Delete');
  await asks('a trip', 'Cal trip', /The trip “Cal trip” and all its costs are deleted/);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  ok(await pg.evaluate(() => !Store.plan.trips.some(t => t.name === 'Cal trip')) && await mc.locator('.cal-span', { hasText: 'Cal trip' }).count() === 0, 'Confirm deletes the trip');
  // outside the plan there is nothing to add to: the browser keeps its own menu
  await pg.locator('.strip button').nth(0).click();
  await mc.locator(`.cal-d[data-day="${first.start - 1}"] .cal-n`).click({ button: 'right' });
  ok(await pg.locator('.mpop.menu').count() === 0, 'no menu on a day before the plan starts');
  await pg.mouse.click(5, 5);
  // the keyboard: the menu key on a focused day, Enter on a line's ⋯ button
  await mc.locator(`.cal-d[data-day="${addDay}"]`).focus();
  await pg.keyboard.press('Shift+F10');
  ok(await pg.locator('.mpop.menu').count() === 1 && await pg.evaluate(() => document.activeElement.getAttribute('role') === 'menuitem'), 'Shift+F10 on a day opens its menu with the focus in it');
  await pg.keyboard.press('Escape');
  await mc.locator(`.cal-d[data-day="${rentDay}"] .cal-n`).click();
  const dots = mc.locator('.cal-panel .row', { hasText: 'Rent' }).getByRole('button', { name: 'Actions for Rent' });
  ok(await dots.count() === 1, 'each line in the day panel has a ⋯ button');
  await dots.focus();
  await pg.keyboard.press('Enter');
  ok((await menu()).includes('Skip this month') && await pg.evaluate(() => document.activeElement.getAttribute('role') === 'menuitem'), '⋯ opens the same menu, from the keyboard too');
  await pg.keyboard.press('Escape');
  await mc.getByRole('button', { name: 'Add', exact: true }).click();
  ok((await menu()).includes('Add an expense'), 'Add in the day panel opens the day menu');
  await pick('Add an expense');
  await pg.getByPlaceholder('Water, trousers, concert tickets…').fill('Menu test');
  await pg.locator('dialog input[inputmode=decimal]').first().pressSequentially('9');
  await pg.locator('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  ok(await pg.evaluate(d => (Store.plan.items.find(i => i.name === 'Menu test') || {}).date === D.key(d), rentDay), 'an expense added from the menu is dated that day');
  // where the grid shows dots, the day menu starts with a way to list the day
  await mc.locator('.cal-panel').getByRole('button', { name: 'Close the day' }).click();
  await pg.evaluate(() => { UI.calendars.months.mode = 'mini'; App.render(); });
  await mc.locator(`.cal-d[data-day="${rentDay}"]`).click({ button: 'right' });
  ok((await menu())[0] === 'Show this day', 'mini: "Show this day" first');
  await pg.keyboard.press('Escape');
  await pg.evaluate(() => { UI.calendars.months.mode = null; App.render(); });
  // the Overview: a spending calendar offers what it shows, and a way to the planner
  await pg.evaluate(() => App.go('overview'));
  await ov.locator(`.cal-d[data-day="${addDay}"] .cal-n`).click({ button: 'right' });
  const ovMenu = await menu();
  ok(!ovMenu.some(x => /income/i.test(x)) && ovMenu.includes('Add an expense') && ovMenu.at(-1) === 'Open the month', 'overview day menu: ' + ovMenu.join(' | '));
  await pick('Open the month');
  ok(await pg.evaluate(() => UI.view === 'months' && UI.month === Store.proj.summary.s0), '"Open the month" goes to the planner');
  await pg.evaluate(() => { UI.mview = 'list'; App.go('months', { month: null }); });

  /* balances equal "Day by day" for every kind of month */
  let compared = 0;
  let mismatches = 0;
  for (const [payDay, payFor] of [[25, 'next'], [15, 'same'], [0, 'same']]) {
    await pg.evaluate(([d, f]) => Store.commit(pl => { pl.settings.payDay = d; pl.settings.payFor = f; }, 'payday'), [payDay, payFor]);
    for (let i = 0; i < 3; i++) {
      const cal = await pg.evaluate(i => { const o = planCalendar(); const m = Store.proj.months[i]; const out = {}; for (let n = m.start; n <= m.end; n++) out[n] = o.dayInfo(n, 'full', []).text; return out; }, i);
      await pg.evaluate(i => { UI.mview = 'days'; App.go('months', { month: Store.proj.summary.s0 + i }); }, i);
      const planner = await pg.evaluate(i => { const m = Store.proj.months[i]; const days = [...document.querySelectorAll('.day')].filter(d => d.querySelector('.day-h b').textContent !== 'No fixed day'); const out = {}; days.forEach((d, j) => { const t = d.querySelector('.bal').textContent; if (t) out[m.start + j] = t; }); return out; }, i);
      for (const k of Object.keys(planner)) { compared++; if (planner[k] !== cal[k]) mismatches++; }
    }
  }
  ok(compared > 30 && mismatches === 0, `calendar balances = Day by day with three payday settings (${compared} days, ${mismatches} different)`);
  await pg.evaluate(() => Store.commit(pl => { pl.settings.payDay = 0; }, 'payday'));
  await pg.evaluate(() => { UI.mview = 'calendar'; App.go('months', { month: null }); });

  /* ================= tablets and phones ================= */
  // the page chooses the density when it is drawn: full from 768 px of window, compact below (audit 6.4)
  await pg.setViewportSize({ width: 820, height: 1000 });
  await pg.evaluate(() => { delete UI.calendars.months.mode; App.render(); });
  ok(await layoutOf('months', 'full') === 'full', 'planner: full at 820');
  await pg.setViewportSize({ width: 390, height: 800 });
  await pg.evaluate(() => App.render());
  ok(await layoutOf('months', 'mobile') === 'mobile', 'planner: compact (drawn as dots and an agenda) at 390');
  ok(await mc.locator('.cal-agenda .row').count() > 5, 'planner on a phone lists the month under the grid');
  ok(await mc.locator('.cal-agenda .tblmore').count() === 0, 'an ordinary month is listed whole, with no "Show more"');
  // a month with hundreds of lines lists whole days up to about 150 lines, then "Show 150 more"
  const paging = await pg.evaluate(() => {
    const k = M.parse('2026-03');
    const { start } = monthRange(k);
    const events = [];
    for (let d = 0; d < 31; d++) for (let j = 0; j < 13; j++) events.push({ id: d + '-' + j, title: 'Line ' + j, date: start + d, amount: -1 });
    const host = document.createElement('div');
    host.style.width = '360px';
    document.getElementById('main').append(host);
    const draw = () => host.replaceChildren(calendar({ id: 'paging', mode: 'compact', initial: k, events }));
    draw();
    const rows = () => host.querySelectorAll('.cal-agenda .row').length;
    const out = { total: events.length, first: rows(), more: host.querySelector('.tblmore')?.textContent };
    host.querySelector('.tblmore button').click();
    out.second = rows();
    out.keptOnRedraw = (draw(), rows());
    host.querySelector('[data-focus="next"]').click();
    host.querySelector('[data-focus="prev"]').click();
    out.afterPaging = rows();
    host.remove();
    return out;
  });
  ok(paging.first === 156 && /^Show 150 more156 of 403 lines$/.test(paging.more), 'a busy month shows whole days up to 150 lines: ' + JSON.stringify(paging));
  ok(paging.second === 312 && paging.keptOnRedraw === 312, '"Show 150 more" adds whole days, and stays when the page is redrawn');
  ok(paging.afterPaging === 156, 'another month starts from the first 150 again');
  const noise = () => pg.evaluate(() => ({ ov: document.documentElement.scrollWidth - innerWidth, bad: document.body.innerText.match(/undefined|NaN|\[object|null/g) }));
  let n1 = await noise();
  ok(n1.ov <= 1 && !n1.bad, 'planner on a phone: no sideways scroll, no broken text ' + JSON.stringify(n1));
  await pg.screenshot({ path: path.join(SHOTS, 'cal-planner-phone.png'), fullPage: true });
  await pg.evaluate(() => App.go('overview'));
  await ov.scrollIntoViewIfNeeded();
  ok(await layoutOf('overview', 'mini') === 'mini', 'overview: still the mini month at 390');
  ok(await ov.locator('.cal-agenda').count() === 0, 'overview on a phone stays short: no month list');
  // the day chosen earlier (Rent) is remembered for the visit; tap another one, then tap it again to close it
  await ov.locator(`.cal-d[data-day="${gymDay}"] .cal-n`).click();
  ok(await ov.locator('.cal-panel .row .t', { hasText: 'Gym' }).count() === 1, 'tapping a day shows its spending');
  await ov.locator(`.cal-d[data-day="${gymDay}"] .cal-n`).click();
  ok(await ov.locator('.cal-panel').count() === 0, 'tapping it again closes it');
  n1 = await noise();
  ok(n1.ov <= 1 && !n1.bad, 'overview on a phone: no sideways scroll, no broken text ' + JSON.stringify(n1));
  await pg.screenshot({ path: path.join(SHOTS, 'cal-overview-phone.png'), fullPage: true });
  await pg.setViewportSize({ width: 1440, height: 1000 });
  ok(await layoutOf('overview', 'full') === 'full', 'overview: back to full on a wide screen');

  /* ================= Settings › Calendar ================= */
  const settings = () => pg.evaluate(() => App.go('settings', { stab: 'calendar' }));
  const sw = label => pg.getByRole('checkbox', { name: label, exact: true });
  const segBtn = (group, label) => pg.getByRole('group', { name: group }).getByRole('button', { name: label, exact: true });
  const prefs = () => pg.evaluate(() => Store.db.calendar);
  const toPlanner = () => pg.evaluate(() => { UI.mview = 'calendar'; App.go('months', { month: null }); });
  const toOverview = () => pg.evaluate(() => App.go('overview'));
  const groupBtn = label => pg.getByRole('group', { name: 'What it shows' }).getByRole('button', { name: label, exact: true });
  await settings();
  ok(await pg.locator('.subnav [aria-selected="true"]').textContent() === 'Calendar', 'Settings has a Calendar subsection');
  // the switches match the menus exactly (one list in calendarData.js, one in the stored settings)
  ok(await pg.evaluate(() => JSON.stringify(addChoices().flatMap(s => s[1].map(c => c[0]))) === JSON.stringify(CAL_ADD) && JSON.stringify(lineChoices().map(c => c[0])) === JSON.stringify(CAL_LINE)), 'every menu option has its switch, in menu order');
  ok(await pg.locator('input[data-focus^="add:"]').count() === 11 && await pg.locator('input[data-focus^="line:"]').count() === 4, '11 add switches and 4 line switches');
  // week start
  await segBtn('Week starts on', 'Sunday').click();
  ok((await prefs()).weekStart === 0 && await pg.evaluate(() => document.activeElement.dataset.focus) === 'weekStart:0', 'Sunday is saved, and the focus stays on it');
  await toOverview();
  ok(await ov.locator('.cal-wdn').first().getAttribute('aria-label') === 'Sunday', 'the Overview week starts on Sunday');
  await toPlanner();
  ok(await mc.locator('.cal-wdn').first().getAttribute('aria-label') === 'Sunday' && await mc.locator('.cal-wdn').last().getAttribute('aria-label') === 'Saturday', 'so does the planner');
  await pg.reload();
  ok(await pg.evaluate(() => Store.db.calendar.weekStart) === 0, 'and it is kept after a reload');
  await settings();
  await segBtn('Week starts on', 'Monday').click();
  // a menu option switched off leaves the menus
  await sw('Add a loan').uncheck();
  await sw('Delete').uncheck();
  ok((await prefs()).add.loan === false && (await prefs()).line.delete === false && await pg.evaluate(() => document.activeElement.dataset.focus) === 'line:delete', 'switches are saved, and the focus stays on them');
  await toPlanner();
  await mc.locator(`.cal-d[data-day="${first.start + 17}"] .cal-n`).click({ button: 'right' });
  ok(!(await menu()).includes('Add a loan') && (await menu()).includes('Plan a trip'), 'Add a loan is gone from the day menu');
  await pg.keyboard.press('Escape');
  await chip('Rent').click({ button: 'right' });
  ok(!(await menu()).includes('Delete') && (await menu()).includes('Skip this month'), 'Delete is gone from the line menu');
  await pg.keyboard.press('Escape');
  // every add option off: no "+", no Add, no day menu
  await settings();
  for (const key of await pg.evaluate(() => CAL_ADD)) await pg.locator(`input[data-focus="add:${key}"]`).uncheck();
  await toPlanner();
  ok(await mc.locator('.cal-add').count() === 0, 'nothing to add: no "+" on the days');
  await mc.locator(`.cal-d[data-day="${first.start + 17}"] .cal-n`).click({ button: 'right' });
  ok(await pg.locator('.mpop.menu').count() === 0, 'and no day menu');
  await pg.keyboard.press('Escape');
  // menus off: no menus and no ⋯; "+" adds an expense straight away
  await settings();
  await pg.locator('input[data-focus="add:expense"]').check();
  await sw('Use context menus').uncheck();
  ok(await pg.locator('input[data-focus^="add:"]').count() === 0 && /adds an expense/.test(await pg.locator('.row.opt', { hasText: 'Use context menus' }).textContent()), 'with menus off their options are hidden, and the page says what "+" does');
  await toPlanner();
  await chip('Rent').click({ button: 'right' });
  ok(await pg.locator('.mpop.menu').count() === 0, 'menus off: a right click shows no calendar menu');
  await mc.locator(`.cal-d[data-day="${rentDay}"] .cal-n`).click();
  ok(await mc.locator('.cal-mbtn').count() === 0, 'and the lines have no ⋯ button');
  await mc.locator(`.cal-d[data-day="${first.start + 17}"]`).hover();
  await mc.locator(`.cal-d[data-day="${first.start + 17}"] .cal-add`).click();
  ok(await pg.locator('.mpop.menu').count() === 0 && await pg.getByPlaceholder('Water, trousers, concert tickets…').count() === 1, '"+" opens a new expense directly');
  await pg.keyboard.press('Escape');
  // the look of the grid
  await settings();
  await sw('Always six weeks').check();
  await segBtn('Lines per day', '1').click();
  await sw('Trips as bars').uncheck();
  await sw('Legend').uncheck();
  await pg.getByRole('group', { name: 'Number on each day' }).getByRole('button', { name: 'Spent that day', exact: true }).click();
  await toPlanner();
  ok(await mc.locator('.cal-grid > .cal-row').count() === 7, 'six weeks (and the weekday row)');
  const busiest = await mc.locator('.cal-d').evaluateAll(cells => Math.max(...cells.map(c => c.querySelectorAll('.cal-e:not(.cal-span):not(.cal-gap)').length)));
  ok(busiest === 1 && await mc.locator('.cal-more').count() > 0, 'one line per day, the rest behind "+N more"');
  ok(await mc.locator('.cal-span').count() === 0 && await pg.evaluate(() => Store.plan.trips.some(t => t.from)), 'trips with dates are not drawn as bars');
  ok(await mc.locator('.cal-legend').count() === 0, 'no legend');
  ok(await mc.getAttribute('data-mode') === 'full', 'the planner is drawn full on a wide screen');
  const spentThatDay = await pg.evaluate(d => money(-Store.proj.months[0].entries.filter(e => e.date === d && e.amount < 0).reduce((sum, e) => sum + e.amount, 0)), rentDay);
  ok(await mc.locator(`.cal-d[data-day="${rentDay}"] .cal-v`).textContent() === spentThatDay, 'and each day shows what went out: ' + spentThatDay);
  // the Overview calendar
  await settings();
  await groupBtn('Wishlist').click();
  ok((await prefs()).overviewGroups.includes('wish'), 'Wishlist added to the Overview');
  await toOverview();
  ok(await ov.getAttribute('data-mode') === 'mini', 'the Overview is always the mini month');
  ok(await pg.locator('section.card h2', { hasText: /^Calendar$/ }).count() === 1, 'it is called "Calendar"');
  ok(await ov.locator('.cal-d .cal-dot.cal-c-good').count() > 0, 'and income shows on it');
  await settings();
  for (const g of ['Income', 'Bills', 'Trips and events', 'Loans', 'Wishlist']) await groupBtn(g).click();
  ok(JSON.stringify((await prefs()).overviewGroups) === '["spend"]' && await groupBtn('Transactions').isDisabled(), 'the last group cannot be switched off');
  await sw('Show the calendar on the Overview').uncheck();
  ok(await pg.locator('.row.opt', { hasText: 'What it shows' }).count() === 0, 'Overview off: its options are hidden');
  await toOverview();
  ok(await pg.locator('[data-cal="overview"]').count() === 0, 'and the Overview has no calendar');
  // reset asks, then everything is back
  await settings();
  await pg.getByRole('button', { name: 'Reset', exact: true }).click();
  ok(await dialog.locator('h2').first().textContent() === 'Reset the calendar settings?', 'Reset asks first');
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  ok(await pg.evaluate(() => JSON.stringify(Store.db.calendar) === JSON.stringify(calendarDefaults())), 'Reset puts every setting back');
  await toOverview();
  ok(await pg.locator('[data-cal="overview"]').count() === 1 && await pg.locator('section.card h2', { hasText: /^Calendar$/ }).count() === 1, 'and the calendar is back');
  ok(!(await noise()).bad, 'no broken text after all that');

  console.log(`\n${passed} passed`);
  console.log(errs.length ? errs.join('\n') : 'CALENDAR OK');
  await b.close();
  if (errs.length) {
    process.exitCode = 1;
  }
})();
