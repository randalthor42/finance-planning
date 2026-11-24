/**
 * @file Unit tests for the actions of Forecast › Simulation: settings, overrides and what-if scenarios are saved in
 * the plan, written down in the activity log, undoable, and never make the plan be worked out again.
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Actions } from '../../src/state/actions.js';
import { Store } from '../../src/state/store.js';

function fresh() {
  Store.init();
  Store.undoS = [];
  Store.addPlan({
    name: 'Test',
    settings: { startMonth: '2026-11', horizon: 12, opening: 1000 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 2000, day: 1 }],
  });
  Store.db.log = [];
}
const last = () => Store.db.log.at(-1).text;

test('settings are saved, cleaned and written down; the projection is kept', () => {
  fresh();
  const proj = Store.proj;
  Actions.setSim({ horizon: 24, runs: 5000 });
  assert.deepEqual([Store.plan.sim.horizon, Store.plan.sim.runs], [24, 5000]);
  assert.equal(Store.proj, proj);
  assert.equal(last(), 'Simulation: 24 months ahead · 5000 runs');
  Actions.setSim({ buffer: 400 });
  assert.match(last(), /buffer/);
  Store.undo();
  assert.equal(Store.plan.sim.buffer, null);
});

test('an own value for what the simulation learned, and back to what it learned', () => {
  fresh();
  Actions.setSimOverride('cats', 'food', { median: 450, spread: 60 });
  assert.deepEqual(Store.plan.sim.cats.food, { median: 450, spread: 60 });
  assert.equal(last(), 'Simulation: your own values for Food & groceries');
  Actions.setSimOverride('cats', 'food', null);
  assert.equal(Store.plan.sim.cats.food, undefined);
  assert.equal(last(), 'Simulation: Food & groceries back to what was learned');
  Actions.setSimOverride('incomes', 'salary01', { delay: 0.1 });
  assert.equal(last(), 'Simulation: your own values for Salary');
  Actions.setSimOverride('events', null, { perYear: 2, size: 800 });
  assert.deepEqual(Store.plan.sim.events, { perYear: 2, size: 800 });
  assert.equal(last(), 'Simulation: your own values for Large irregular expenses');
});

test('what-if scenarios are added, changed and deleted, each written down', () => {
  fresh();
  Actions.saveScenario({ id: 'what0001', name: 'New car', changes: [{ kind: 'cost', amount: 250, from: '2027-03' }] });
  assert.equal(Store.plan.sim.scenarios[0].name, 'New car');
  assert.equal(last(), 'Added the what-if “New car”');
  Actions.saveScenario({ ...Store.plan.sim.scenarios[0], name: 'New car, cheaper' });
  assert.equal(last(), 'Updated the what-if “New car, cheaper”');
  Actions.removeScenario('what0001');
  assert.deepEqual(Store.plan.sim.scenarios, []);
  assert.equal(last(), 'Deleted the what-if “New car, cheaper”');
});
