// Browser tests for "My calendar" (Plans and goals): appointments, drafts and applying them, what of the plan it shows.
// Run with: npm run test:ui (needs only the sample plan). The clock is fixed on 5 November 2026, so the sample plan and
// every date below are the same on every run. CHROMIUM=/path/to/chrome uses another browser than Playwright's own.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.resolve(__dirname, '../../dist-test/index.html');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(5000);
  const errs = [];
  let passed = 0;
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => {
    if (m.type() === 'error') errs.push('CONSOLE ' + m.text());
  });
  const ok = (c, m) => {
    if (!c) errs.push('FAIL ' + m);
    else {
      passed++;
      console.log('ok', m);
    }
  };
  await pg.clock.setFixedTime(new Date('2026-11-05T10:00:00'));
  await pg.goto(PAGE);
  await pg.getByText('Look around with a sample plan').click();
  const cal = pg.locator('[data-cal="agenda"]');
  const dayN = s => pg.evaluate(s => D.parse(s), s);
  const cell = async s => cal.locator(`.cal-d[data-day="${await dayN(s)}"]`);
  const dialog = () => pg.locator('dialog[open]').last();
  const menuItem = name => pg.locator('.mpop.menu [role="menuitem"]', { hasText: name }).first();
  const countDrafts = () => pg.evaluate(() => Store.plan.agenda.drafts.items.length + Store.plan.agenda.drafts.trips.length);
  const fill = async (label, value) => dialog().locator('.fld', { hasText: label }).first().locator('input').first().fill(value);

  /* ---------- the page ---------- */
  const group = pg.locator('.navg', { hasText: 'Plans and goals' });
  ok((await group.locator('.navi').first().getAttribute('data-view')) === 'agenda', 'My calendar is the first page of Plans and goals');
  await group.locator('.navi[data-view="agenda"]').click();
  ok((await pg.locator('h1').textContent()) === 'My calendar', 'the page is called My calendar');
  await cal.waitFor();
  ok((await cal.getAttribute('data-mode')) === 'full', 'a wide screen shows the full month');
  ok((await cal.locator('.cal-title b').textContent()) === 'November 2026', 'it opens on this month');
  ok((await (await cell('2026-11-02')).locator('.cal-e', { hasText: 'Rent' }).count()) === 1, 'bills of the plan are shown');
  ok((await (await cell('2026-11-01')).locator('.cal-e', { hasText: 'Salary' }).count()) === 1, 'income is shown');
  ok((await cal.locator('.cal-e', { hasText: 'Supermarket' }).count()) === 0, 'spends logged against a budget are not, at first');
  ok((await cal.locator('.cal-e', { hasText: 'Emergency fund' }).count()) === 0, 'savings are not, at first');
  ok(await pg.evaluate(() => !document.querySelector('.agenda-drafts')), 'no drafts bar while there are no drafts');

  /* ---------- an appointment ---------- */
  const proj = await pg.evaluate(() => (window.__proj = Store.proj) && Store.rev);
  await (await cell('2026-11-10')).click({ button: 'right' });
  await menuItem('New appointment').click();
  ok((await dialog().locator('h2').textContent()) === 'New appointment', 'the day menu adds an appointment');
  await fill('What', 'Dentist');
  await dialog().locator('input[type="time"]').first().fill('09:30');
  await dialog().getByRole('button', { name: /^(Save|Done)$/ }).click();
  await dialog().waitFor({ state: 'detached' }).catch(() => {});
  const dentist = (await cell('2026-11-10')).locator('.cal-e', { hasText: 'Dentist' });
  ok((await dentist.count()) === 1, 'it shows on its day');
  ok((await dentist.locator('.cal-tm').textContent()) === '09:30', 'with its time');
  ok(
    await pg.evaluate(r => Store.proj === window.__proj && Store.rev === r, proj),
    'adding it did not work out the plan again (nothing that counts changed)',
  );
  ok(
    await pg.evaluate(() => Store.plan.agenda.entries[0].date === '2026-11-10' && Store.plan.agenda.entries[0].time === '09:30'),
    'it is saved in the plan',
  );
  await dentist.click();
  ok((await dialog().locator('h2').textContent()) === 'Edit appointment', 'a click opens it');
  await dialog().getByRole('button', { name: 'Close' }).click();

  /* ---------- repeats ---------- */
  await pg.evaluate(() => Actions.saveEntry({ id: 'swim0001', title: 'Swim', date: '2026-11-03', repeat: 'week' }));
  for (const d of ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24'])
    ok((await (await cell(d)).locator('.cal-e', { hasText: 'Swim' }).count()) === 1, 'a weekly appointment on ' + d);
  await (await cell('2026-11-17')).locator('.cal-e', { hasText: 'Swim' }).click({ button: 'right' });
  await menuItem('Delete only this day').click();
  ok((await (await cell('2026-11-17')).locator('.cal-e', { hasText: 'Swim' }).count()) === 0, 'one day can be left out');
  ok((await (await cell('2026-11-24')).locator('.cal-e', { hasText: 'Swim' }).count()) === 1, 'the other days stay');

  /* ---------- drafts ---------- */
  const itemsBefore = await pg.evaluate(() => Store.plan.items.length);
  const sumBefore = await cal.locator('.cal-sum').textContent();
  const endBefore = await pg.evaluate(() => Store.proj.summary.end);
  await (await cell('2026-11-20')).click({ button: 'right' });
  ok((await pg.locator('.mpop.menu .menu-h', { hasText: 'Draft' }).count()) === 1, 'the day menu has a section of drafts');
  await menuItem('Spending').click();
  ok(/draft/i.test(await dialog().locator('h2').textContent()), 'the window says it is a draft');
  await fill('Description', 'New TV');
  await dialog().locator('.fld', { hasText: 'Amount' }).first().locator('input').fill('800');
  await dialog().locator('button[type="submit"]').click();
  await dialog().waitFor({ state: 'detached' }).catch(() => {});
  const tv = (await cell('2026-11-20')).locator('.cal-e', { hasText: 'New TV' });
  ok((await tv.count()) === 1 && (await tv.getAttribute('class')).includes('tentative'), 'a draft shows as tentative on its day');
  ok((await pg.evaluate(() => Store.plan.items.length)) === itemsBefore, 'it is not in the plan');
  ok((await pg.evaluate(() => Store.proj.summary.end)) === endBefore, 'and changes no number');
  ok((await cal.locator('.cal-sum').textContent()) === sumBefore, 'not even the money in and out of the month shown');
  ok((await pg.locator('.agenda-drafts').textContent()).includes('1 draft'), 'the drafts bar counts it');

  await (await cell('2026-11-27')).click({ button: 'right' });
  await menuItem('Trip').click();
  await dialog().locator('input.inp').first().fill('Rome');
  await dialog().getByRole('button', { name: /^(Save|Done)$/ }).click();
  await dialog().waitFor({ state: 'detached' }).catch(() => {});
  ok((await countDrafts()) === 2, 'a trip can be a draft too');

  /* ---------- applying ---------- */
  await pg.locator('.agenda-drafts').getByRole('button', { name: 'Review and apply' }).click();
  const boxes = dialog().locator('.agenda-apply input[type="checkbox"]');
  ok((await boxes.count()) === 2, 'the review lists every draft');
  ok((await dialog().locator('.agenda-impact').textContent()).length > 10, 'and what they would change');
  await dialog().locator('.agenda-apply label', { hasText: 'Rome' }).locator('input').uncheck();
  const apply = dialog().getByRole('button', { name: /Add 1 to my plan/ });
  ok((await apply.count()) === 1, 'the button says how many are applied');
  await apply.click();
  ok((await pg.evaluate(() => Store.plan.items.length)) === itemsBefore + 1, 'the chosen draft is in the plan');
  ok((await pg.evaluate(() => Store.proj.summary.end)) === endBefore - 800, 'and counts in every number');
  ok((await countDrafts()) === 1, 'the other one is still a draft');
  const real = (await cell('2026-11-20')).locator('.cal-e', { hasText: 'New TV' });
  ok((await real.count()) === 1 && !(await real.getAttribute('class')).includes('tentative'), 'it stays on the calendar, now as a real line');
  await pg.evaluate(() => Store.undo());
  ok((await countDrafts()) === 2 && (await pg.evaluate(() => Store.plan.items.length)) === itemsBefore, 'Undo makes it a draft again');

  /* ---------- leaving with drafts asks first ---------- */
  await group.locator('.navi[data-view="wishes"]').click();
  ok((await dialog().locator('h2').textContent()) === 'Add your drafts to your plan?', 'leaving the page with new drafts asks');
  await dialog().getByRole('button', { name: 'Keep as drafts' }).click();
  ok((await pg.locator('h1').textContent()) === 'Wishlist', 'Keep as drafts goes on to the page');
  await group.locator('.navi[data-view="agenda"]').click();
  await group.locator('.navi[data-view="trips"]').click();
  ok((await pg.locator('h1').textContent()) === 'Trips and events', 'it asks once, not every time');
  await group.locator('.navi[data-view="agenda"]').click();

  /* ---------- what it shows of the plan ---------- */
  await pg.getByRole('button', { name: 'Customise' }).click();
  ok((await dialog().locator('h2').textContent()) === 'Customise your calendar', 'Customise opens');
  await dialog().locator('.agenda-layers button', { hasText: 'Transactions' }).click();
  await dialog().locator('.agenda-cats button', { hasText: 'Food & groceries' }).click();
  ok(
    await pg.evaluate(() => Store.plan.agenda.layers.includes('spend') && Store.plan.agenda.cats.join() === 'food'),
    'layers and categories are saved',
  );
  await dialog().getByRole('button', { name: 'Done' }).click();
  ok((await cal.locator('.cal-e', { hasText: 'Supermarket' }).count()) > 0, 'spends of the chosen category show');
  ok((await cal.locator('.cal-e', { hasText: 'Dinner with friends' }).count()) === 0, 'spends of other categories do not');
  ok((await cal.locator('.cal-e', { hasText: 'Rent' }).count()) === 0, 'bills are spending too: only the chosen categories');

  /* ---------- records of the plan, one by one ---------- */
  await pg.getByRole('button', { name: 'Add from your plan' }).click();
  ok((await dialog().locator('h2').textContent()) === 'Add from your plan', 'records can be added one by one');
  await dialog().locator('label', { hasText: 'Rent' }).first().locator('input').check();
  await dialog().getByRole('button', { name: 'Done' }).click();
  ok((await (await cell('2026-11-02')).locator('.cal-e', { hasText: 'Rent' }).count()) === 1, 'a pinned bill shows whatever the categories');

  /* ---------- search ---------- */
  await pg.keyboard.press('Control+k');
  await dialog().locator('input[type="search"]').fill('denti');
  const hit = dialog().locator('.searchrow', { hasText: 'Dentist' });
  ok((await hit.count()) === 1 && (await hit.textContent()).includes('Appointment'), 'the search finds appointments');
  await hit.click();
  ok((await dialog().locator('h2').textContent()) === 'Edit appointment', 'and opens them');
  await dialog().getByRole('button', { name: 'Close' }).click();

  /* ---------- own calendars ---------- */
  await pg.evaluate(() => Actions.setAgenda({ cals: [...Store.plan.agenda.cals, { id: 'work0001', name: 'Work', tone: 'trip' }] }));
  await pg.evaluate(() => Actions.saveEntry({ id: 'meet0001', title: 'Review meeting', date: '2026-11-12', cal: 'work0001' }));
  const legendWork = cal.locator('.cal-lg', { hasText: 'Work' });
  ok((await legendWork.count()) === 1, 'each own calendar is in the legend');
  await legendWork.click();
  ok((await cal.locator('.cal-e', { hasText: 'Review meeting' }).count()) === 0, 'and can be hidden');
  await legendWork.click();

  /* ---------- an appointment with money ---------- */
  const endNow = await pg.evaluate(() => Store.proj.summary.end);
  await (await cell('2026-11-25')).click({ button: 'right' });
  await menuItem('New appointment').click();
  await fill('What', 'Physio');
  await dialog().locator('.fld', { hasText: 'Amount' }).first().locator('input').fill('45');
  await dialog().locator('.fld', { hasText: 'Category' }).locator('select').selectOption('health');
  await dialog().getByRole('button', { name: /^(Save|Done)$/ }).click();
  const physio = (await cell('2026-11-25')).locator('.cal-e', { hasText: 'Physio' });
  ok((await physio.getAttribute('class')).includes('tentative') && (await physio.textContent()).includes('45'), 'an appointment can cost money: a draft at first');
  ok((await pg.evaluate(() => Store.proj.summary.end)) === endNow, 'which counts for nothing yet');
  ok((await pg.locator('.agenda-drafts').textContent()).includes('3 drafts'), 'and is listed with the drafts');
  await physio.click();
  await dialog().locator('.switch', { hasText: 'Count in my plan' }).click();
  await dialog().getByRole('button', { name: /^(Save|Done)$/ }).click();
  await dialog().waitFor({ state: 'detached' }).catch(() => {});
  ok((await pg.evaluate(() => Store.proj.summary.end)) === endNow - 45, 'switched on, it counts in the plan');
  ok(!(await (await cell('2026-11-25')).locator('.cal-e', { hasText: 'Physio' }).getAttribute('class')).includes('tentative'), 'and is drawn as certain');
  await pg.evaluate(() => { UI.mview = 'list'; App.go('months'); });
  const line = pg.locator('.row', { hasText: 'Physio' });
  ok((await line.count()) === 1 && (await line.textContent()).includes('45'), 'the Month planner has it as a line of November');
  await line.click();
  ok((await dialog().locator('h2').textContent()) === 'Edit appointment', 'which opens the appointment');
  await dialog().getByRole('button', { name: 'Close' }).click();
  await pg.evaluate(() => App.go('agenda'));

  /* ---------- one day of a repeat ---------- */
  const swimOn = async d => (await cell(d)).locator('.cal-e', { hasText: /Swim|Pool/ });
  await (await swimOn('2026-11-10')).click();
  ok((await dialog().locator('.fld', { hasText: 'Apply the changes to' }).count()) === 1, 'a day of a repeat asks what the changes are for');
  ok((await dialog().locator('.fld', { hasText: 'Repeats' }).count()) === 0, 'this day only cannot repeat');
  await dialog().locator('input[type="time"]').first().fill('19:00');
  await dialog().getByRole('button', { name: 'Save' }).click();
  ok((await (await swimOn('2026-11-10')).locator('.cal-tm').textContent()) === '19:00', 'this day only changes that day');
  ok((await (await swimOn('2026-11-03')).locator('.cal-tm').count()) === 0 && (await (await swimOn('2026-11-24')).locator('.cal-tm').count()) === 0, 'and not the others');
  await (await swimOn('2026-11-24')).click();
  await dialog().getByRole('button', { name: 'This and following days' }).click();
  await fill('What', 'Pool');
  await dialog().getByRole('button', { name: 'Save' }).click();
  ok((await (await swimOn('2026-11-24')).textContent()).includes('Pool') && (await (await swimOn('2026-12-01')).textContent()).includes('Pool'), 'this and following days change from that day');
  ok((await (await swimOn('2026-11-03')).textContent()).includes('Swim'), 'the days before stay as they were');
  await (await swimOn('2026-11-03')).click({ button: 'right' });
  ok((await menuItem('Delete this and following days').count()) === 1 && (await menuItem('Delete every day').count()) === 1, 'its menu deletes one day, the following days or every day');
  await menuItem('Delete every day').click();
  await dialog().getByRole('button', { name: 'Delete' }).click();
  ok((await cal.locator('.cal-e', { hasText: /Swim|Pool/ }).count()) === 0, 'every day is every part of it, days changed on their own too');
  await pg.evaluate(() => Store.undo());

  /* ---------- every change is in the activity log ---------- */
  await pg.evaluate(() => App.go('settings', { stab: 'activity' }));
  const logText = await pg.locator('main').textContent();
  ok(logText.includes('Your calendar shows Transactions') && logText.includes('Spending shown on your calendar: Food & groceries'), 'each change made in Customise has its own line');
  ok(logText.includes('“Rent” is always on your calendar'), 'so does a record added from the plan');
  ok(logText.includes('Changed “Swim” on 10 Nov 2026 only'), 'and a change to one day of a repeat');
  await pg.evaluate(() => App.go('settings', { stab: 'look' }));
  await pg.getByRole('button', { name: 'Dark', exact: true }).click();
  ok((await pg.evaluate(() => Store.db.log.at(-1).text)) === 'Theme: Dark', 'preferences are written down too');
  await pg.getByRole('button', { name: 'Auto', exact: true }).click();
  await pg.evaluate(() => App.go('agenda'));

  /* ---------- phone ---------- */
  await pg.setViewportSize({ width: 390, height: 800 });
  await pg.evaluate(() => App.render());
  await pg.waitForFunction(() => document.querySelector('[data-cal="agenda"]')?.dataset.mode === 'mobile');
  ok((await cal.getAttribute('data-mode')) === 'mobile', 'a phone gets the compact month');
  ok((await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'nothing sticks out sideways');
  ok(
    (await cal.locator('.cal-agenda .row', { hasText: 'Dentist' }).count()) === 1,
    'the month list under the grid has the appointments',
  );
  await pg.screenshot({ path: path.join(SHOTS, 'agenda-phone.png'), fullPage: true });
  await pg.setViewportSize({ width: 1440, height: 1000 });
  await pg.evaluate(() => App.render());
  await pg.screenshot({ path: path.join(SHOTS, 'agenda-wide.png'), fullPage: true });

  const text = await pg.evaluate(() => document.body.innerText);
  ok(!/undefined|NaN|\[object/.test(text), 'no broken text on the page');
  console.log(errs.length ? errs.join('\n') : `AGENDA UI OK (${passed} checks)`);
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
