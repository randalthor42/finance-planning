/**
 * @file View state (which page, which month) and selectors over the current projection.
 */
import { D, M, Period } from '../core/dates.js';
import { clamp } from '../core/util.js';
import { Store } from '../state/store.js';

/* --- 6.2 view state (not saved with the plan) --- */
export const UI = {
  ttab: 'hours',
  stab: 'general',
  tools: { name: '', price: 0, cost: 0, uPrice: 0, uses: 0 },
  view: 'overview',
  month: null,
  mview: 'list',
  fview: 'month',
  rview: 'month',
  payExtra: 50,
  series: { save: true, debt: true },
  open: new Set(),
  itemFilter: 'upcoming',
  afford: { amount: 0, month: null },
  /** The "Check against reality" card was closed for this visit. Not saved: it is back after a reload. */
  hideCheck: false,
  /** Groups of the month planner that are folded away (Income, Bills, …). */
  closedGroups: new Set(),
  /** Sort of each data table by its id: { column, descending }. */
  sort: {},
  /** Audit page: show the ledger of the current month or of the whole plan. */
  auditScope: 'month',
  /** Forecast page: which way of looking ahead, and its two inputs. */
  forecast: { type: 'plan', sampleMonths: 4, percent: 10 },
};
export const nowK = () => (Store.plan ? Period.now(Store.plan.settings) : M.now());
export const curK = () => {
  const summary = Store.proj.summary;
  return clamp(nowK(), summary.s0, summary.s0 + summary.n - 1);
};
export const selK = () => {
  const summary = Store.proj.summary;
  return UI.month === null ? curK() : clamp(UI.month, summary.s0, summary.s0 + summary.n - 1);
};
export const monthAt = k => Store.proj.months[k - Store.proj.summary.s0];
export const rangeLabel = m => `${D.label(m.start)} to ${D.label(m.end, { year: 'numeric' })}`;
