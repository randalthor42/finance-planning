/**
 * @file Unit tests for record metadata (models/records.js stampPlan, with normPlan): every record has an id,
 * createdAt, updatedAt and deletedAt, set automatically when the plan is saved. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ID_RE, newId } from '../../src/core/util.js';
import { KEY_RE } from '../../src/models/categories.js';
import { mergeData } from '../../src/models/recordMerge.js';
import { normPlan } from '../../src/models/plan.js';
import { RECORD_LISTS, planText, stampPlan } from '../../src/models/records.js';
import { project } from '../../src/logic/projection.js';

const T0 = 1_790_000_000_000;
const T1 = T0 + 60_000;
const T2 = T1 + 60_000;
/** A plan as the store saves it: normalised, then stamped. */
const saved = (raw, prev = null, now = T0) => stampPlan(prev, normPlan(raw), now);
const base = () =>
  saved({
    id: 'plan0001',
    name: 'Home',
    settings: { startMonth: '2026-11', horizon: 12 },
    accounts: [{ id: 'acc00001', name: 'Main', type: 'debit', balance: 1000 }],
    incomes: [{ id: 'inc00001', name: 'Salary', amount: 2000, day: 1 }],
    bills: [
      { id: 'bill0001', name: 'Rent', amount: 800, day: 2 },
      { id: 'bill0002', name: 'Gym', amount: 30, day: 5 },
    ],
    items: [{ id: 'item0001', name: 'Laptop', amount: 900, month: '2027-02' }],
    trips: [
      { id: 'trip0001', name: 'Rome', month: '2027-04', items: [{ id: 'titm0001', name: 'Flights', amount: 200 }] },
    ],
    loans: [{ id: 'loan0001', name: 'Car', amount: 5000, rate: 5, term: 24, first: '2026-12' }],
    goals: [{ id: 'goal0001', name: 'Fund', target: 1000, monthly: 50 }],
    wishes: [{ id: 'wish0001', name: 'Camera', price: 500, on: true, month: '2027-05' }],
  }).plan;
const all = plan => [...RECORD_LISTS.flatMap(l => plan[l]), ...plan.trips.flatMap(t => t.items)];

test('ids: the short ids of the app, or a UUID for a record that arrived without one', () => {
  assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(newId(), newId());
  assert.ok(ID_RE.test('k3j4h5g6') && ID_RE.test(newId()));
  assert.ok(!ID_RE.test('BAD ID') && !ID_RE.test('x'));
  const plan = normPlan({ bills: [{ name: 'No id', amount: 5 }] });
  assert.match(plan.bills[0].id, /^[0-9a-f]{8}-/, 'missing id: a UUID');
  assert.match(plan.id, /^[0-9a-f]{8}-/);
  assert.ok(KEY_RE.test('bill:' + plan.bills[0].id), 'a UUID works in ticks and overrides too');
  assert.equal(normPlan({ bills: [{ id: 'bill0001', amount: 5 }] }).bills[0].id, 'bill0001', 'existing ids are kept');
});

test('a new plan: every record and the plan get id, createdAt, updatedAt and deletedAt null', () => {
  const plan = base();
  for (const r of [plan, ...all(plan)]) {
    assert.ok(ID_RE.test(r.id), r.id);
    assert.equal(r.createdAt, T0, r.id);
    assert.equal(r.updatedAt, T0, r.id);
    assert.equal(r.deletedAt, null, r.id);
  }
});

test('an imported plan keeps the dates it had; missing ones become now', () => {
  const plan = saved(
    {
      bills: [
        { id: 'bill0001', amount: 5, createdAt: 1000, updatedAt: 2000 },
        { id: 'bill0002', amount: 6 },
      ],
    },
    null,
    T1,
  ).plan;
  assert.deepEqual([plan.bills[0].createdAt, plan.bills[0].updatedAt], [1000, 2000]);
  assert.deepEqual([plan.bills[1].createdAt, plan.bills[1].updatedAt], [T1, T1]);
});

test('saving a change: only the changed record gets updatedAt = now; createdAt stays', () => {
  const prev = base();
  const next = JSON.parse(JSON.stringify(prev));
  next.bills[0].amount = 850;
  const { plan, changed } = stampPlan(prev, normPlan(next), T1);
  assert.equal(changed, true);
  assert.equal(plan.bills[0].updatedAt, T1);
  assert.equal(plan.bills[0].createdAt, T0);
  assert.equal(plan.bills[1].updatedAt, T0, 'untouched');
  assert.equal(plan.items[0].updatedAt, T0);
  assert.equal(plan.updatedAt, T1, 'the plan itself changed');
  assert.equal(plan.createdAt, T0);
});

test('saving with no change changes nothing, not even updatedAt', () => {
  const prev = base();
  const { plan, changed } = stampPlan(prev, normPlan(JSON.parse(JSON.stringify(prev))), T1);
  assert.equal(changed, false);
  assert.equal(JSON.stringify(plan), JSON.stringify(prev));
});

test('a change outside the records (settings, ticks, notes) updates the plan only', () => {
  const prev = base();
  const next = JSON.parse(JSON.stringify(prev));
  next.notes['2026-12'] = 'Call the bank';
  const { plan, changed } = stampPlan(prev, normPlan(next), T1);
  assert.equal(changed, true);
  assert.equal(plan.updatedAt, T1);
  assert.ok(all(plan).every(r => r.updatedAt === T0));
});

test('a new record gets createdAt = updatedAt = now, even when copied from another one', () => {
  const prev = base();
  const next = JSON.parse(JSON.stringify(prev));
  next.bills.push({ ...next.bills[0], id: 'bill0003', name: 'Rent copy' }); // a duplicate carries the original's dates
  const { plan } = stampPlan(prev, normPlan(next), T1);
  const copy = plan.bills.find(b => b.id === 'bill0003');
  assert.deepEqual([copy.createdAt, copy.updatedAt, copy.deletedAt], [T1, T1, null]);
});

test('deleting a record keeps it, with deletedAt = updatedAt = now, out of the lists', () => {
  const prev = base();
  for (const list of RECORD_LISTS) {
    const next = JSON.parse(JSON.stringify(prev));
    const gone = next[list][0];
    next[list] = next[list].slice(1);
    const { plan, changed } = stampPlan(prev, normPlan(next), T1);
    assert.equal(changed, true, list);
    assert.ok(!plan[list].some(r => r.id === gone.id), list + ': not in the list');
    const dead = plan.deleted[list].find(r => r.id === gone.id);
    assert.ok(dead, list + ': kept as deleted');
    assert.deepEqual([dead.createdAt, dead.updatedAt, dead.deletedAt], [T0, T1, T1], list);
    assert.equal(dead.name, gone.name, list + ': with its data');
  }
});

test('removing a cost from a trip keeps it too, with the trip it belonged to', () => {
  const prev = base();
  const next = JSON.parse(JSON.stringify(prev));
  next.trips[0].items = [];
  const { plan } = stampPlan(prev, normPlan(next), T1);
  assert.deepEqual(plan.trips[0].items, []);
  const dead = plan.deleted.tripItems[0];
  assert.equal(dead.id, 'titm0001');
  assert.equal(dead.tripId, 'trip0001');
  assert.equal(dead.deletedAt, T1);
  assert.equal(plan.trips[0].updatedAt, T1, 'the trip changed');
});

test('a deleted record that comes back (undo) is live again, with updatedAt = now', () => {
  const prev = base();
  const without = JSON.parse(JSON.stringify(prev));
  without.bills = without.bills.slice(1);
  const deleted = stampPlan(prev, normPlan(without), T1).plan;
  const back = stampPlan(deleted, normPlan(JSON.parse(JSON.stringify(prev))), T2).plan; // the old snapshot
  const bill = back.bills.find(b => b.id === 'bill0001');
  assert.deepEqual([bill.createdAt, bill.updatedAt, bill.deletedAt], [T0, T2, null]);
  assert.ok(!back.deleted.bills.some(b => b.id === 'bill0001'));
});

test('deleted records are ignored by lists, totals and charts (the projection)', () => {
  const prev = base();
  const next = JSON.parse(JSON.stringify(prev));
  next.bills = next.bills.filter(b => b.id !== 'bill0001');
  const deleted = stampPlan(prev, normPlan(next), T1).plan;
  const plain = normPlan({ ...JSON.parse(JSON.stringify(prev)), bills: prev.bills.filter(b => b.id !== 'bill0001') });
  const a = project(deleted, { today: 20773 });
  const b = project(plain, { today: 20773 });
  assert.deepEqual(
    a.months.map(m => m.close),
    b.months.map(m => m.close),
  );
  assert.ok(!a.months.some(m => m.entries.some(e => e.id === 'bill0001')));
});

test('a record with deletedAt found in a list is moved out of it by normPlan', () => {
  const plan = normPlan({
    bills: [
      { id: 'bill0001', amount: 5 },
      { id: 'bill0002', amount: 6, deletedAt: T1 },
    ],
  });
  assert.deepEqual(
    plan.bills.map(b => b.id),
    ['bill0001'],
  );
  assert.deepEqual(
    plan.deleted.bills.map(b => b.id),
    ['bill0002'],
  );
});

test('a plan as saved is already normal: cleaning it again changes no character (sync, the text cache)', () => {
  const prev = base();
  const next = JSON.parse(JSON.stringify(prev));
  next.trips[0].items = [];
  next.bills = next.bills.slice(1);
  const { plan } = stampPlan(prev, normPlan(next), T1);
  const text = JSON.stringify(plan);
  assert.equal(JSON.stringify(normPlan(JSON.parse(text))), text);
});

test('the 500 most recent deleted records are kept in full, older ones as small markers', () => {
  const raw = JSON.parse(JSON.stringify(base()));
  raw.deleted.items = Array.from({ length: 520 }, (_, i) => ({
    id: 'dead' + String(i).padStart(4, '0'),
    name: 'x',
    amount: 1,
    createdAt: T0,
    updatedAt: T0 + i,
    deletedAt: T0 + i,
  }));
  const plan = normPlan(raw);
  assert.equal(plan.deleted.items.length, 520, 'every deletion is still known');
  const oldest = plan.deleted.items.find(r => r.id === 'dead0000');
  assert.deepEqual(oldest, { id: 'dead0000', createdAt: T0, updatedAt: T0, deletedAt: T0 }, 'the oldest is a marker');
  assert.equal(plan.deleted.items.find(r => r.id === 'dead0519').name, 'x', 'the newest are kept in full');
  assert.equal(plan.deleted.items.filter(r => r.name === undefined).length, 20);
});

test('a deletion that is only a marker still wins over the record a device that never saw it has', () => {
  const live = { id: 'item0001', name: 'Old', amount: 5, month: '2027-01', createdAt: T0, updatedAt: T0 };
  const deleted = { id: 'item0001', createdAt: T0, updatedAt: T0 + 9, deletedAt: T0 + 9 };
  const here = JSON.parse(JSON.stringify(base()));
  here.items = [live];
  const there = JSON.parse(JSON.stringify(base()));
  there.items = [];
  there.deleted.items = [deleted];
  const merged = mergeData(
    { plans: [normPlan(here)], deletedPlans: {} },
    { plans: [normPlan(there)], deletedPlans: {} },
  ).plans[0];
  assert.equal(merged.items.length, 0, 'not brought back');
  assert.deepEqual(merged.deleted.items[0], deleted);
});

test('the plan’s own fields (settings, ticks, notes…) each have the time they last changed', () => {
  const prev = base();
  assert.deepEqual(Object.keys(prev.fieldsUpdatedAt), [
    'name',
    'settings',
    'fixes',
    'overrides',
    'reserveOver',
    'paid',
    'notes',
    'agenda',
    'sim',
  ]);
  assert.ok(Object.values(prev.fieldsUpdatedAt).every(t => t === T0));
  const next = JSON.parse(JSON.stringify(prev));
  next.notes['2026-12'] = 'Call the bank';
  next.bills[0].amount = 1; // a record change does not touch the fields' times
  const { plan } = stampPlan(prev, normPlan(next), T1);
  assert.equal(plan.fieldsUpdatedAt.notes, T1);
  assert.equal(plan.fieldsUpdatedAt.paid, T0);
  assert.equal(plan.fieldsUpdatedAt.settings, T0);
  const again = JSON.parse(JSON.stringify(plan));
  again.bills[1].amount = 2;
  const later = stampPlan(plan, normPlan(again), T2).plan;
  assert.equal(later.fieldsUpdatedAt.notes, T1, 'unchanged fields keep their time');
  assert.equal(later.updatedAt, T2);
});

test('the stored text leaves out what normPlan puts back, and reading it gives the same plan', () => {
  const plan = stampPlan(null, normPlan({ ...JSON.parse(JSON.stringify(base())) }), T0).plan;
  const text = planText(plan);
  assert.ok(!text.includes('"deletedAt":null'), 'no deletedAt: null');
  assert.ok(text.length < JSON.stringify(plan).length);
  assert.deepEqual(normPlan(JSON.parse(text)), plan);
});
