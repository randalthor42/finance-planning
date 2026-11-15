/**
 * @file Unit tests for the projection engine: what a month adds up to, ticks, budgets and corrections. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { project } from '../../src/logic/projection.js';
import { D } from '../../src/core/dates.js';

const TODAY = D.parse('2026-11-14');

/** A small plan: 100 to start, 1000 salary, 400 rent, a 300 food budget and one 50 purchase. */
function firstMonthOf(extra = {}) {
  const plan = normPlan({
    settings: { startMonth: '2026-11', opening: 100 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000 }],
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 400 },
      { id: 'food0001', name: 'Food', amount: 300, budget: true },
    ],
    items: [{ id: 'shoes001', name: 'Shoes', amount: 50, month: '2026-11' }],
    ...extra,
  });
  const projection = project(plan, { today: TODAY });
  return { plan, projection, month: projection.months[0] };
}

test('a month ends at: start + money in - money out', () => {
  const { month } = firstMonthOf();
  assert.equal(month.open, 100);
  assert.equal(month.inc, 1000);
  assert.equal(month.out, 750);
  assert.equal(month.close, 350);
});

test('the next month starts where this one ended', () => {
  const { projection } = firstMonthOf();
  assert.equal(projection.months[1].open, projection.months[0].close);
});

test('with nothing ticked, "have now" is the start and everything is still to come', () => {
  const { month } = firstMonthOf();
  assert.equal(month.now, 100);
  assert.equal(month.todo, 250);
  assert.equal(month.now + month.todo, month.close);
});

test('ticking a line moves it into "have now" and never changes the end of the month', () => {
  const ticked = firstMonthOf({ paid: { '2026-11': { 'inc:salary01': true, 'bill:rent0001': true } } }).month;
  assert.equal(ticked.now, 700);
  assert.equal(ticked.todo, -350);
  assert.equal(ticked.close, 350);
});

test('a spend logged against a budget uses the budget up, it does not add to it', () => {
  const { month } = firstMonthOf({
    items: [{ id: 'spend001', name: 'Supermarket', amount: 120, budget: 'food0001', month: '2026-11' }],
  });
  const food = month.entries.find(entry => entry.budget);
  assert.equal(food.budget.spent, 120);
  assert.equal(food.budget.left, 180);
  assert.equal(month.close, 400); // 100 + 1000 - 400 - 300 (the purchase from the base plan is replaced here)
});

test('a correction from real money is one more line and carries into later months', () => {
  const { month, projection } = firstMonthOf({ fixes: { '2026-11': { d: '2026-11-14', a: -80 } } });
  assert.equal(month.close, 270);
  assert.equal(month.fix.a, -80);
  assert.equal(projection.months[1].open, 270);
});

test('every month is the sum of its lines', () => {
  const { projection } = firstMonthOf({ fixes: { '2026-11': { d: '2026-11-14', a: -80 } } });
  let balance = 100;
  for (const month of projection.months) {
    for (const entry of month.entries) {
      balance += entry.amount;
    }
    assert.ok(Math.abs(balance - month.close) < 0.011, 'month ' + month.key);
  }
});

test('a savings goal that is switched off keeps its pot but takes no money from the plan', () => {
  const goal = { id: 'goal0001', name: 'Holiday', saved: 300, monthly: 100 };
  const counted = firstMonthOf({ goals: [goal] });
  const switchedOff = firstMonthOf({ goals: [{ ...goal, on: false }] });
  assert.equal(counted.month.close, 250);
  assert.equal(switchedOff.month.close, 350);
  assert.equal(switchedOff.month.savings, 300);
  assert.equal(counted.plan.goals[0].on, true); // old plans without the field stay counted
});

test('a reserved budget sets its whole amount aside, a tracked budget sets nothing aside', () => {
  const reserved = firstMonthOf();
  assert.equal(reserved.month.close, 350);
  const tracked = firstMonthOf({
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 400 },
      { id: 'food0001', name: 'Food', amount: 300, budget: true, reserve: false },
    ],
  });
  assert.equal(tracked.month.close, 650);
  assert.equal(tracked.month.entries.find(entry => entry.budget).budget.reserve, false);
});

test('money spent from a tracked budget comes out of the free money', () => {
  const { month } = firstMonthOf({
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 400 },
      { id: 'food0001', name: 'Food', amount: 300, budget: true, reserve: false },
    ],
    items: [
      { id: 'shoes001', name: 'Shoes', amount: 50, month: '2026-11' },
      { id: 'spend001', name: 'Supermarket', amount: 120, budget: 'food0001', month: '2026-11' },
    ],
  });
  assert.equal(month.close, 530);
  assert.equal(month.entries.find(entry => entry.budget).budget.left, 180);
});

test('a budget reserves its money unless it says otherwise', () => {
  const plan = normPlan({ bills: [{ id: 'food0001', name: 'Food', amount: 300, budget: true }] });
  assert.equal(plan.bills[0].reserve, true);
});
