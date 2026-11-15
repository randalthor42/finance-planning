/**
 * @file Unit tests for the loan schedule. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { loanCalc } from '../../src/logic/loans.js';
import { r2 } from '../../src/core/util.js';

const loanFrom = fields => normPlan({ loans: [{ name: 'Test loan', first: '2027-01', ...fields }] }).loans[0];

test('nothing to borrow gives no schedule', () => {
  assert.equal(loanCalc(loanFrom({ amount: 0, rate: 5, term: 12 })), null);
});

test('an interest-free loan is the amount divided by the months', () => {
  const result = loanCalc(loanFrom({ amount: 1200, rate: 0, term: 12 }));
  assert.equal(r2(result.pay), 100);
  assert.equal(result.sch.length, 12);
  assert.equal(r2(result.int), 0);
  assert.equal(r2(result.sch[11].b), 0);
});

test('a loan with interest is fully paid off at the end of its term', () => {
  const result = loanCalc(loanFrom({ amount: 10000, rate: 6, term: 12 }));
  assert.equal(r2(result.pay), 860.66);
  assert.equal(result.sch.length, 12);
  assert.ok(result.sch[11].b < 0.01);
  assert.equal(r2(result.int), r2(result.pay * 12 - 10000));
});

test('extra payments shorten the loan and save interest', () => {
  const plain = loanCalc(loanFrom({ amount: 10000, rate: 6, term: 24 }));
  const faster = loanCalc(loanFrom({ amount: 10000, rate: 6, term: 24, extra: 200 }));
  assert.ok(faster.sch.length < plain.sch.length);
  assert.ok(faster.int < plain.int);
  assert.equal(faster.saved, 24 - faster.sch.length);
});

test('a financed opening fee is added to what you borrow', () => {
  const result = loanCalc(loanFrom({ amount: 1000, rate: 0, term: 10, feePct: 10, feeFin: true }));
  // the fee is 10% of the whole loan, so the loan is 1000 / 0.9
  assert.equal(r2(result.P), 1111.11);
  assert.equal(r2(result.fee), 111.11);
});
