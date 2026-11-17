// Browser tests for Forecast › Simulation: loaded only when opened, fully offline, learned from history, fan chart,
// chances, goals, risks, own values, what if, backtest, the month planner view, phone width.
// Run with: npm run test:ui (needs only the sample plan; the clock is fixed on 5 November 2026, runs are seeded).
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
  pg.setDefaultTimeout(8000);
  const errs = [];
  const requests = [];
  let passed = 0;
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => {
    if (m.type() === 'error') errs.push('CONSOLE ' + m.text());
  });
  pg.on('request', r => requests.push(r.url()));
  const ok = (c, m) => {
    if (!c) errs.push('FAIL ' + m);
    else {
      passed++;
      console.log('ok', m);
    }
  };
  const dialog = () => pg.locator('dialog[open]').last();
  const ready = () => pg.waitForSelector('.sim-result:not(.stale)');
  const kpis = () => pg.locator('.sim-kpis').textContent();
  await pg.clock.setFixedTime(new Date('2026-11-05T10:00:00'));
  await pg.goto(PAGE);
  await pg.getByText('Look around with a sample plan').click();

  /* ---------- loaded only when asked for ---------- */
  ok(
    await pg.evaluate(() => document.getElementById('runway-sim')?.type === 'text/plain' && !globalThis.RunwaySim),
    'the simulation is in the file as inert text and has not run',
  );
  ok(
    (await pg.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '')).includes("default-src 'none'"),
    'the strict policy is on (no network, no eval)',
  );
  ok(await pg.evaluate(() => I18N.keysLoaded === null), 'the texts for "Export language" are not read at start-up either');
  const exported = await pg.evaluate(() => JSON.parse(I18N.exportPack('en')).strings);
  ok(Object.keys(exported).length > 1700 && exported['Simulation'] === 'Simulation' && exported['#month:other'] === 'months', '"Export language" still has every text, read when asked for (' + Object.keys(exported).length + ')');
  await pg.evaluate(() => App.go('forecast', { ftab: 'sim' }));
  ok((await pg.locator('.subitems button', { hasText: 'Simulation' }).count()) === 1, 'Simulation is a way of looking ahead in Forecast');
  ok((await pg.locator('.subitems button', { hasText: 'Range of outcomes' }).count()) === 0, 'it replaces the old range of outcomes');
  await ready();
  ok(await pg.evaluate(() => !!globalThis.RunwaySim && typeof RunwaySim.simulate === 'function'), 'opening it ran the simulation code');

  /* ---------- the sample plan has no history: it says it is guessing ---------- */
  const riskText = () => pg.locator('.sim-risks').textContent();
  ok((await riskText()).includes('no spending history yet'), 'no history: the ranges are wide guesses, and it says so');
  ok((await pg.locator('main').textContent()).includes('Simulations are estimates based on your past behaviour, not financial advice.'), 'the disclaimer is there');

  /* ---------- a plan with 14 months of history ---------- */
  await pg.evaluate(() => {
    const now = M.parse('2026-11');
    const items = [];
    const food = [420, 510, 380, 460, 590, 440, 400, 530, 470, 450, 560, 430, 500, 480];
    const fun = [80, 150, 60, 200, 90, 120, 70, 180, 100, 95, 160, 85, 110, 130];
    food.forEach((total, i) => {
      const back = food.length - i;
      for (let j = 0; j < 4; j++) {
        items.push({ name: 'Supermarket', amount: total / 4, cat: 'food', date: D.key(D.inMonth(now - back, 3 + j * 7)) });
      }
      items.push({ name: 'Going out', amount: fun[i], cat: 'fun', date: D.key(D.inMonth(now - back, 12)) });
    });
    items.push({ name: 'New tyres', amount: 900, cat: 'transport', date: D.key(D.inMonth(now - 9, 20)) });
    items.push({ name: 'Vet', amount: 700, cat: 'pets', date: D.key(D.inMonth(now - 3, 8)) });
    Store.addPlan({
      name: 'With history',
      settings: { startMonth: '2026-11', horizon: 24, opening: 900, cushion: 500, currency: 'EUR', numFmt: 'us', dateFmt: 'dmy' },
      accounts: [{ name: 'Main', type: 'debit', balance: 900 }],
      incomes: [{ id: 'salary01', name: 'Salary', amount: 2300, cat: 'salary', day: 1 }],
      bills: [
        { name: 'Rent', amount: 950, cat: 'housing', day: 2 },
        { name: 'Phone', amount: 30, cat: 'utilities', day: 12 },
        { id: 'pets0001', name: 'Pets', amount: 40, cat: 'pets', budget: true },
      ],
      goals: [{ id: 'fund0001', name: 'Emergency fund', target: 2000, monthly: 150, by: '2027-06' }],
      items,
    });
    App.go('forecast', { ftab: 'sim' });
  });
  await ready();
  ok((await pg.locator('svg.fan .fan-90').count()) === 1 && (await pg.locator('svg.fan .fan-50').count()) === 1, 'a fan chart with the 90% and 50% bands');
  ok((await pg.locator('svg.fan .fan-mid').count()) === 1 && (await pg.locator('svg.fan .fan-plan').count()) === 1, 'the middle line, and the plan for comparison');
  const label = await pg.locator('svg.fan').getAttribute('aria-label');
  ok(/middle .* middle half .* nine in ten/.test(label), 'the chart says its numbers in words: ' + label.slice(0, 90));
  const k1 = await kpis();
  ok(/Chance of going below zero(under 1%|over 99%|\d+%)/.test(k1), 'the chance of going below zero, rounded: ' + k1.slice(0, 60));
  ok(k1.includes('Chance of going under your buffer') && k1.includes('buffer €500'), 'and under the safety buffer (the plan’s cushion)');
  ok(/Balance at the end of October 2027about €[\d,.]+/.test(k1), 'where it ends, as "about" an amount: ' + k1.match(/Balance at the end[^m]*/)[0]);
  const about = k1.match(/about (−?)€([\d,]+)/)[2].replace(/,/g, '');
  ok(about.replace(/0+$/, '').length <= 2, 'amounts of the future have two significant figures at most: ' + about);
  ok(!/\d\.\d+%/.test(k1), 'no chance with decimals (no false precision)');
  ok((await riskText()).length > 30, 'the main risks in plain words: ' + (await riskText()).slice(0, 120));

  // the same seed, the same answer
  await pg.evaluate(() => {
    forgetSimulation();
    App.render();
  });
  await ready();
  ok((await kpis()) === k1, 'run again with the same seed: exactly the same numbers');

  /* ---------- goals ---------- */
  const goalRow = pg.locator('.card').filter({ has: pg.locator('h2', { hasText: 'Savings goals' }) }).locator('tr', { hasText: 'Emergency fund' });
  ok((await goalRow.count()) === 1 && /(under 1%|over 99%|\d+%) by Jun 2027/.test(await goalRow.textContent()), 'each goal: its chance by its date: ' + (await goalRow.textContent()));

  /* ---------- what it learned, and own values ---------- */
  await pg.locator('summary', { hasText: 'What it learned' }).click();
  const food = pg.locator('.sim-row', { hasText: 'Food & groceries' });
  ok((await food.textContent()).includes('learned') && (await food.textContent()).includes('14 months of data'), 'food is learned from 14 months');
  ok((await pg.locator('.sim-row', { hasText: 'Pets' }).textContent()).includes('low confidence'), 'pets, with too little history, is flagged low confidence');
  ok((await pg.locator('.sim-row', { hasText: 'Large irregular expenses' }).textContent()).includes('About 1.7 times a year'), 'the tyres and the vet are rare events: about 1.7 a year');
  const endOf = async () => pg.evaluate(() => document.querySelector('.sim-kpis .kpi:nth-child(3) .v').textContent);
  const before = await endOf();
  await food.getByRole('button', { name: 'Change' }).click();
  await dialog().locator('.fld', { hasText: 'A usual month' }).locator('input').fill('900');
  await dialog().getByRole('button', { name: /^(Save|Done)$/ }).click();
  await ready();
  ok((await endOf()) !== before, 'an own value for food changes the outcome (' + before + ' → ' + (await endOf()) + ')');
  ok((await pg.locator('.sim-row', { hasText: 'Food & groceries' }).textContent()).includes('your values'), 'and is marked as yours');
  ok((await pg.evaluate(() => Store.db.log.at(-1).text)) === 'Simulation: your own values for Food & groceries', 'and written in the activity log');
  await pg.locator('.sim-row', { hasText: 'Food & groceries' }).getByRole('button', { name: 'Change' }).click();
  await dialog().getByRole('button', { name: 'Use what was learned' }).click();
  await ready();
  ok((await endOf()) === before, '"Use what was learned" brings it back');

  /* ---------- settings ---------- */
  await pg.locator('.sim-controls').getByRole('button', { name: '24 months' }).click();
  await ready();
  ok((await pg.evaluate(() => Store.plan.sim.horizon)) === 24, 'months ahead: 24');
  ok((await pg.evaluate(() => Store.db.log.at(-1).text)) === 'Simulation: 24 months ahead', 'written in the activity log');
  await pg.locator('.sim-controls select[aria-label="Runs"]').selectOption('10000');
  await ready();
  ok((await pg.evaluate(() => Store.plan.sim.runs)) === 10000, '10 000 runs work too');
  await pg.locator('.sim-controls select[aria-label="Runs"]').selectOption('2000');
  await ready();

  /* ---------- what if ---------- */
  await pg.getByRole('button', { name: 'New what-if' }).click();
  await dialog().getByRole('textbox', { name: 'Name' }).fill('New car');
  await dialog().locator('.sim-change select').first().selectOption('cost');
  await dialog().locator('.sim-change input[inputmode=decimal]').fill('250');
  await dialog().getByRole('button', { name: 'Save' }).click();
  await ready();
  const cmp = pg.locator('.card').filter({ has: pg.locator('h2', { hasText: 'What if: New car' }) });
  ok((await cmp.count()) === 1, 'a what-if is compared side by side');
  ok(/Balance at the end, middle.*−€[\d,]+/.test(await cmp.textContent()), 'with the difference: ' + (await cmp.locator('.row', { hasText: 'end, middle' }).textContent()));
  ok((await pg.locator('svg.fan .fan-cmp').count()) === 1, 'and drawn on the chart');
  ok((await pg.evaluate(() => Store.plan.sim.scenarios[0].changes[0])).amount === 250, 'it is saved with the plan');

  /* ---------- backtest ---------- */
  const bt = pg.locator('.card').filter({ has: pg.locator('h2', { hasText: 'Checked against reality' }) });
  ok((await bt.locator('tbody tr').count()) === 3, 'the last 3 months are predicted from the months before them');
  ok(/Trustworthy|Roughly right|Not trustworthy|Too little history/.test(await bt.locator('.card-h').textContent()), 'with a verdict: ' + (await bt.locator('.chip').first().textContent()));
  ok(/inside the middle half \d+% of the time/.test(await bt.textContent()), 'and how often reality fell inside the bands');

  /* ---------- the month planner can show it ---------- */
  await pg.getByRole('button', { name: 'Show in the month planner' }).click();
  await pg.waitForTimeout(300);
  ok((await pg.locator('.note', { hasText: 'Forecast view: “Simulation”' }).count()) === 1, 'the month planner shows the simulation’s middle, the plan unchanged');
  await pg.getByRole('button', { name: 'Back to the plan' }).click();

  /* ---------- a phone ---------- */
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.evaluate(() => App.go('forecast', { ftab: 'sim' }));
  await ready();
  ok((await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'a phone: nothing sticks out sideways');
  await pg.screenshot({ path: path.join(SHOTS, 'sim-phone.png'), fullPage: true });
  await pg.setViewportSize({ width: 1440, height: 1000 });
  await pg.evaluate(() => App.render());
  await ready();
  await pg.screenshot({ path: path.join(SHOTS, 'sim-wide.png'), fullPage: true });

  const outside = requests.filter(u => !u.startsWith('file:') && !u.startsWith('data:'));
  ok(outside.length === 0, 'nothing left the device: ' + (outside.join(', ') || 'no network requests'));
  const text = await pg.evaluate(() => document.body.innerText);
  ok(!/undefined|NaN|\[object|Infinity/.test(text), 'no broken text');
  console.log(errs.length ? errs.join('\n') : `SIMULATION UI OK (${passed} checks)`);
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
