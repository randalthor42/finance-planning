/**
 * @file Unit tests for monthPosition: the month equation every screen shows. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { project } from '../../src/logic/projection.js';
import { monthPosition } from '../../src/logic/position.js';
import { D } from '../../src/core/dates.js';

const TODAY = D.parse('2026-11-14');

function monthOf(extra = {}) {
  const plan = normPlan({
    settings: { startMonth: '2026-11', opening: 100 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000, day: 20 }],
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 400, day: 1 },
      { id: 'food0001', name: 'Food', amount: 300, budget: true },
      { id: 'fun00001', name: 'Fun', amount: 100, budget: true, reserve: false },
    ],
    items: [{ id: 'food0002', name: 'Shop', amount: 120, budget: 'food0001', date: '2026-11-05', month: '2026-11' }],
    ...extra,
  });
  return project(plan, { today: TODAY }).months[0];
}

test('now + coming in − to pay − budgets left = month end', () => {
  const month = monthOf();
  const position = monthPosition(month, TODAY);
  assert.equal(position.comingIn, 1000);
  assert.equal(position.toPay, 400);
  assert.equal(position.budgetsLeft, 180);
  assert.equal(
    Math.round((position.now + position.comingIn - position.toPay - position.budgetsLeft) * 100) / 100,
    month.close,
  );
});

test('a ticked line moves from "to pay" into "now" and the end does not move', () => {
  const before = monthPosition(monthOf(), TODAY);
  const after = monthPosition(monthOf({ paid: { '2026-11': { 'bill:rent0001': true } } }), TODAY);
  assert.equal(after.toPay, before.toPay - 400);
  assert.equal(after.now, before.now - 400);
  assert.equal(after.close, before.close);
});

test('budget per day counts today and is 0 once the month is over', () => {
  const month = monthOf();
  const position = monthPosition(month, TODAY);
  assert.equal(position.daysLeft, month.end - TODAY + 1);
  assert.equal(monthPosition(month, month.end + 3).perDay, 0);
});
