/**
 * @file Unit tests for the review of a month. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { project } from '../../src/logic/projection.js';
import { reviewPeriod } from '../../src/logic/review.js';
import { auditChecks, ledgerRows } from '../../src/logic/audit.js';
import { D } from '../../src/core/dates.js';

const reviewOf = (extra = {}) => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', opening: 100, cushion: 50 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000 }],
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 400, cat: 'housing' },
      { id: 'food0001', name: 'Food', amount: 300, budget: true, cat: 'food' },
    ],
    ...extra,
  });
  const projection = project(plan, { today: D.parse('2026-11-14') });
  return { plan, projection, review: reviewPeriod(plan, projection, [projection.months[0]]) };
};

test('totals of the month', () => {
  const { review } = reviewOf();
  assert.equal(review.moneyIn, 1000);
  assert.equal(review.moneyOut, 700);
  assert.equal(review.leftOver, 300);
  assert.deepEqual(
    review.categories.map(category => category.cat),
    ['housing', 'food'],
  );
});

test('money left over is reported as something that went well', () => {
  const { review } = reviewOf();
  const item = review.good.find(entry => entry.id === 'leftOver');
  assert.equal(item.amount, 300);
  assert.equal(review.watch.length, 0);
});

test('a budget counts as kept only once the month is over', () => {
  const { plan, projection } = reviewOf({
    items: [{ id: 'spend001', name: 'Supermarket', amount: 200, budget: 'food0001', month: '2026-11' }],
  });
  const month = projection.months[0];
  const duringTheMonth = reviewPeriod(plan, projection, [month], month.end - 5);
  const afterTheMonth = reviewPeriod(plan, projection, [month], month.end + 1);
  assert.equal(
    duringTheMonth.good.some(entry => entry.id === 'budgetsKept'),
    false,
  );
  assert.equal(
    afterTheMonth.good.some(entry => entry.id === 'budgetsKept'),
    true,
  );
});

test('a budget that was overspent is something to watch', () => {
  const { review } = reviewOf({
    items: [{ id: 'spend001', name: 'Supermarket', amount: 360, budget: 'food0001', month: '2026-11' }],
  });
  const item = review.watch.find(entry => entry.id === 'overBudget');
  assert.equal(item.name, 'Food');
  assert.equal(item.amount, 60);
  assert.equal(item.yearly, 720);
});

test('spending that was never in the plan is something to watch', () => {
  const { review } = reviewOf({ fixes: { '2026-11': { d: '2026-11-14', a: -120 } } });
  assert.equal(review.unplanned, 120);
  assert.ok(review.watch.some(entry => entry.id === 'unplanned'));
  assert.equal(review.leftOver, 180);
});

test('a month that ends below zero comes first in what to watch', () => {
  const { review } = reviewOf({ items: [{ id: 'bigone01', name: 'Sofa', amount: 900, month: '2026-11' }] });
  assert.equal(review.watch[0].id, 'negative');
});

test('audit: the rules hold and the ledger ends on the month end', () => {
  const { plan, projection } = reviewOf({ fixes: { '2026-11': { d: '2026-11-14', a: -120 } } });
  assert.deepEqual(
    auditChecks(plan, projection).filter(check => !check.ok),
    [],
  );
  const firstMonthRows = ledgerRows(projection).filter(row => row.monthKey === '2026-11');
  assert.equal(firstMonthRows[firstMonthRows.length - 1].balance, projection.months[0].close);
});
