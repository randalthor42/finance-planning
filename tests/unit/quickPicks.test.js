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
    out('Estanc', 15.75, 'cig'),
    out('estanc', 15.75, 'cig'),
    out('Estanc', 15.75, 'cig'),
    out('Consum', 40, 'food'),
    out('Consum', 70, 'food'),
    out('Once', 9),
  ]);
  assert.deepEqual(
    picks.map(pick => [pick.name, pick.amount, pick.count]),
    [
      ['Estanc', 15.75, 3],
      ['Consum', null, 2],
    ],
  );
});

test('accents and case do not split a pick; money in is ignored', () => {
  const picks = quickPicks([
    out('Fruta y Verdura', 5),
    out('fruta y verdura', 6),
    { name: 'Refund', amount: 5, kind: 'in', cat: 'refund' },
    { name: 'Refund', amount: 5, kind: 'in', cat: 'refund' },
  ]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].count, 2);
});
