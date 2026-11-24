/**
 * @file Unit tests for the activity log: every change is written down, in words, including changes that are not plan
 * data (preferences, layouts, switching plans) and each change made inside one Undo step. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { agendaChanges } from '../../src/state/agendaLog.js';
import { Actions } from '../../src/state/actions.js';
import { Store } from '../../src/state/store.js';

function fresh() {
  Store.init();
  Store.undoS = [];
  Store.redoS = [];
  Store.undoChars = 0;
  Store.addPlan({
    name: 'Test',
    settings: { startMonth: '2026-11', horizon: 12, opening: 1000 },
    bills: [{ id: 'rent0001', name: 'Rent', amount: 800, day: 2, cat: 'housing' }],
    trips: [{ id: 'rome0001', name: 'Rome', from: '2026-12-04' }],
  });
  Store.db.log = [];
}
const lines = () => Store.db.log.map(e => e.text);
const last = () => lines().at(-1);

test('a preference is written down, with the words the page gives it', () => {
  fresh();
  Store.setPref('theme', 'dark', 'Theme: Dark');
  assert.equal(last(), 'Theme: Dark');
  Store.setPref('tripView', 'list');
  assert.match(last(), /tripView/, 'without words, the name of the setting');
});

test('a preference set to what it already is writes nothing', () => {
  fresh();
  Store.setPref('theme', Store.db.theme, 'Theme: same');
  assert.deepEqual(lines(), []);
});

test('changes that share one Undo step can still each have their own line', () => {
  fresh();
  Store.tag = 'session';
  Actions.setAgenda({ layers: ['inc'] });
  Actions.setAgenda({ figure: 'none' });
  Store.tag = null;
  assert.equal(Store.undoS.length, 1, 'one Undo step');
  assert.equal(lines().length, 2, 'two lines');
  Store.undo();
  assert.deepEqual(Store.plan.agenda.layers, ['inc', 'bill', 'trip']);
  assert.equal(Store.plan.agenda.figure, 'balance');
});

test('switching plans, clearing the log and erasing everything are written down too', () => {
  fresh();
  const first = Store.db.active;
  Store.addPlan({ name: 'Second' });
  Store.switchTo(first);
  assert.equal(last(), 'Opened plan “Test”');
  assert.equal(lines().filter(t => t.startsWith('Opened')).length, 1, 'adding a plan says so once, not "opened" too');
  Store.clearLog();
  assert.deepEqual(lines(), ['Cleared the activity log']);
  Store.wipe();
  assert.deepEqual(lines(), ['Erased all data in this browser']);
});

test('Store.note writes a line at once, for changes made outside the plan (a language)', () => {
  fresh();
  Store.note('Language: Español');
  assert.equal(last(), 'Language: Español');
});

test('agendaChanges says what changed in the calendar, in words', () => {
  const plan = normPlan({
    bills: [{ id: 'rent0001', name: 'Rent', amount: 800 }],
    trips: [{ id: 'rome0001', name: 'Rome', from: '2026-12-04' }],
  });
  const a = plan.agenda;
  const say = change => agendaChanges(a, { ...a, ...change }, plan);
  assert.deepEqual(say({ name: 'Family' }), ['Renamed your calendar to “Family”']);
  assert.deepEqual(say({ name: '' }), [], 'no change, no words');
  assert.deepEqual(say({ layers: [...a.layers, 'spend'] }), ['Your calendar shows Transactions']);
  assert.deepEqual(say({ layers: ['inc', 'trip'] }), ['Your calendar no longer shows Bills']);
  assert.deepEqual(say({ cats: ['food'] }), ['Spending shown on your calendar: Food & groceries']);
  assert.deepEqual(say({ figure: 'none' }), ['Number on each day of your calendar: Nothing']);
  assert.deepEqual(say({ pins: [{ list: 'trips', id: 'rome0001' }] }), ['“Rome” is always on your calendar']);
  const withPin = { ...a, pins: [{ list: 'bills', id: 'rent0001' }] };
  assert.deepEqual(agendaChanges(withPin, a, plan), ['“Rent” is no longer always on your calendar']);
  const work = { id: 'work0001', name: 'Work', tone: 'trip' };
  assert.deepEqual(say({ cals: [...a.cals, work] }), ['Added the calendar “Work”']);
  const twoCals = { ...a, cals: [...a.cals, work] };
  assert.deepEqual(agendaChanges(twoCals, { ...twoCals, cals: [a.cals[0], { ...work, name: 'Job' }] }, plan), [
    'Renamed the calendar “Work” to “Job”',
  ]);
  assert.deepEqual(agendaChanges(twoCals, { ...twoCals, cals: [a.cals[0], { ...work, tone: 'good' }] }, plan), [
    'Changed the colour of the calendar “Work”',
  ]);
});
