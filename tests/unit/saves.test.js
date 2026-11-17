/**
 * @file Every write sets the dates by itself: the actions (what the pages call) on the real store, with a clock.
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dbText } from '../../src/models/db.js';
import { normPlan } from '../../src/models/plan.js';
import { planText } from '../../src/models/records.js';
import { samplePlan } from '../../src/models/samplePlan.js';
import { Actions } from '../../src/state/actions.js';
import { Store } from '../../src/state/store.js';
import { memoryAdapter } from './helpers/fakeFiles.js';

let clock = 1_790_000_000_000;
const tick = () => (clock += 60_000);
/** A fresh store with the sample plan, saved at `clock`. */
function fresh() {
  Store.adapter = memoryAdapter();
  Store.now = () => clock;
  Store.later = () => {};
  Store.onNotify = () => {};
  Store.onChange = () => {};
  Store.init();
  Store.addPlan(samplePlan());
  Store.flush();
  return Store.plan;
}
const bill = name => Store.plan.bills.find(b => b.name === name);

test('adding a record: createdAt = updatedAt = now, deletedAt null', () => {
  fresh();
  const t = tick();
  Actions.save('bills', { id: 'newbill1', name: 'Climbing', amount: 40, cat: 'health', day: 3 });
  const b = bill('Climbing');
  assert.deepEqual([b.createdAt, b.updatedAt, b.deletedAt], [t, t, null]);
  assert.equal(Store.plan.updatedAt, t);
});

test('changing a record: updatedAt = now, createdAt kept; the others untouched', () => {
  const plan = fresh();
  const created = plan.bills[0].createdAt;
  const otherBefore = plan.bills[1].updatedAt;
  const t = tick();
  Actions.patch('bills', plan.bills[0].id, { amount: 999 }, 'Changed');
  assert.equal(Store.plan.bills[0].updatedAt, t);
  assert.equal(Store.plan.bills[0].createdAt, created);
  assert.equal(Store.plan.bills[1].updatedAt, otherBefore);
});

test('a page cannot set the dates itself: they are the store’s', () => {
  const plan = fresh();
  tick();
  const b = { ...plan.bills[0], createdAt: 5, updatedAt: 5 };
  assert.equal(Actions.save('bills', b), false, 'only the dates differ: nothing to save');
  assert.equal(Store.plan.bills[0].createdAt, plan.bills[0].createdAt);
  assert.equal(Store.plan.bills[0].updatedAt, plan.bills[0].updatedAt);
  // deletedAt set by hand means "deleted": it is, but at the store's time
  const t = tick();
  Actions.save('bills', { ...plan.bills[0], deletedAt: 5 });
  assert.ok(!Store.plan.bills.some(x => x.id === plan.bills[0].id));
  assert.equal(Store.plan.deleted.bills.find(x => x.id === plan.bills[0].id).deletedAt, t);
});

test('deleting a record keeps it, with deletedAt = now, out of the lists and totals', () => {
  const plan = fresh();
  const gone = plan.bills[0];
  const endBefore = Store.proj.summary.end;
  const t = tick();
  Actions.remove('bills', gone.id);
  assert.ok(!Store.plan.bills.some(b => b.id === gone.id));
  const kept = Store.plan.deleted.bills.find(b => b.id === gone.id);
  assert.deepEqual([kept.deletedAt, kept.updatedAt, kept.createdAt], [t, t, gone.createdAt]);
  assert.ok(Store.proj.summary.end > endBefore, 'the bill no longer counts');
  assert.ok(!Store.proj.months.some(m => m.entries.some(e => e.id === gone.id)));
});

test('undo brings a deleted record back, with updatedAt = now; redo deletes it again', () => {
  const plan = fresh();
  const gone = plan.bills[0];
  tick();
  Actions.remove('bills', gone.id);
  const t = tick();
  Store.undo();
  const back = Store.plan.bills.find(b => b.id === gone.id);
  assert.deepEqual([back.updatedAt, back.deletedAt], [t, null]);
  assert.ok(!Store.plan.deleted.bills.some(b => b.id === gone.id));
  const t2 = tick();
  Store.redo();
  assert.equal(Store.plan.deleted.bills.find(b => b.id === gone.id).deletedAt, t2);
});

test('copying a record: the copy is new, with its own dates', () => {
  const plan = fresh();
  const t = tick();
  Actions.duplicate('bills', plan.bills[0].id);
  const copy = Store.plan.bills.find(b => b.name === plan.bills[0].name + ' copy');
  assert.deepEqual([copy.createdAt, copy.updatedAt], [t, t]);
});

test('ticks, notes and settings are saves of the plan record', () => {
  fresh();
  const t = tick();
  Actions.setNote(Store.plan.settings.startMonth, 'Call the bank');
  assert.equal(Store.plan.updatedAt, t);
  const t2 = tick();
  Actions.settings({ ...Store.plan.settings, cushion: 700 }, {});
  assert.equal(Store.plan.updatedAt, t2);
});

test('renaming a plan changes its updatedAt; deleting it keeps it as deleted', () => {
  fresh();
  Store.addPlan(normPlan({ name: 'Second' }), false);
  const second = Object.values(Store.db.plans).find(p => p.name === 'Second');
  const t = tick();
  Store.renamePlan(second.id, 'Renamed');
  assert.equal(Store.db.plans[second.id].updatedAt, t);
  const t2 = tick();
  Store.removePlan(second.id);
  assert.ok(!Store.db.plans[second.id]);
  assert.deepEqual(Store.db.deletedPlans[second.id], {
    id: second.id,
    createdAt: second.createdAt,
    updatedAt: t2,
    deletedAt: t2,
  });
  Store.flush();
  assert.ok(JSON.parse(Store.adapter.text).deletedPlans[second.id], 'stored');
});

test('an imported plan keeps the dates of its records; the plan itself is new here', () => {
  fresh();
  const t = tick();
  const imported = normPlan({
    name: 'From a backup',
    bills: [{ id: 'oldbill1', name: 'Old', amount: 1, createdAt: 1000, updatedAt: 2000 }],
    createdAt: 500,
    updatedAt: 600,
  });
  const c = Store.addPlan({ ...imported, id: null }, false);
  assert.deepEqual([c.bills[0].createdAt, c.bills[0].updatedAt], [1000, 2000]);
  assert.deepEqual([c.createdAt, c.updatedAt], [t, t]);
});

test('what is saved is the state: the stored text and the dates', () => {
  fresh();
  tick();
  Actions.save('items', {
    id: 'item0new',
    name: 'Laptop',
    amount: 900,
    kind: 'out',
    month: Store.plan.settings.startMonth,
  });
  Actions.remove('items', 'item0new');
  Store.flush();
  assert.equal(Store.adapter.text, dbText(Store.db, planText));
  const stored = JSON.parse(Store.adapter.text);
  assert.equal(stored.schemaVersion, 8);
  assert.ok(stored.plans[Store.db.active].deleted.items.some(i => i.id === 'item0new'));
});
