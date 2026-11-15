/**
 * @file Unit tests for normPlan, the gate every plan passes through. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';

test('an empty input becomes a complete, usable plan', () => {
  const plan = normPlan({});
  for (const list of ['accounts', 'incomes', 'bills', 'items', 'trips', 'loans', 'goals', 'wishes']) {
    assert.ok(Array.isArray(plan[list]), list);
  }
  assert.equal(typeof plan.settings.currency, 'string');
  assert.ok(plan.settings.horizon >= 1);
});

test('garbage never throws and never gets through', () => {
  const plan = normPlan({
    settings: { horizon: 1e9, opening: 'abc', startMonth: '2026-13' },
    incomes: 'x',
    bills: [null, 5, { amount: -5 }],
  });
  assert.ok(plan.settings.horizon <= 600);
  assert.equal(plan.settings.opening, 0);
  assert.deepEqual(plan.incomes, []);
  assert.ok(plan.bills.every(bill => bill.amount >= 0));
  assert.doesNotThrow(() => normPlan(null));
  assert.doesNotThrow(() => normPlan('text'));
});

test('normalising twice changes nothing', () => {
  const once = normPlan({
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000 }],
    bills: [{ id: 'rent0001', amount: 400 }],
  });
  assert.equal(JSON.stringify(normPlan(once)), JSON.stringify(once));
});

test('an item with a date belongs to the budget month of that date', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', payDay: 26, payFor: 'next' },
    items: [{ id: 'trash001', name: 'Trash fee', amount: 180, month: '2026-11', date: '2026-11-27' }],
  });
  assert.equal(plan.items[0].month, '2026-12'); // 27 Nov is paid by the salary of 26 Nov, which is December's money
});

test('old "real balance" data is converted to one correction per month', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', opening: 100 },
    incomes: [{ id: 'salary01', amount: 1000 }],
    paid: { '2026-11': { 'inc:salary01': true } },
    snaps: { '2026-11-14': 900 },
  });
  assert.deepEqual(plan.fixes, { '2026-11': { d: '2026-11-14', a: -200 } }); // ticked lines say 1100, reality said 900
  assert.equal(plan.snaps, undefined);
});
