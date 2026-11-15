/**
 * @file Unit tests for the forecast scenarios. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastScenario } from '../../src/logic/forecast.js';

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
