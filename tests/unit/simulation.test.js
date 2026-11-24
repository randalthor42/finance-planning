/**
 * @file Unit tests for the simulation (logic/sim): learning from history (known synthetic data gives the expected
 * parameters), the Monte Carlo run (same seed, same answer), edge cases and the backtest. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { D, M } from '../../src/core/dates.js';
import { normPlan } from '../../src/models/plan.js';
import { normSim } from '../../src/models/sim.js';
import { project } from '../../src/logic/projection.js';
import { FALLBACK, INCOME_FALLBACK, fitModel } from '../../src/logic/sim/fit.js';
import { baseFlows } from '../../src/logic/sim/baseline.js';
import { simulate, simulateInChunks } from '../../src/logic/sim/engine.js';
import { backtest } from '../../src/logic/sim/backtest.js';
import { risksOf } from '../../src/logic/sim/risks.js';

const NOW = M.parse('2026-11');
const TODAY = D.parse('2026-11-01'); // the first day: the whole month is still ahead
/** A day in month `back` months before November 2026. */
const dayIn = (back, d = 10) => D.key(D.inMonth(NOW - back, d));

/**
 * A plan with history: `series[cat]` is the total of each past month, oldest first (the last one is October 2026),
 * logged as three purchases a month. `extra` are more plan fields.
 */
function planWith(series, extra = {}) {
  const items = [];
  for (const [cat, totals] of Object.entries(series)) {
    totals.forEach((total, i) => {
      const back = totals.length - i;
      if (total > 0) {
        const third = Math.round((total / 3) * 100) / 100;
        for (const [j, part] of [third, third, Math.round((total - 2 * third) * 100) / 100].entries()) {
          items.push({ name: cat + ' ' + i + '.' + j, amount: part, cat, date: dayIn(back, 5 + j * 7) });
        }
      }
    });
  }
  return normPlan({
    settings: { startMonth: '2026-11', horizon: 24, opening: 2000, cushion: 300 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 2500, cat: 'salary', day: 1 }],
    bills: [{ id: 'rent0001', name: 'Rent', amount: 900, cat: 'housing', day: 2 }],
    ...extra,
    items: [...items, ...(extra.items || [])],
  });
}
const FOOD = [300, 320, 280, 310, 305, 295, 900, 300, 315, 290, 305, 300];

/* ---------- learning from history ---------- */

test('purchases on a credit card are not learned as cash spending (the card’s repayment is a bill of the plan)', () => {
  const cardItems = FOOD.map((total, i) => ({
    name: 'Card ' + i,
    amount: 200,
    cat: 'food',
    account: 'card0001',
    date: dayIn(FOOD.length - i, 12),
  }));
  const accounts = [{ id: 'card0001', name: 'Card', type: 'credit', limit: 2000 }];
  const withCard = fitModel(planWith({ food: FOOD }, { accounts, items: cardItems }), { now: NOW });
  const cashOnly = fitModel(planWith({ food: FOOD }, { accounts }), { now: NOW });
  const food = model => model.cats.find(c => c.cat === 'food');
  assert.equal(food(withCard).center, food(cashOnly).center);
});

test('with no history, the fallback shapes average 1: the median path stays on the plan, not below it', () => {
  const mean = list => list.reduce((sum, x) => sum + x, 0) / list.length;
  assert.ok(Math.abs(mean(FALLBACK) - 1) < 1e-9);
  assert.ok(Math.abs(mean(INCOME_FALLBACK) - 1) < 1e-9);
});

test('a year of food spending gives its median and MAD, and one odd month does not distort them', () => {
  const model = fitModel(planWith({ food: FOOD }), { now: NOW });
  assert.deepEqual(model.window, { from: NOW - 12, to: NOW - 1, months: 12 });
  const food = model.cats.find(c => c.cat === 'food');
  assert.equal(food.months, 12);
  assert.equal(food.confidence, 'ok');
  assert.equal(food.basis, 'history');
  assert.equal(food.stats.median, 302.5);
  assert.equal(food.stats.mad, 7.5);
  assert.ok(food.stats.mean > 350, 'the mean would have been pulled up: ' + food.stats.mean);
  assert.deepEqual(food.values, FOOD, 'the months themselves, for the bootstrap');
});

test('spends logged against a budget count in the budget’s category', () => {
  const plan = planWith(
    {},
    {
      bills: [{ id: 'groc0001', name: 'Groceries', amount: 350, cat: 'food', budget: true }],
      items: [1, 2, 3].map(back => ({ name: 'Market', amount: 100 + back, budget: 'groc0001', date: dayIn(back) })),
    },
  );
  const food = fitModel(plan, { now: NOW }).cats.find(c => c.cat === 'food');
  assert.deepEqual(food.values, [103, 102, 101]);
  assert.equal(food.budget, 350);
});

test('a large irregular purchase is a rare event with its own frequency and size, not part of the category', () => {
  const plan = planWith(
    { food: FOOD, fun: [80, 90, 85, 70, 95, 88, 75, 90, 80, 85, 92, 78] },
    { items: [{ name: 'Washing machine', amount: 1200, cat: 'other', date: dayIn(4) }] },
  );
  const model = fitModel(plan, { now: NOW });
  assert.equal(model.events.count, 1);
  assert.equal(model.events.perYear, 1);
  assert.deepEqual(model.events.sizes, [1200]);
  assert.equal(model.events.confidence, 'low', 'one event is too few to be sure of');
  assert.ok(!model.cats.some(c => c.cat === 'other'), 'the purchase is not everyday spending');
});

test('income: a salary without changes is fixed; freelance income that varied is learned; unknown freelance is wide', () => {
  const overrides = {};
  [2000, 1500, 2600].forEach((amount, i) => {
    overrides[M.key(NOW - 3 + i)] = { 'inc:free0001': amount };
  });
  const plan = planWith(
    {},
    {
      incomes: [
        { id: 'salary01', name: 'Salary', amount: 2500, cat: 'salary', day: 1 },
        { id: 'free0001', name: 'Freelance', amount: 2000, cat: 'side', day: 15, from: M.key(NOW - 3) },
        { id: 'gigs0001', name: 'Gigs', amount: 300, cat: 'side', day: 20 },
      ],
      overrides,
    },
  );
  const model = fitModel(plan, { now: NOW });
  const by = id => model.incomes.find(i => i.id === id);
  assert.deepEqual([by('salary01').mode, by('salary01').confidence], ['fixed', 'ok']);
  assert.equal(by('free0001').mode, 'variable');
  assert.equal(by('free0001').confidence, 'ok');
  assert.deepEqual(by('free0001').ratios, [1, 0.75, 1.3], 'each month against the usual (the median)');
  assert.deepEqual([by('gigs0001').mode, by('gigs0001').confidence], ['variable', 'low']);
});

/* ---------- edge cases of learning ---------- */

test('no history: nothing is learned, budgets are used with wide ranges and flagged', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 12 },
    bills: [{ id: 'groc0001', name: 'Groceries', amount: 400, cat: 'food', budget: true }],
  });
  const model = fitModel(plan, { now: NOW });
  assert.deepEqual(model.window, { from: null, to: null, months: 0 });
  assert.deepEqual(
    model.cats.map(c => [c.cat, c.basis, c.confidence, c.center]),
    [['food', 'budget', 'low', 400]],
  );
  assert.equal(model.events.perYear, 0);
});

test('one month of history: used, but as a low-confidence guess with wide ranges', () => {
  const model = fitModel(planWith({ food: [250] }), { now: NOW });
  const food = model.cats.find(c => c.cat === 'food');
  assert.deepEqual([food.months, food.basis, food.confidence, food.center], [1, 'few', 'low', 250]);
});

test('a budget with nothing logged for a year is not taken as "spends nothing": budget, low confidence', () => {
  const plan = planWith(
    { food: FOOD },
    { bills: [{ id: 'fun00001', name: 'Going out', amount: 120, cat: 'fun', budget: true }] },
  );
  const fun = fitModel(plan, { now: NOW }).cats.find(c => c.cat === 'fun');
  assert.deepEqual([fun.basis, fun.confidence, fun.center, fun.zeroHistory], ['budget', 'low', 120, true]);
});

/* ---------- the simulation ---------- */

const run = (plan, sim = {}, scenario = null) => {
  const proj = project(plan, { today: TODAY });
  const settings = normSim({ runs: 500, horizon: 12, seed: 7, ...sim });
  const model = fitModel(plan, { now: NOW });
  const base = baseFlows(plan, proj, { today: TODAY, horizon: settings.horizon });
  return simulate({ base, model, settings, scenario, cushion: plan.settings.cushion });
};

test('the same seed gives exactly the same result; another seed a slightly different one', () => {
  const plan = planWith({ food: FOOD, fun: [50, 90, 20, 140, 60, 75, 30, 110, 55, 65, 95, 40] });
  const a = run(plan);
  const b = run(plan);
  assert.deepEqual(a, b);
  const c = run(plan, { seed: 8 });
  assert.notDeepEqual(a.months, c.months);
  assert.equal(a.months.length, 12);
  assert.equal(a.runs, 500);
});

test('with nothing uncertain, every run is the plan itself', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 12, opening: 1000 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 2000, day: 1 }],
    bills: [{ id: 'rent0001', name: 'Rent', amount: 1500, day: 2 }],
  });
  const result = run(plan);
  const proj = project(plan, { today: TODAY });
  result.months.forEach((m, i) => {
    assert.equal(m.p5, proj.months[i].close);
    assert.equal(m.p95, proj.months[i].close);
  });
  assert.equal(result.pBelowZero, 0);
});

test('a negative starting balance: below zero from the start, and the 1-in-10 path is already there', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 12, opening: -500 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000, day: 28 }],
    bills: [{ id: 'rent0001', name: 'Rent', amount: 1000, day: 2 }],
  });
  const result = run(plan);
  assert.equal(result.pBelowZero, 1);
  assert.equal(result.zeroAtP10, 0, 'hits zero in the current month');
});

test('probabilities of going below zero and under the buffer', () => {
  // income just covers rent; a year of spending that swings around 500
  const plan = planWith(
    { food: [300, 700, 450, 520, 380, 640, 410, 560, 490, 600, 350, 530] },
    {
      settings: { startMonth: '2026-11', horizon: 24, opening: 600, cushion: 800 },
      incomes: [{ id: 'salary01', name: 'Salary', amount: 1400, cat: 'salary', day: 1 }],
    },
  );
  const result = run(plan, { buffer: 800 });
  assert.ok(result.pBelowZero > 0 && result.pBelowZero < 1, 'some runs go below zero: ' + result.pBelowZero);
  assert.ok(result.pBelowBuffer >= result.pBelowZero, 'under the buffer is at least as likely as under zero');
  const end = result.months.at(-1);
  assert.ok(end.p5 <= end.p25 && end.p25 <= end.p50 && end.p50 <= end.p75 && end.p75 <= end.p95, 'bands are nested');
});

test('a savings goal: its chance by its date, and the months it is reached in half and nine in ten runs', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 24, opening: 3000 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 2000, day: 1 }],
    goals: [{ id: 'fund0001', name: 'Emergency fund', target: 1000, monthly: 200, by: '2027-04' }],
  });
  const result = run(plan);
  const goal = result.goals.find(g => g.id === 'fund0001');
  assert.equal(goal.pByDate, 1, 'money never runs short: it is reached for sure');
  assert.equal(goal.reach50, M.parse('2027-03'), '5 payments of 200');
  assert.equal(goal.reach90, M.parse('2027-03'));
});

test('a month that runs short cannot put money aside: the goal slips', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 12, opening: 0 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000, day: 1 }],
    bills: [{ id: 'rent0001', name: 'Rent', amount: 950, day: 2 }],
    goals: [{ id: 'fund0001', name: 'Fund', target: 600, monthly: 200, by: '2027-02' }],
  });
  const goal = run(plan).goals[0];
  assert.equal(goal.pByDate, 0, 'only 50 a month is left: not by February');
  assert.equal(goal.reach50, M.parse('2027-10'), '12 months of 50');
});

test('a manual override of a fitted category moves the simulation', () => {
  const plan = planWith({ food: FOOD });
  const fitted = run(plan);
  const higher = run(plan, { cats: { food: { median: 602.5 } } });
  const end = m => m.months.at(-1).p50;
  assert.ok(Math.abs(end(fitted) - end(higher) - 300 * 12) < 150, 'about 300 more a month for 12 months');
  const without = run(plan, { cats: { food: { off: true } } });
  assert.ok(end(without) > end(fitted));
});

test('what if: a one-off purchase lowers every later month by exactly its amount (same random draws)', () => {
  const plan = planWith({ food: FOOD }, { settings: { startMonth: '2026-11', horizon: 24, opening: 5000 } });
  const base = run(plan);
  const scenario = { changes: [{ kind: 'oneoff', amount: 800, from: '2027-02' }] };
  const what = run(plan, {}, scenario);
  base.months.forEach((m, i) => {
    const diff = Math.round((what.months[i].p50 - m.p50) * 100) / 100;
    assert.equal(diff, m.k >= M.parse('2027-02') ? -800 : 0, M.key(m.k));
  });
});

test('what if: income down 10% and a new recurring cost', () => {
  const plan = planWith({ food: FOOD }, { settings: { startMonth: '2026-11', horizon: 24, opening: 5000 } });
  const base = run(plan).months.at(-1).p50;
  const less = run(plan, {}, { changes: [{ kind: 'income', percent: -10, from: '2026-11' }] }).months.at(-1).p50;
  assert.equal(Math.round(base - less), 2500 * 0.1 * 12);
  const gym = run(plan, {}, { changes: [{ kind: 'cost', amount: 40, from: '2027-05' }] }).months.at(-1).p50;
  assert.equal(Math.round(base - gym), 40 * 6);
});

test('months beyond the plan cannot be simulated: the horizon is cut and says so', () => {
  const plan = normPlan({ settings: { startMonth: '2026-11', horizon: 3, opening: 100 } });
  const result = run(plan, { horizon: 12 });
  assert.equal(result.months.length, 3);
  assert.equal(result.clipped, true);
});

/* ---------- backtest ---------- */

test('backtest on steady spending: the last 3 months fall inside the bands, and the model is called trustworthy', () => {
  const noisy = [410, 520, 380, 470, 600, 450, 390, 530, 480, 440, 560, 420, 500, 460, 430, 510, 470, 450];
  const result = backtest(planWith({ food: noisy }), { now: NOW, runs: 500, seed: 3 });
  assert.equal(result.status, 'ok');
  assert.equal(result.months.length, 3);
  assert.ok(
    result.months.every(m => m.inside90),
    JSON.stringify(result.months),
  );
  assert.ok(['good', 'fair'].includes(result.calibration), result.calibration);
});

test('backtest when spending suddenly doubles: the outcome falls outside the bands, and it says so', () => {
  const shift = [300, 320, 280, 310, 305, 295, 300, 315, 290, 305, 300, 310, 650, 700, 680];
  const result = backtest(planWith({ food: shift }), { now: NOW, runs: 500, seed: 3 });
  assert.equal(result.status, 'ok');
  assert.ok(result.months.some(m => !m.inside90));
  assert.equal(result.latest, 'poor');
  assert.equal(result.verdict, 'poor', 'earlier months fitted well, but habits changed: not trustworthy now');
});

test('the verdict: the worse of the latest months and every earlier check; unknown with too few checks', () => {
  const noisy = [410, 520, 380, 470, 600, 450, 390, 530, 480, 440, 560, 420, 500, 460, 430, 510, 470, 450];
  const steady = backtest(planWith({ food: noisy }), { now: NOW, runs: 500, seed: 3 });
  assert.equal(steady.verdict, steady.calibration === 'good' && steady.latest === 'good' ? 'good' : steady.verdict);
  assert.ok(['good', 'fair'].includes(steady.verdict));
  // 6 months: 3 to learn from, 3 hidden: one check window only
  const short = backtest(planWith({ food: [300, 310, 290, 305, 295, 300] }), { now: NOW, runs: 500, seed: 3 });
  assert.equal(short.status, 'ok');
  assert.equal(short.calibration, 'unknown');
  assert.equal(short.verdict, short.latest === 'poor' ? 'poor' : 'unknown');
});

test('backtest with too little history says so instead of guessing', () => {
  assert.equal(backtest(planWith({ food: [300, 310, 290, 305] }), { now: NOW }).status, 'notEnough');
  assert.equal(backtest(normPlan({}), { now: NOW }).status, 'notEnough');
});

/* ---------- settings ---------- */

test('simulation settings are cleaned: defaults, limits, known horizons only', () => {
  const d = normSim(undefined);
  assert.deepEqual([d.runs, d.horizon, d.seed, d.buffer], [2000, 12, 1, null]);
  const s = normSim({ runs: 1e9, horizon: 7, seed: -3, buffer: -5, cats: { food: { median: '250', spread: -1 } } });
  assert.deepEqual([s.runs, s.horizon, s.buffer], [10000, 12, null]);
  assert.ok(s.seed >= 1);
  assert.deepEqual(s.cats.food, { median: 250 });
  assert.deepEqual(normSim(s), s);
  assert.equal(normSim({ runs: 5 }).runs, 100);
});

test('in chunks, with pauses for the page, the simulation gives exactly the same result', async () => {
  const plan = planWith({ food: FOOD, fun: [50, 90, 20, 140, 60, 75, 30, 110, 55, 65, 95, 40] });
  const proj = project(plan, { today: TODAY });
  const input = {
    base: baseFlows(plan, proj, { today: TODAY, horizon: 12 }),
    model: fitModel(plan, { now: NOW }),
    settings: normSim({ runs: 700, horizon: 12, seed: 11 }),
    cushion: 300,
  };
  let pauses = 0;
  const chunked = await simulateInChunks(input, { chunk: 150, pause: async () => pauses++ });
  assert.deepEqual(chunked, simulate(input));
  assert.equal(pauses, 4);
});

/* ---------- the main risks, in order ---------- */

test('the risks: below zero first, then the worst 1 in 10, the buffer, goals, what drives it, history', () => {
  const plan = planWith(
    { food: [300, 700, 450, 520, 380, 640, 410, 560, 490, 600, 350, 530] },
    {
      settings: { startMonth: '2026-11', horizon: 24, opening: 600, cushion: 800 },
      incomes: [{ id: 'salary01', name: 'Salary', amount: 1400, cat: 'salary', day: 1 }],
    },
  );
  const model = fitModel(plan, { now: NOW });
  const result = run(plan, { buffer: 800 });
  const ids = risksOf(result, model).map(r => r.id);
  assert.equal(ids[0], 'belowZero');
  assert.ok(ids.includes('belowBuffer'));
  assert.ok(ids.includes('drivers'));
  assert.ok(!ids.includes('calm'));
  const drivers = risksOf(result, model).find(r => r.id === 'drivers');
  assert.equal(drivers.sources[0].key, 'cat:food');
});

test('a calm plan says so, and an empty history says it is guessing', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 12, opening: 5000 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 2000, day: 1 }],
    bills: [{ id: 'groc0001', name: 'Groceries', amount: 300, cat: 'food', budget: true }],
  });
  const ids = risksOf(run(plan), fitModel(plan, { now: NOW })).map(r => r.id);
  assert.equal(ids[0], 'calm');
  assert.ok(ids.includes('noHistory'));
  assert.ok(ids.includes('lowConfidence'));
});

test('a goal its own plan cannot reach by its date is said to be the plan, not chance', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 24, opening: 3000 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 2000, day: 1 }],
    goals: [{ id: 'fund0001', name: 'Fund', target: 2000, monthly: 150, by: '2027-06' }],
  });
  const result = run(plan, { horizon: 24 });
  assert.equal(result.goals[0].planReach, M.parse('2027-12'), 'with every payment made: 14 × 150');
  assert.equal(run(plan).goals[0].planReach, null, 'not within 12 months');
  const risks = risksOf(result, fitModel(plan, { now: NOW }));
  const said = risks.find(r => r.id === 'goalPlan');
  assert.ok(said, JSON.stringify(risks.map(r => r.id)));
  assert.deepEqual([said.name, said.by, said.planReach], ['Fund', M.parse('2027-06'), M.parse('2027-12')]);
  assert.ok(!risks.some(r => r.id === 'goal'), 'not also blamed on chance');
});

test('a goal with no date that takes longer than the months simulated is not a risk, just long-term', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 24, opening: 3000 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 2000, day: 1 }],
    goals: [{ id: 'fund0001', name: 'Fund', target: 6000, monthly: 150 }],
  });
  const risks = risksOf(run(plan), fitModel(plan, { now: NOW }));
  assert.ok(!risks.some(r => r.id === 'goal' || r.id === 'goalPlan'), JSON.stringify(risks.map(r => r.id)));
});
