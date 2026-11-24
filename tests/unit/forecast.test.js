/**
 * @file Unit tests for the forecast scenarios. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { overrunRate, forecastScenario, smoothedLevel, dampedTrend, seededRandom } from '../../src/logic/forecast.js';

/** Six months that start at 0. Each entry is what the month leaves over; costs are 1000 a month. */
const projectionLeaving = leftovers => {
  let balance = 0;
  const months = leftovers.map((left, position) => {
    const open = balance;
    balance += left;
    return { k: position, key: 'm' + position, open, close: balance, out: 1000 };
  });
  return { months };
};

test('pace: later months cannot leave more than the first months do on average', () => {
  const projection = projectionLeaving([100, 50, 150, 100, 700, 900]);
  const { rows, average } = forecastScenario(projection, 0, { type: 'pace', sampleMonths: 4 });
  assert.equal(average, 100);
  assert.deepEqual(
    rows.map(row => row.left),
    [100, 50, 150, 100, 100, 100],
  );
  assert.equal(rows[5].close, 600); // the plan says 2000
  assert.equal(rows[5].planClose, 2000);
});

test('pace: a month the plan already makes worse than the average stays worse', () => {
  const projection = projectionLeaving([100, 100, 100, 100, -300, 500]);
  const { rows } = forecastScenario(projection, 0, { type: 'pace', sampleMonths: 4 });
  assert.equal(rows[4].left, -300);
  assert.equal(rows[5].left, 100);
});

test('cautious: every cost from the current month on is a percentage higher', () => {
  const projection = projectionLeaving([100, 100, 100]);
  const { rows } = forecastScenario(projection, 1, { type: 'cautious', percent: 10 });
  assert.deepEqual(
    rows.map(row => row.left),
    [100, 0, 0],
  ); // 10% of 1000 costs is 100 less left over
  assert.equal(rows[2].close, 100);
});

test('exponential smoothing weights the latest months more than a plain average does', () => {
  // the plain average of these is 100; the last months are lower, so the smoothed level is below it
  assert.equal(smoothedLevel([200, 100, 50, 50], 0.5), 75);
  assert.equal(smoothedLevel([80], 0.5), 80);
  assert.equal(smoothedLevel([200, 100, 50, 50], 1), 50); // alpha 1 = only the latest month counts
});

test('smooth scenario: the ceiling is the smoothed level', () => {
  const projection = projectionLeaving([200, 100, 50, 50, 700, 700]);
  const { rows, average } = forecastScenario(projection, 0, { type: 'smooth', sampleMonths: 4, alpha: 0.5 });
  assert.equal(average, 75);
  assert.deepEqual(
    rows.slice(4).map(row => row.left),
    [75, 75],
  );
});

test('damped trend: a steady series has no trend, a falling one keeps falling but ever more slowly', () => {
  const flat = dampedTrend([100, 100, 100, 100]);
  assert.equal(flat.trend, 0);
  assert.equal(flat.ahead(6), 100);

  const falling = dampedTrend([400, 300, 200, 100]);
  const firstStep = falling.ahead(1) - falling.level;
  const laterStep = falling.ahead(6) - falling.ahead(5);
  assert.ok(firstStep < 0);
  assert.ok(Math.abs(laterStep) < Math.abs(firstStep)); // the slope fades out
});

test('trend scenario: later months follow the falling trend, never above the plan', () => {
  const projection = projectionLeaving([400, 300, 200, 100, 900, 900]);
  const { rows } = forecastScenario(projection, 0, { type: 'trend', sampleMonths: 4 });
  assert.ok(rows[4].left < 200);
  assert.ok(rows[5].left < rows[4].left);
  assert.ok(rows[5].close < rows[5].planClose);
});

test('the random generator is repeatable', () => {
  const first = seededRandom(42);
  const second = seededRandom(42);
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
});

test('income drops: every month from now on has less coming in', () => {
  const projection = projectionLeaving([100, 100]);
  projection.months.forEach(month => (month.inc = 2000));
  const { rows } = forecastScenario(projection, 0, { type: 'income', percent: 10 });
  assert.deepEqual(
    rows.map(row => row.left),
    [-100, -100],
  ); // 10% of 2000 less
});

test('plan against reality: the overrun measured in a checked month is applied to every cost still to come', () => {
  // month 0 was checked: 200 was spent outside the plan while 800 of planned costs had been paid = 25% overrun
  const projection = projectionLeaving([100, 100, 100]);
  projection.months[0].fix = { d: 1, a: -200 };
  projection.months[0].paidOut = 800;
  projection.months.forEach(month => (month.entries = [{ amount: -200, paid: false }]));
  assert.equal(overrunRate(projection), 0.25);
  const { rows, overrun } = forecastScenario(projection, 0, { type: 'variance' });
  assert.equal(overrun, 0.25);
  assert.equal(rows[0].left, 50); // only the 200 not paid yet can still overrun: 25% of 200
  assert.equal(rows[1].left, -150); // a whole later month: 25% of its 1000 costs
});

test('plan against reality: without a checked month there is nothing to measure', () => {
  const projection = projectionLeaving([100, 100]);
  projection.months.forEach(month => (month.entries = []));
  assert.equal(overrunRate(projection), null);
  assert.deepEqual(
    forecastScenario(projection, 0, { type: 'variance' }).rows.map(row => row.left),
    [100, 100],
  );
});
