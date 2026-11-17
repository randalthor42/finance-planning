/**
 * @file Simulation settings of a plan (`plan.sim`, Forecast › Simulation): how many runs, how far ahead, the seed,
 * the safety buffer, the person's own values for anything the simulation learned (overrides), and their what-if
 * scenarios. Kept in the plan, so they are in backups, Undo and the activity log. normPlan calls normSim; nothing in
 * here changes a number of the projection (logic/projection.js never reads it).
 *
 *   sim = {
 *     runs      Monte Carlo runs, 100 … 10 000 (2 000)
 *     horizon   months ahead: 3, 6, 12 or 24 (12)
 *     seed      the seed of the random numbers (same seed, same answer)
 *     buffer    the safety buffer for "below the buffer"; null: the plan's cushion
 *     cats      { [category]: { median?, spread?, off? } }   the middle and spread (MAD) of a month's spending, or left out
 *     events    { perYear?, size?, off? }                    large irregular expenses: how often, how big (median)
 *     incomes   { [incomeId]: { mode?, spread?, delay?, cutChance?, cutPct?, raiseChance?, raisePct? } }
 *     scenarios [{ id, name, changes: [{ kind, amount, percent, from, goal }] }]   what if
 *   }
 * A missing override means "as learned from history" (logic/sim/fit.js).
 */
import { M } from '../core/dates.js';
import { isObj, r2 } from '../core/util.js';
import { CATS } from './categories.js';

export const SIM_HORIZONS = [3, 6, 12, 24];
export const SIM_RUNS = { min: 100, max: 10000, default: 2000 };
/** What a change of a what-if scenario can be. */
export const CHANGE_KINDS = ['income', 'cost', 'oneoff', 'saving'];
const MAX_SCENARIOS = 20;
const MAX_CHANGES = 8;

/**
 * A fresh copy of the defaults.
 * @returns {import('../types.js').Sim}
 */
export const simDefaults = () => ({
  runs: SIM_RUNS.default,
  horizon: 12,
  seed: 1,
  buffer: null,
  cats: {},
  events: {},
  incomes: {},
  scenarios: [],
});

const num = (v, lo, hi) => {
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? r2(x) : undefined;
};
/** Only the keys that hold a valid value (an override that is not there means "as learned"). */
const compact = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Cleans simulation settings. `t` (from normPlan) has `id` (unique ids), `incomeIds` and `goalIds` of the plan, so
 * overrides and scenarios never point at something that is gone. Without it (a test), ids are only checked for shape.
 * @returns {import('../types.js').Sim} the clean settings
 */
export function normSim(raw, t = {}) {
  const d = simDefaults();
  const s = isObj(raw) ? raw : {};
  const id =
    t.id ||
    (v => (typeof v === 'string' && /^[a-z0-9]{4,16}$/.test(v) ? v : 'sc' + Math.random().toString(36).slice(2, 10)));
  const hasIncome = x => (t.incomeIds ? t.incomeIds.includes(x) : /^[a-z0-9]{4,16}$/.test(x));
  const hasGoal = x => (t.goalIds ? t.goalIds.includes(x) : typeof x === 'string');
  const runs = Math.round(num(s.runs, -Infinity, Infinity) ?? d.runs);
  const seed = Math.round(num(s.seed, -Infinity, Infinity) ?? d.seed);
  const cats = {};
  if (isObj(s.cats)) {
    for (const [cat] of CATS) {
      const o = s.cats[cat];
      if (isObj(o)) {
        const clean = compact({
          median: num(o.median, 0, 1e9),
          spread: num(o.spread, 0, 1e9),
          off: o.off === true ? true : undefined,
        });
        if (Object.keys(clean).length) {
          cats[cat] = clean;
        }
      }
    }
  }
  const e = isObj(s.events) ? s.events : {};
  const incomes = {};
  if (isObj(s.incomes)) {
    for (const [key, o] of Object.entries(s.incomes)) {
      if (!hasIncome(key) || !isObj(o)) {
        continue;
      }
      const clean = compact({
        mode: o.mode === 'fixed' || o.mode === 'variable' ? o.mode : undefined,
        spread: num(o.spread, 0, 1),
        delay: num(o.delay, 0, 1),
        cutChance: num(o.cutChance, 0, 1),
        cutPct: num(o.cutPct, 0, 1),
        raiseChance: num(o.raiseChance, 0, 1),
        raisePct: num(o.raisePct, 0, 1),
      });
      if (Object.keys(clean).length) {
        incomes[key] = clean;
      }
    }
  }
  const scenarios = (Array.isArray(s.scenarios) ? s.scenarios : [])
    .filter(isObj)
    .slice(0, MAX_SCENARIOS)
    .map(x => ({
      id: id(x.id),
      name: typeof x.name === 'string' && x.name.trim() ? x.name.trim().slice(0, 60) : 'What if',
      changes: (Array.isArray(x.changes) ? x.changes : [])
        .filter(c => isObj(c) && CHANGE_KINDS.includes(c.kind))
        .slice(0, MAX_CHANGES)
        .map(c => ({
          kind: c.kind,
          amount: num(c.amount, -1e9, 1e9) ?? 0,
          percent: num(c.percent, -100, 1000) ?? 0,
          from: M.parse(c.from) !== null ? c.from : null,
          goal: c.kind === 'saving' && hasGoal(c.goal) ? c.goal : null,
        })),
    }));
  return {
    runs: Math.min(SIM_RUNS.max, Math.max(SIM_RUNS.min, Number.isFinite(runs) ? runs : d.runs)),
    horizon: SIM_HORIZONS.includes(s.horizon) ? s.horizon : d.horizon,
    seed: seed >= 1 && seed < 2 ** 31 ? seed : Math.abs(seed % 2 ** 31) || d.seed,
    buffer: num(s.buffer, 0, 1e9) ?? null,
    cats,
    events: compact({
      perYear: num(e.perYear, 0, 100),
      size: num(e.size, 0, 1e9),
      off: e.off === true ? true : undefined,
    }),
    incomes,
    scenarios,
  };
}
