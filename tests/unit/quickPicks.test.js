/**
 * @file Unit tests for quick picks in "Add transaction". Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { quickPicks } from '../../src/logic/quickPicks.js';

const out = (name, amount, budget = null, date = '2026-11-01') => ({
  name,
  amount,
  budget,
  kind: 'out',
  cat: 'food',
  date,
});

test('the most frequent spends come first, and a fixed price is filled in', () => {
  const picks = quickPicks([
    out('Coffee', 3.5, 'treats'),
    out('coffee', 3.5, 'treats'),
    out('Coffee', 3.5, 'treats'),
    out('Supermarket', 40, 'food'),
    out('Supermarket', 70, 'food'),
    out('Once', 9),
  ]);
  assert.deepEqual(
    picks.map(pick => [pick.name, pick.amount, pick.count]),
    [
      ['Coffee', 3.5, 3],
      ['Supermarket', null, 2],
    ],
  );
});

test('accents and case do not split a pick; money in is ignored', () => {
  const picks = quickPicks([
    out('Fruit Stall', 5),
    out('fruit stall', 6),
    { name: 'Refund', amount: 5, kind: 'in', cat: 'refund' },
    { name: 'Refund', amount: 5, kind: 'in', cat: 'refund' },
  ]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].count, 2);
});
