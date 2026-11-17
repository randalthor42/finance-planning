/**
 * @file Unit tests for merging two copies of the data record by record (models/recordMerge.js): the newer updatedAt
 * wins per id, deletions (tombstones) travel, a plan's own fields merge one by one. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeData } from '../../src/models/recordMerge.js';
import { normPlan } from '../../src/models/plan.js';
import { stampPlan } from '../../src/models/records.js';

const T0 = 1_790_000_000_000;
const at = n => T0 + n * 60_000;
/** A plan as the store saves it, at time t. */
const saved = (raw, prev = null, t = at(0)) => stampPlan(prev, normPlan(raw), t).plan;
/** Changes a saved plan like the store does (fn on a copy), at time t. */
const edit = (plan, fn, t) => {
  const draft = JSON.parse(JSON.stringify(plan));
  fn(draft);
  return stampPlan(plan, normPlan(draft), t).plan;
};
const base = () =>
  saved({
    id: 'plan0001',
    name: 'Home',
    settings: { startMonth: '2026-11', horizon: 12 },
    bills: [
      { id: 'bill0001', name: 'Rent', amount: 800 },
      { id: 'bill0002', name: 'Gym', amount: 30 },
    ],
    items: [{ id: 'item0001', name: 'Laptop', amount: 900, month: '2027-02' }],
    trips: [
      { id: 'trip0001', name: 'Rome', month: '2027-04', items: [{ id: 'titm0001', name: 'Flights', amount: 200 }] },
    ],
  });
const db = (...plans) => ({ plans: Object.fromEntries(plans.map(p => [p.id, p])), deletedPlans: {} });
const bill = (r, id) => r.plans.find(p => p.id === 'plan0001').bills.find(b => b.id === id);

test('the same data on both sides: nothing changes anywhere', () => {
  const p = base();
  const r = mergeData(db(p), db(JSON.parse(JSON.stringify(p))));
  assert.equal(r.localChanged, false);
  assert.equal(r.remoteChanged, false);
  assert.ok(r.plans[0] === p, 'the local plan object is kept as it is');
});

test('two devices edit the same record: the newer edit wins, on both', () => {
  const p = base();
  const a = edit(p, d => (d.bills[0].amount = 850), at(1));
  const b = edit(p, d => (d.bills[0].amount = 900), at(2));
  const onA = mergeData(db(a), db(b));
  const onB = mergeData(db(b), db(a));
  assert.equal(bill(onA, 'bill0001').amount, 900);
  assert.equal(bill(onB, 'bill0001').amount, 900);
  assert.equal(onA.localChanged, true);
  assert.equal(onA.remoteChanged, false, 'the other side already has the winner');
  assert.equal(onB.localChanged, false);
  assert.equal(bill(onA, 'bill0001').updatedAt, at(2));
});

test('two devices edit different records of the same plan: both edits are kept', () => {
  const p = base();
  const a = edit(p, d => (d.bills[0].amount = 850), at(1));
  const b = edit(p, d => (d.bills[1].amount = 45), at(2));
  const r = mergeData(db(a), db(b));
  assert.equal(bill(r, 'bill0001').amount, 850);
  assert.equal(bill(r, 'bill0002').amount, 45);
  assert.equal(r.localChanged, true);
  assert.equal(r.remoteChanged, true);
});

test('a deletion travels: the tombstone is newer than the record', () => {
  const p = base();
  const a = edit(p, d => (d.bills = d.bills.filter(x => x.id !== 'bill0002')), at(1));
  const r = mergeData(db(p), db(a));
  const plan = r.plans[0];
  assert.ok(!plan.bills.some(x => x.id === 'bill0002'), 'gone from the list');
  assert.equal(plan.deleted.bills.find(x => x.id === 'bill0002').deletedAt, at(1), 'kept as deleted, with its date');
  assert.equal(r.localChanged, true);
  assert.equal(r.remoteChanged, false);
});

test('an edit newer than a deletion brings the record back', () => {
  const p = base();
  const deleted = edit(p, d => (d.bills = d.bills.filter(x => x.id !== 'bill0002')), at(1));
  const edited = edit(p, d => (d.bills[1].amount = 99), at(2));
  const r = mergeData(db(deleted), db(edited));
  assert.equal(bill(r, 'bill0002').amount, 99);
  assert.ok(!r.plans[0].deleted.bills.some(x => x.id === 'bill0002'));
});

test('a record added on each device: both are there', () => {
  const p = base();
  const a = edit(p, d => d.items.push({ id: 'itemaaaa', name: 'From A', amount: 1, month: '2027-01' }), at(1));
  const b = edit(p, d => d.items.push({ id: 'itembbbb', name: 'From B', amount: 2, month: '2027-01' }), at(2));
  const r = mergeData(db(a), db(b));
  assert.deepEqual(r.plans[0].items.map(i => i.id).sort(), ['item0001', 'itemaaaa', 'itembbbb']);
});

test('a plan’s own fields merge one by one: a tick on one device and a note on the other are both kept', () => {
  const p = base();
  const a = edit(p, d => (d.paid['2026-11'] = { 'bill:bill0001': true }), at(1));
  const b = edit(p, d => (d.notes['2026-12'] = 'Call the bank'), at(2));
  const r = mergeData(db(a), db(b));
  assert.deepEqual(r.plans[0].paid['2026-11'], { 'bill:bill0001': true });
  assert.equal(r.plans[0].notes['2026-12'], 'Call the bank');
  assert.equal(r.plans[0].fieldsUpdatedAt.paid, at(1));
  assert.equal(r.plans[0].fieldsUpdatedAt.notes, at(2));
});

test('ticks made on two devices in different months are both kept, on both devices', () => {
  const p = base();
  const a = edit(p, d => (d.paid['2026-11'] = { 'bill:bill0001': true }), at(1));
  const b = edit(p, d => (d.paid['2026-12'] = { 'bill:bill0002': true }), at(2));
  const onA = mergeData(db(a), db(b)).plans[0];
  const onB = mergeData(db(b), db(a)).plans[0];
  assert.deepEqual(onA.paid, { '2026-11': { 'bill:bill0001': true }, '2026-12': { 'bill:bill0002': true } });
  assert.deepEqual(onB.paid, onA.paid, 'both devices end the same');
  assert.deepEqual(onB.keysUpdatedAt, onA.keysUpdatedAt);
});

test('two lines ticked in the same month on two devices are both kept; a later untick wins', () => {
  const p = base();
  const a = edit(p, d => (d.paid['2026-11'] = { 'bill:bill0001': true }), at(1));
  const b = edit(p, d => (d.paid['2026-11'] = { 'bill:bill0002': true }), at(2));
  const merged = mergeData(db(a), db(b)).plans[0];
  assert.deepEqual(merged.paid['2026-11'], { 'bill:bill0001': true, 'bill:bill0002': true });
  // A unticks Rent after the merge; B still has it ticked from before: the untick is newer and wins
  const unticked = edit(merged, d => delete d.paid['2026-11']['bill:bill0001'], at(3));
  const again = mergeData(db(b), db(unticked)).plans[0];
  assert.deepEqual(again.paid['2026-11'], { 'bill:bill0002': true });
});

test('corrections and notes merge month by month', () => {
  const p = base();
  const a = edit(p, d => (d.notes['2026-11'] = 'From A'), at(1));
  const b = edit(p, d => (d.notes['2026-12'] = 'From B'), at(2));
  const merged = mergeData(db(a), db(b)).plans[0];
  assert.deepEqual(merged.notes, { '2026-11': 'From A', '2026-12': 'From B' });
});

test('the same time with different content: both devices make the same choice', () => {
  const p = base();
  const a = edit(p, d => (d.bills[0].amount = 810), at(1));
  const b = edit(p, d => (d.bills[0].amount = 820), at(1));
  const onA = bill(mergeData(db(a), db(b)), 'bill0001').amount;
  const onB = bill(mergeData(db(b), db(a)), 'bill0001').amount;
  assert.equal(onA, onB);
});

test('merging is idempotent: the merged result merged again with either side changes nothing', () => {
  const p = base();
  const a = edit(p, d => (d.paid['2026-11'] = { 'bill:bill0001': true }), at(1));
  const b = edit(p, d => (d.paid['2026-12'] = { 'bill:bill0002': true }), at(2));
  const merged = mergeData(db(a), db(b)).plans[0];
  const again = mergeData(db(merged), db(merged));
  assert.equal(again.localChanged, false);
  assert.equal(again.remoteChanged, false);
});

test('600 entries deleted on one device stay deleted when merged with a device that still has them', () => {
  const many = saved({
    ...JSON.parse(JSON.stringify(base())),
    items: Array.from({ length: 600 }, (_, i) => ({
      id: 'old' + String(i).padStart(5, '0'),
      name: 'Coffee',
      amount: 3,
      month: '2026-11',
    })),
  });
  const cleared = edit(many, d => (d.items = []), at(5));
  assert.equal(cleared.deleted.items.length, 600, 'every deletion is kept (the older ones as markers)');
  const onA = mergeData(db(cleared), db(many)).plans[0];
  const onB = mergeData(db(many), db(cleared)).plans[0];
  assert.equal(onA.items.length, 0, 'none come back here');
  assert.equal(onB.items.length, 0, 'and the other device deletes them all');
});

test('costs of a trip travel with their trip; a deleted cost stays deleted', () => {
  const p = base();
  const a = edit(p, d => (d.trips[0].items = []), at(1));
  const r = mergeData(db(p), db(a));
  assert.deepEqual(r.plans[0].trips[0].items, []);
  assert.equal(r.plans[0].deleted.tripItems[0].id, 'titm0001');
});

test('a cost deleted on one device stays deleted when the trip is renamed later on the other', () => {
  const p = base();
  const a = edit(p, d => (d.trips[0].items = []), at(1));
  const b = edit(p, d => (d.trips[0].name = 'Rome and Naples'), at(2));
  for (const r of [mergeData(db(a), db(b)), mergeData(db(b), db(a))]) {
    const trip = r.plans[0].trips[0];
    assert.equal(trip.name, 'Rome and Naples', 'the later rename');
    assert.deepEqual(trip.items, [], 'the deleted cost did not come back');
  }
});

test('costs added to one trip on two devices are both kept, in the same order on both', () => {
  const p = base();
  const a = edit(p, d => d.trips[0].items.push({ id: 'titm000a', name: 'Hotel', amount: 300 }), at(1));
  const b = edit(p, d => d.trips[0].items.push({ id: 'titm000b', name: 'Museums', amount: 40 }), at(2));
  const onA = mergeData(db(a), db(b)).plans[0].trips[0].items.map(i => i.id);
  const onB = mergeData(db(b), db(a)).plans[0].trips[0].items.map(i => i.id);
  assert.deepEqual(onA, onB);
  assert.deepEqual([...onA].sort(), ['titm0001', 'titm000a', 'titm000b']);
});

test('a plan made on the other device arrives; one deleted there is deleted here, unless it changed here since', () => {
  const p = base();
  const other = saved({ id: 'plan0002', name: 'Second', settings: { startMonth: '2026-11' } }, null, at(1));
  let r = mergeData(db(p), db(p, other));
  assert.deepEqual(
    r.plans.map(x => x.id),
    ['plan0001', 'plan0002'],
  );
  assert.equal(r.localChanged, true);
  const gone = {
    plans: {},
    deletedPlans: { plan0001: { id: 'plan0001', createdAt: at(0), updatedAt: at(3), deletedAt: at(3) } },
  };
  r = mergeData(db(p), gone);
  assert.deepEqual(r.plans, []);
  assert.equal(r.deletedPlans.plan0001.deletedAt, at(3));
  const changedHere = edit(p, d => (d.bills[0].amount = 1), at(4));
  r = mergeData(db(changedHere), gone);
  assert.deepEqual(
    r.plans.map(x => x.id),
    ['plan0001'],
    'a change after the deletion keeps the plan',
  );
  assert.equal(r.remoteChanged, true);
});

test('both devices end with the same data: merging again changes nothing (no ping-pong)', () => {
  const p = base();
  const a = edit(
    edit(p, d => (d.bills[0].amount = 850), at(1)),
    d => d.items.push({ id: 'itemaaaa', name: 'A', amount: 1, month: '2027-01' }),
    at(3),
  );
  const b = edit(
    edit(p, d => (d.bills = d.bills.slice(1)), at(2)),
    d => (d.notes['2027-01'] = 'B'),
    at(4),
  );
  const first = mergeData(db(a), db(b)); // a pulls b, then pushes
  const pushed = { plans: Object.fromEntries(first.plans.map(x => [x.id, x])), deletedPlans: first.deletedPlans };
  const second = mergeData(db(b), JSON.parse(JSON.stringify(pushed))); // b pulls what a pushed
  assert.equal(second.remoteChanged, false);
  assert.equal(JSON.stringify(second.plans), JSON.stringify(first.plans));
  const third = mergeData(
    pushed,
    JSON.parse(
      JSON.stringify({
        plans: Object.fromEntries(second.plans.map(x => [x.id, x])),
        deletedPlans: second.deletedPlans,
      }),
    ),
  );
  assert.equal(third.localChanged, false);
  assert.equal(third.remoteChanged, false);
});

test('records from an old backup (no dates) never win over dated ones here, and new ones are added', () => {
  const p = base();
  const legacy = JSON.parse(JSON.stringify(p));
  legacy.bills[0].amount = 1;
  legacy.bills.push({ ...legacy.bills[0], id: 'billold1', name: 'Only in the backup' });
  for (const b of legacy.bills) {
    b.createdAt = null;
    b.updatedAt = null;
  }
  const r = mergeData(db(p), db(normPlan(legacy)));
  assert.equal(bill(r, 'bill0001').amount, 800, 'the dated version here wins');
  assert.ok(bill(r, 'billold1'), 'the new one is added');
  assert.ok(bill(r, 'billold1').updatedAt > 0, 'with a date (the oldest possible)');
});

test('what a merge would do here, for the import preview', () => {
  const p = base();
  const other = edit(
    edit(p, d => (d.bills[0].amount = 850), at(1)),
    d => {
      d.items.push({ id: 'itemnew1', name: 'New', amount: 1, month: '2027-01' });
      d.bills = d.bills.filter(x => x.id !== 'bill0002');
    },
    at(2),
  );
  const extra = saved({ id: 'plan0002', name: 'Second' }, null, at(1));
  const r = mergeData(db(p), db(other, extra));
  const home = r.summary.find(s => s.id === 'plan0001');
  assert.deepEqual([home.status, home.added, home.updated, home.deleted], ['merged', 1, 1, 1]);
  assert.deepEqual(r.summary.find(s => s.id === 'plan0002').status, 'new');
});

test('a merged plan is already clean: normPlan changes no character of it', () => {
  const p = base();
  const a = edit(
    p,
    d => {
      d.bills[0].amount = 850;
      d.trips[0].items = [];
    },
    at(1),
  );
  const b = edit(
    p,
    d => {
      d.bills = d.bills.slice(1);
      d.notes['2027-01'] = 'x';
    },
    at(2),
  );
  for (const plan of mergeData(db(a), db(b)).plans) {
    const text = JSON.stringify(plan);
    assert.equal(JSON.stringify(normPlan(JSON.parse(text))), text);
  }
});

test('change times are kept in sorted order: a plan merged with an identical copy of itself changes nothing', () => {
  let p = base();
  p = edit(p, d => (d.paid['2027-03'] = { 'bill:bill0001': true }), at(1));
  p = edit(p, d => (d.paid['2027-01'] = { 'bill:bill0001': true }), at(2));
  assert.deepEqual(Object.keys(p.keysUpdatedAt.paid.at), [...Object.keys(p.keysUpdatedAt.paid.at)].sort());
  const r = mergeData(db(p), db(JSON.parse(JSON.stringify(p))));
  assert.equal(r.localChanged, false);
  assert.equal(r.remoteChanged, false);
  assert.equal(r.plans[0], p, 'the same object: undo stays');
});

test('months before the plan’s first month keep no change times', () => {
  const p = edit(base(), d => (d.paid['2026-11'] = { 'bill:bill0001': true }), at(1));
  assert.ok(p.keysUpdatedAt.paid.at['2026-11 bill:bill0001']);
  const rolled = normPlan({ ...p, settings: { ...p.settings, startMonth: '2027-01' } });
  assert.deepEqual(rolled.keysUpdatedAt.paid.at, {}, 'dropped once the plan starts later');
});
