/**
 * @file Runs the simulation of the open plan for the page (Forecast › Simulation, and the month planner's forecast
 * view): loads it the first time (services/lazySim.js), learns from history, simulates the baseline and the chosen
 * what-if with the same seed, backtests, and keeps the answer while nothing it depends on changes.
 *
 * It is asynchronous: simulation() answers at once with what it has ('loading' the first time, the previous answer
 * marked `stale` while a new one is worked out) and calls `done` when the new one is ready, so the page draws again.
 */
import { Period } from '../core/dates.js';
import { loadSimulation } from '../services/lazySim.js';
import { Store } from '../state/store.js';

/** Backtests never need more runs than this to tell inside from outside the bands. */
const BACKTEST_RUNS = 1000;

const S = { key: null, value: null, error: null, last: null };

/** What the answer depends on: the plan and its projection (rev), the day, the settings and the what-if chosen. */
const keyOf = scenarioId => JSON.stringify([Store.db.active, Store.rev, Store.day, Store.plan.sim, scenarioId]);

/**
 * The simulation of the open plan with what-if `scenarioId` (or null). Returns { status: 'loading' | 'ready' |
 * 'error', stale?, model, result, compare, scenario, check, risks, error }. `done` is called when a new answer is ready.
 * @returns {{status: 'loading'|'ready'|'error', stale?: boolean, model?: object, result?: object, compare?: ?object, scenario?: ?object, error?: Error}}
 */
export function simulation(scenarioId, done) {
  const key = keyOf(scenarioId);
  if (S.key === key) {
    if (S.value) {
      return { status: 'ready', ...S.value };
    }
    if (S.error) {
      return { status: 'error', error: S.error };
    }
  } else {
    S.key = key;
    S.value = null;
    S.error = null;
    compute(key, scenarioId).then(
      value => {
        if (S.key === key) {
          S.value = value;
          S.last = value;
          done();
        }
      },
      error => {
        if (S.key === key) {
          S.error = error;
          done();
        }
      },
    );
  }
  // while the new answer is worked out, the last one of this plan stays on screen, marked as being updated
  const last = S.last && S.last.planId === Store.plan.id ? S.last : null;
  return last ? { status: 'ready', stale: true, ...last } : { status: 'loading' };
}

/**
 * Forgets the last answer (another plan was opened: its numbers must not show for this one).
 * @returns {void}
 */
export function forgetSimulation() {
  S.key = null;
  S.value = null;
  S.last = null;
}

const frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function compute(key, scenarioId) {
  const Sim = await loadSimulation();
  await frame(); // the page shows "Simulating…" before the work starts
  if (S.key !== key) {
    return null;
  }
  const plan = Store.plan;
  const settings = plan.sim;
  const today = Store.day;
  const now = Period.of(plan.settings, today);
  const model = Sim.fitModel(plan, { now });
  const base = Sim.baseFlows(plan, Store.proj, { today, horizon: settings.horizon, extraIncome: !!model.extraIncome });
  const input = { base, model, settings, cushion: plan.settings.cushion };
  const result = await Sim.simulateInChunks(input);
  const scenario = scenarioId ? settings.scenarios.find(s => s.id === scenarioId) || null : null;
  const compare = scenario ? await Sim.simulateInChunks({ ...input, scenario }) : null;
  const check = Sim.backtest(plan, { now, runs: Math.min(BACKTEST_RUNS, settings.runs), seed: settings.seed });
  return { model, result, compare, scenario, check, risks: Sim.risksOf(result, model, check), planId: plan.id };
}
