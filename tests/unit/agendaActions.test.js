/**
 * @file Unit tests for the actions of "My calendar" on the real store: what they change, what they leave alone, undo,
 * and that calendar-only changes reuse the projection instead of working it out again. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { D } from '../../src/core/dates.js';
import { Actions } from '../../src/state/actions.js';
import { Store } from '../../src/state/store.js';

/** A fresh store with one small plan (the browser storage does not exist in Node: saving fails quietly). */
function fresh() {
  Store.init();
  Store.undoS = [];
  Store.redoS = [];
  Store.undoChars = 0;
  Store.addPlan({
    name: 'Test',
    settings: { startMonth: '2026-11', horizon: 12, opening: 1000 },
    incomes: [{ name: 'Salary', amount: 2000, day: 1 }],
    bills: [{ id: 'groc0001', name: 'Groceries', amount: 300, budget: true, cat: 'food' }],
  });
  return Store.plan;
}
/** The plan without its agenda (and the times its change sets), to show an action left every other part alone. */
const money = plan => JSON.stringify({ ...plan, agenda: null, fieldsUpdatedAt: null, updatedAt: null });

test('an appointment is saved in the agenda only, and the projection is reused', () => {
  const plan = fresh();
  const proj = Store.proj;
  assert.ok(Actions.saveEntry({ id: 'dent0001', title: 'Dentist', date: '2026-11-10', time: '09:30' }));
  assert.equal(Store.plan.agenda.entries[0].title, 'Dentist');
  assert.equal(Store.proj, proj, 'nothing that counts changed: no new projection');
  assert.equal(money(Store.plan), money(plan));
  // edit, then undo back to nothing
  Actions.saveEntry({ ...Store.plan.agenda.entries[0], title: 'Dentist (moved)' });
  assert.equal(Store.plan.agenda.entries.length, 1);
  assert.equal(Store.plan.agenda.entries[0].title, 'Dentist (moved)');
  Store.undo();
  Store.undo();
  assert.deepEqual(Store.plan.agenda.entries, []);
});

test('one day of a repeating appointment can be left out, and the whole of it deleted', () => {
  fresh();
  Actions.saveEntry({ id: 'swim0001', title: 'Swim', date: '2026-11-03', repeat: 'week' });
  Actions.skipDay('swim0001', D.parse('2026-11-17'));
  assert.deepEqual(Store.plan.agenda.entries[0].skip, ['2026-11-17']);
  Actions.removeEntry('swim0001');
  assert.deepEqual(Store.plan.agenda.entries, []);
  Store.undo();
  assert.equal(Store.plan.agenda.entries.length, 1);
});

test('the calendar settings are saved in the agenda and cleaned', () => {
  fresh();
  Actions.setAgenda({ name: 'Home', layers: ['trip', 'bogus'], cats: ['food'], figure: 'none' });
  const { agenda } = Store.plan;
  assert.deepEqual([agenda.name, agenda.layers, agenda.cats, agenda.figure], ['Home', ['trip'], ['food'], 'none']);
});

test('a draft stays out of the plan until it is applied; applying is one step that Undo takes back', () => {
  const plan = fresh();
  const proj = Store.proj;
  Actions.saveDraft('items', {
    id: 'tv000001',
    name: 'TV',
    amount: 800,
    kind: 'out',
    date: '2026-11-20',
    cat: 'shopping',
  });
  Actions.saveDraft('trips', {
    id: 'rome0001',
    name: 'Rome',
    from: '2027-01-04',
    items: [{ name: 'Flights', amount: 150 }],
  });
  assert.equal(Store.proj, proj, 'drafts do not touch the projection');
  assert.equal(money(Store.plan), money(plan));
  assert.equal(Store.plan.agenda.drafts.items.length, 1);

  const end = Store.proj.summary.end;
  assert.ok(Actions.applyDrafts(['tv000001', 'rome0001']));
  assert.notEqual(Store.proj, proj, 'applied drafts count: a new projection');
  assert.equal(Store.proj.summary.end, end - 950);
  assert.deepEqual(
    Store.plan.items.map(i => i.id),
    ['tv000001'],
  );
  assert.deepEqual(
    Store.plan.trips.map(t => t.id),
    ['rome0001'],
  );
  assert.deepEqual(Store.plan.agenda.drafts, { items: [], trips: [] });

  Store.undo();
  assert.deepEqual(Store.plan.items, []);
  assert.equal(Store.plan.agenda.drafts.items.length, 1);
  assert.equal(Store.plan.agenda.drafts.trips.length, 1);
  assert.equal(Store.proj.summary.end, end);
});

test('a draft can be deleted, and applying nothing changes nothing', () => {
  fresh();
  Actions.saveDraft('items', { id: 'tv000001', name: 'TV', amount: 800, kind: 'out', date: '2026-11-20' });
  assert.equal(Actions.applyDrafts([]), false);
  assert.equal(Actions.applyDrafts(['nothere1']), false);
  Actions.removeDraft('items', 'tv000001');
  assert.deepEqual(Store.plan.agenda.drafts.items, []);
});

test('an own calendar can be added; deleting it takes its appointments with it', () => {
  fresh();
  Actions.setAgenda({ cals: [...Store.plan.agenda.cals, { id: 'work0001', name: 'Work', tone: 'trip' }] });
  Actions.saveEntry({ id: 'meet0001', title: 'Meeting', date: '2026-11-10', cal: 'work0001' });
  Actions.saveEntry({ id: 'gym00001', title: 'Gym', date: '2026-11-11', cal: 'personal' });
  Actions.removeCal('work0001');
  assert.deepEqual(
    Store.plan.agenda.cals.map(c => c.id),
    ['personal'],
  );
  assert.deepEqual(
    Store.plan.agenda.entries.map(e => e.id),
    ['gym00001'],
  );
  Store.undo();
  assert.equal(Store.plan.agenda.entries.length, 2);
});

test('an appointment whose money counts works the plan out again; one without money does not', () => {
  fresh();
  let proj = Store.proj;
  Actions.saveEntry({ id: 'dent0001', title: 'Dentist', date: '2026-11-10', amount: 60 });
  assert.equal(Store.proj, proj, 'money not counted yet changes no number');
  const end = Store.proj.summary.end;
  Actions.saveEntry({ ...Store.plan.agenda.entries[0], on: true });
  assert.notEqual(Store.proj, proj);
  assert.equal(Store.proj.summary.end, end - 60);
  proj = Store.proj;
  Actions.saveEntry({ id: 'walk0001', title: 'Walk', date: '2026-11-11' });
  assert.equal(Store.proj, proj, 'another appointment, without money: the projection is kept');
  Actions.removeEntry('dent0001');
  assert.equal(Store.proj.summary.end, end, 'deleting a counted one gives the money back');
});

test('applying an appointment money draft switches it on, in one step', () => {
  fresh();
  Actions.saveEntry({ id: 'dent0001', title: 'Dentist', date: '2026-11-10', amount: 60 });
  const end = Store.proj.summary.end;
  assert.ok(Actions.applyDrafts(['dent0001']));
  assert.equal(Store.plan.agenda.entries[0].on, true);
  assert.equal(Store.proj.summary.end, end - 60);
  Store.undo();
  assert.equal(Store.plan.agenda.entries[0].on, false);
});

test('one day, this and following, or every day of a repeating appointment, each one Undo step', () => {
  fresh();
  Actions.saveEntry({ id: 'swim0001', title: 'Swim', date: '2026-11-03', repeat: 'week', amount: 5, on: true });
  const end = Store.proj.summary.end;
  const entry = Store.plan.agenda.entries[0];
  const day = D.parse('2026-11-17');
  const steps = Store.undoS.length;
  Actions.editOccurrence('swim0001', day, { ...entry, date: '2026-11-17', amount: 8 }, 'one');
  assert.equal(Store.undoS.length, steps + 1);
  assert.equal(Store.plan.agenda.entries.length, 2);
  assert.equal(Store.proj.summary.end, end - 3, 'that day costs 3 more');
  assert.match(Store.db.log.at(-1).text, /17 Nov 2026 only/);
  Actions.deleteOccurrence('swim0001', D.parse('2026-12-01'), 'following');
  assert.equal(Store.plan.agenda.entries[0].until, '2026-11-30');
  Actions.deleteOccurrence('swim0001', day, 'all');
  assert.deepEqual(Store.plan.agenda.entries, [], 'every day takes the day changed on its own too');
  Store.undo();
  Store.undo();
  Store.undo();
  assert.equal(Store.plan.agenda.entries.length, 1);
  assert.equal(Store.proj.summary.end, end);
});

test('a ticked day of a counted appointment stays ticked when that day, or every day, is edited', () => {
  fresh();
  Actions.saveEntry({ id: 'swim0001', title: 'Swim', date: '2026-11-03', repeat: 'week', amount: 5, on: true });
  const day = D.parse('2026-11-17');
  Store.commit(p => (p.paid['2026-11'] = { ...(p.paid['2026-11'] || {}), [`appt:swim0001:${day}`]: true }), 'tick');
  const ticked = () =>
    Store.proj.months.flatMap(m => m.entries).filter(e => e.paid && String(e.key).startsWith('appt:'));
  assert.equal(ticked().length, 1);
  const entry = Store.plan.agenda.entries[0];
  Actions.editOccurrence('swim0001', day, { ...entry, date: '2026-11-17', note: 'Bring goggles' }, 'one');
  const own = Store.plan.agenda.entries.find(e => e.series === 'swim0001');
  assert.equal(ticked().length, 1, 'still paid after "this day only"');
  assert.equal(ticked()[0].key, `appt:${own.id}:${day}`);
  // every day moves one day later: the tick moves with its day
  Actions.editOccurrence(own.id, day, { ...own, date: '2026-11-18' }, 'all');
  assert.equal(ticked().length, 1, 'still paid after moving');
  assert.equal(ticked()[0].key, `appt:${own.id}:${day + 1}`);
  Store.undo();
  assert.equal(ticked()[0].key, `appt:${own.id}:${day}`, 'undo puts it back, in the same step');
});
