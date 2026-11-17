/**
 * @file Unit tests for the store: what it saves, the per-plan text cache that keeps saving cheap, and the hooks the
 * data file uses. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dbText, normDB } from '../../src/models/db.js';
import { normPlan } from '../../src/models/plan.js';
import { samplePlan } from '../../src/models/samplePlan.js';
import { planText } from '../../src/models/records.js';
import { PlanStore } from '../../src/state/store.js';
import { memoryAdapter } from './helpers/fakeFiles.js';

function storeWith(...plans) {
  const store = new PlanStore(memoryAdapter());
  store.init();
  for (const p of plans) {
    store.addPlan(p, false);
  }
  store.switchTo(Object.keys(store.db.plans)[0]);
  store.flush();
  return store;
}

test('the data file is off until turned on (existing data too); following other devices is on once it is', () => {
  const db = normDB(null);
  assert.equal(db.fileSync, false);
  assert.equal(normDB({ plans: {} }).fileSync, false, 'data saved before this option: off');
  assert.equal(normDB({ fileSync: true }).fileSync, true);
  assert.equal(db.fileWatch, true);
  assert.equal(normDB({ fileSync: false, fileWatch: false }).fileWatch, false);
  assert.equal(normDB({ fileSync: 'yes' }).fileSync, false, 'only true turns it on');
});

test('dbText writes exactly what JSON.stringify would, with plan texts from a cache', () => {
  const db = normDB({
    plans: { a: normPlan({ id: 'plana001', name: 'A' }), b: normPlan({ id: 'planb001', name: 'B' }) },
  });
  assert.equal(dbText(db), JSON.stringify(db));
  let calls = 0;
  const cached = plan => {
    calls++;
    return JSON.stringify(plan);
  };
  assert.equal(dbText(db, cached), JSON.stringify(db));
  assert.equal(calls, 2);
  const none = normDB(null);
  assert.equal(dbText(none), JSON.stringify(none));
});

test('what is saved always matches the state, after every kind of change', () => {
  const store = storeWith(samplePlan(), normPlan({ name: 'Second' }));
  const adapter = store.adapter;
  const check = label => {
    store.flush();
    assert.equal(adapter.text, dbText(store.db, planText), label);
  };
  store.commit(p => p.bills.push({ name: 'Climbing', amount: 30 }), 'add');
  check('commit');
  store.undo();
  check('undo');
  store.redo();
  check('redo');
  store.renamePlan(store.db.active, 'Renamed');
  check('rename');
  const other = Object.keys(store.db.plans).find(id => id !== store.db.active);
  store.renamePlan(other, 'Other renamed');
  check('rename other');
  store.setPref('theme', 'dark');
  check('pref');
  store.switchTo(other);
  store.commit(p => (p.settings.opening = 1234), 'opening');
  check('commit other');
  store.removePlan(other);
  check('remove');
});

test('a change serialises only the plan that changed', () => {
  const store = storeWith(samplePlan(), normPlan({ name: 'Second' }));
  const other = Object.values(store.db.plans).find(p => p.id !== store.db.active);
  const before = store.textOf(other);
  store.commit(p => p.bills.push({ name: 'Climbing', amount: 30 }), 'add');
  store.flush();
  // the same string, not an equal one: the untouched plan was not serialised again
  assert.ok(Object.is(store.textOf(other), before));
  assert.equal(store.textOf(store.plan), planText(store.plan));
});

test('renaming replaces the plan object, so a cached text can never be stale', () => {
  const store = storeWith(samplePlan());
  const plan = store.plan;
  store.textOf(plan);
  store.renamePlan(plan.id, 'New name');
  assert.notEqual(store.plan, plan);
  assert.equal(plan.name === 'New name', false, 'the old object is left as it was');
  assert.equal(JSON.parse(store.textOf(store.plan)).name, 'New name');
});

test('changing a preference does not clean every plan again', () => {
  const store = storeWith(samplePlan(), normPlan({ name: 'Second' }));
  const plans = Object.values(store.db.plans);
  store.setPref('theme', 'dark');
  store.setPref('layouts', { overview: { kpis: { x: 0, y: 0, w: 4, h: 2 } } });
  assert.deepEqual(Object.values(store.db.plans), plans);
  Object.values(store.db.plans).forEach((p, i) => assert.ok(p === plans[i]));
  assert.equal(store.db.theme, 'dark');
  assert.ok(store.db.layouts.overview.kpis);
  store.setPref('theme', 'purple');
  assert.equal(store.db.theme, 'auto', 'preferences are still cleaned');
});

test('planList gives every plan with its text, in order', () => {
  const store = storeWith(samplePlan(), normPlan({ name: 'Second' }));
  const list = store.planList();
  assert.deepEqual(
    list.map(p => p.id),
    Object.keys(store.db.plans),
  );
  for (const p of list) {
    assert.equal(p.text, planText(store.db.plans[p.id]));
    assert.ok(p.plan === store.db.plans[p.id]);
  }
});

test('onSaved is told after each write, so the data file can follow', () => {
  const store = storeWith(samplePlan());
  let saved = 0;
  store.onSaved = () => saved++;
  store.commit(p => p.bills.push({ name: 'Climbing', amount: 30 }), 'add');
  store.commit(p => p.bills.push({ name: 'Swimming', amount: 20 }), 'add 2');
  assert.equal(saved, 0, 'writes wait for the end of the task');
  store.flush();
  assert.equal(saved, 1, 'two changes, one write');
});

test('replacePlans: changes from the file replace the plans, keep undo when the open plan is untouched', () => {
  const store = storeWith(samplePlan(), normPlan({ name: 'Second' }));
  store.commit(p => p.bills.push({ name: 'Climbing', amount: 30 }), 'add');
  const open = store.plan;
  const other = Object.values(store.db.plans).find(p => p.id !== open.id);
  const changedOther = normPlan({ ...other, name: 'Second, from the file' });
  const rev = store.rev;
  let renders = 0;
  store.onChange = () => renders++;
  store.replacePlans([{ plan: open }, { plan: changedOther, text: planText(changedOther) }], 'From file');
  assert.equal(store.db.plans[other.id].name, 'Second, from the file');
  assert.equal(store.undoS.length, 1, 'undo still works on the open plan');
  assert.equal(store.rev, rev, 'the open plan did not change: no new projection');
  assert.equal(renders, 1);
  assert.equal(store.db.log.at(-1).text, 'From file');
  store.flush();
  assert.equal(store.adapter.text, dbText(store.db, planText));
});

test('replacePlans: when the open plan changed, the projection follows and undo starts again', () => {
  const store = storeWith(samplePlan());
  store.commit(p => p.bills.push({ name: 'Climbing', amount: 30 }), 'add');
  const changed = normPlan({ ...store.plan, settings: { ...store.plan.settings, opening: 4321 } });
  store.replacePlans([{ plan: changed }], 'From file');
  assert.equal(store.plan.settings.opening, 4321);
  assert.equal(store.proj.summary.s0 !== undefined, true);
  assert.equal(store.undoS.length, 0);
  assert.equal(store.redoS.length, 0);
});

test('replacePlans: the open plan deleted elsewhere opens the first one left; no plans at all is fine', () => {
  const store = storeWith(samplePlan(), normPlan({ name: 'Second' }));
  const other = Object.values(store.db.plans).find(p => p.id !== store.db.active);
  store.replacePlans([{ plan: other }], 'From file');
  assert.equal(store.db.active, other.id);
  store.replacePlans([], 'From file');
  assert.equal(store.db.active, null);
  assert.equal(store.plan, null);
});

test('adoptMerged: a merge result (Drive sync) replaces plans and takes its deleted plans as they are', () => {
  const store = storeWith(samplePlan(), normPlan({ name: 'Second' }));
  store.commit(p => p.bills.push({ name: 'Climbing', amount: 30 }), 'add');
  const open = store.plan;
  const other = Object.values(store.db.plans).find(p => p.id !== open.id);
  const stub = { id: other.id, createdAt: 5, updatedAt: 9, deletedAt: 9 };
  const rev = store.rev;
  store.adoptMerged([open], { [other.id]: stub }, 'Synced');
  assert.deepEqual(store.db.deletedPlans[other.id], stub, 'the stub of the other device, not a new one');
  assert.equal(store.db.plans[other.id], undefined);
  assert.equal(store.undoS.length, 1, 'the open plan is the same object: undo stays');
  assert.equal(store.rev, rev);
  assert.equal(store.db.log.at(-1).text, 'Synced');
  store.flush();
  assert.equal(store.adapter.text, dbText(store.db, planText));
});

test('storageUse counts what is really stored', () => {
  const store = storeWith(samplePlan());
  const use = store.storageUse();
  assert.equal(use.chars, dbText(store.db, planText).length + store.adapter.key.length);
});

/* Start-up: only the open plan is cleaned at once; the others when first needed, or when the browser is idle. */
function storedWith(...plans) {
  const adapter = memoryAdapter(normDB({ plans: Object.fromEntries(plans.map(p => [p.id, p])), active: plans[0].id }));
  adapter.text = dbText(JSON.parse(adapter.text), planText); // stored as the app stores it (planText)
  const store = new PlanStore(adapter);
  return { store, adapter };
}

test('start: the open plan is cleaned, the others wait, and what is saved does not change', async () => {
  const { normPlan: clean } = await import('../../src/models/plan.js');
  const { store, adapter } = storedWith(
    clean({ ...samplePlan(), id: 'open0001' }),
    clean({ name: 'Other', id: 'othr0001' }),
  );
  const text = adapter.text;
  store.init();
  assert.deepEqual([...store.pending], ['othr0001']);
  assert.equal(store.plan.id, 'open0001');
  store.savePending = true;
  store.flush();
  assert.equal(adapter.text, text, 'the same data is written');
  store.cleanPlans();
  assert.equal(store.pending.size, 0);
  assert.deepEqual(store.db.plans.othr0001, clean({ name: 'Other', id: 'othr0001' }));
});

test('a plan that was changed by hand in the storage is still cleaned before it is used', () => {
  const { store } = storedWith(normPlan({ name: 'Open', id: 'open0001' }), normPlan({ name: 'Other', id: 'othr0001' }));
  const raw = JSON.parse(store.adapter.text);
  raw.plans.othr0001.settings.horizon = 99999;
  raw.plans.othr0001.bills = [{ name: 'x', amount: -5 }, 'junk'];
  store.adapter.text = JSON.stringify(raw);
  store.init();
  store.switchTo('othr0001');
  assert.equal(store.plan.settings.horizon, 120);
  assert.equal(store.plan.bills.length, 1);
  assert.ok(store.plan.bills[0].amount >= 0);
});

test('everything that needs every plan cleans them first', () => {
  for (const use of [
    s => s.planList(),
    s => s.switchTo('othr0001'),
    s => s.renamePlan('othr0001', 'New name'),
    s =>
      s.replacePlans(
        s.planList().map(p => ({ plan: p.plan })),
        'x',
      ),
  ]) {
    const { store } = storedWith(
      normPlan({ name: 'Open', id: 'open0001' }),
      normPlan({ name: 'Other', id: 'othr0001' }),
    );
    store.init();
    use(store);
    assert.equal(store.pending.size, 0, use.toString());
  }
});

test('entries that do not look like stored plans are cleaned at once', () => {
  const adapter = memoryAdapter();
  adapter.text = JSON.stringify({
    active: 'open0001',
    plans: { a: { id: 'open0001', name: 'Open' }, b: { id: 'BAD ID', name: 'x' }, c: 7 },
  });
  const store = new PlanStore(adapter);
  store.init();
  assert.equal(store.pending.size, 0);
  // exactly what cleaning everything at once gives (a junk entry becomes an empty plan, as it always did)
  const all = normDB(JSON.parse(adapter.text));
  assert.deepEqual(
    Object.values(store.db.plans).map(p => p.name),
    Object.values(all.plans).map(p => p.name),
  );
});

test('data rewritten by an older version (dates dropped) gets the oldest date, so it cannot beat newer edits', () => {
  // what an older Runway leaves: format 6, no dates anywhere, in a browser that already stored dated data
  const plan = JSON.parse(JSON.stringify(normPlan(samplePlan())));
  const strip = r => {
    delete r.createdAt;
    delete r.updatedAt;
    delete r.deletedAt;
  };
  strip(plan);
  delete plan.deleted;
  delete plan.fieldsUpdatedAt;
  delete plan.keysUpdatedAt;
  plan.bills.forEach(strip);
  const adapter = memoryAdapter({ v: 6, plans: { [plan.id]: plan }, active: plan.id });
  adapter.schemaSeen = () => 8;
  adapter.markSchema = () => {};
  const store = new PlanStore(adapter);
  store.now = () => 1_790_000_000_000;
  store.later = () => {};
  store.init();
  assert.equal(store.plan.bills[0].updatedAt, 1, 'the oldest date, not now');
  assert.match(store.db.log.at(-1).text, /older Runway/);
});

test('data never stored with dates in this browser is migrated with today’s date', () => {
  const plan = JSON.parse(JSON.stringify(normPlan(samplePlan())));
  delete plan.bills[0].updatedAt;
  const adapter = memoryAdapter({ v: 6, plans: { [plan.id]: plan }, active: plan.id });
  adapter.schemaSeen = () => 0;
  let marked = 0;
  adapter.markSchema = v => (marked = v);
  const store = new PlanStore(adapter);
  store.now = () => 1_790_000_000_000;
  store.later = () => {};
  store.init();
  assert.equal(store.plan.bills[0].updatedAt, 1_790_000_000_000);
  assert.ok(marked >= 8, 'this browser now knows it stores dated data');
});

test('a clock put back never dates an edit before the version it replaces', () => {
  const store = storeWith(samplePlan());
  let clock = 2_000_000;
  store.clock = () => clock;
  store.commit(p => (p.bills[0].amount = 50), 'first');
  const first = store.plan.bills[0].updatedAt;
  clock = 1_000; // the device's clock was put back
  store.commit(p => (p.bills[0].amount = 60), 'second');
  assert.ok(store.plan.bills[0].updatedAt > first, 'still later than the edit before');
  assert.ok(store.plan.updatedAt > first);
});

test('a merged change from a device whose clock runs ahead does not make later edits here lose', () => {
  const store = storeWith(samplePlan());
  store.clock = () => 1_000_000;
  const ahead = { ...store.plan, name: 'From the future', updatedAt: 9_000_000 };
  store.adoptMerged([ahead], {}, 'merged');
  store.commit(p => (p.name = 'Mine, later'), 'rename');
  assert.ok(store.plan.updatedAt > 9_000_000);
});

test('a first start records that this browser stores dated data', () => {
  const adapter = memoryAdapter(null);
  let marked = 0;
  adapter.markSchema = v => (marked = v);
  const store = new PlanStore(adapter);
  store.later = () => {};
  store.init();
  assert.ok(marked >= 8);
});
