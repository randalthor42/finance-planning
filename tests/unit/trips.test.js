/**
 * @file Unit tests for trips that cross a payday. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { tripSpan, tripParts } from '../../src/logic/trips.js';
import { M } from '../../src/core/dates.js';

const planWithTrip = trip =>
  normPlan({
    settings: { startMonth: '2026-11', payDay: 26, payShift: 'none', payFor: 'next', cents: true },
    trips: [
      {
        id: 'trip0001',
        name: 'Winter trip',
        month: '2026-12',
        items: [{ id: 'cost0001', name: 'Food', amount: 100 }],
        ...trip,
      },
    ],
  });

test('a trip without dates is paid in its own month', () => {
  const plan = planWithTrip({});
  const parts = tripParts(plan.settings, plan.trips[0]);
  assert.equal(parts.length, 1);
  assert.equal(M.key(parts[0].k), '2026-12');
  assert.equal(parts[0].amount, 100);
});

test('a trip that crosses a payday is shared between the two salary months by days', () => {
  // 21 to 30 Dec is 10 days: 5 before the payday of the 26th, 5 from it
  const plan = planWithTrip({ from: '2026-12-21', to: '2026-12-30' });
  const span = tripSpan(plan.settings, plan.trips[0]);
  assert.deepEqual(
    span.map(([monthIndex, days]) => [M.key(monthIndex), days]),
    [
      ['2026-12', 5],
      ['2027-01', 5],
    ],
  );
  const parts = tripParts(plan.settings, plan.trips[0]);
  assert.deepEqual(
    parts.map(part => part.amount),
    [50, 50],
  );
});

test('the shared parts always add up to the cost, to the cent', () => {
  const plan = planWithTrip({
    from: '2026-12-19',
    to: '2027-01-06',
    items: [{ id: 'cost0001', name: 'Food', amount: 100 }],
  });
  const parts = tripParts(plan.settings, plan.trips[0]);
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  assert.equal(Math.round(total * 100), 10000);
});

test('a cost with its own month is paid there in full', () => {
  const plan = planWithTrip({
    from: '2026-12-21',
    to: '2026-12-30',
    items: [{ id: 'cost0001', name: 'Flights', amount: 100, pay: '2026-11' }],
  });
  const parts = tripParts(plan.settings, plan.trips[0]);
  assert.equal(parts.length, 1);
  assert.equal(M.key(parts[0].k), '2026-11');
});
