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
  /** Month planner layout: 'list' (by type), 'days' (day by day) or 'calendar'. */
  mview: 'list',
  fview: 'month',
  rview: 'month',
  payExtra: 50,
  series: { save: true, debt: true },
  /** Cash chart: '6' or '12' months from now, or 'all' (the whole plan). */
  chartRange: '12',
  /** Last measured width of each chart (px), so a redraw does not draw it twice. */
  chartWidth: {},
  open: new Set(),
  itemFilter: 'upcoming',
  /** Transactions page: search text, filters and order, for this visit. */
  logFilter: { text: '', kind: 'all', budget: '', order: 'new' },
  /** Transactions page: how many lines are drawn (grows by 200 with "Show more"). */
  logLimit: 200,
  afford: { amount: 0, month: null },
  /** The budget the last spend was logged against, for "Log a spend" (this visit only). */
  lastBudget: null,
  /** The "Check against reality" card was closed for this visit. Not saved: it is back after a reload. */
  hideCheck: false,
  /** Overview: every insight is shown, not only the three most urgent. */
  insightsAll: false,
  /** Groups of the month planner that are folded away (Income, Bills, …). */
  closedGroups: new Set(),
  /** Month planner: budgets whose logged spends are unfolded ('YYYY-MM:billId'). Folded by default. */
  openBudgets: new Set(),
  /** Transactions page: months the person folded or opened by hand ({ 'YYYY-MM': true when folded }). Past months start folded. */
  itemMonths: {},
  /** Sort of each data table by its id: { column, descending }. */
  sort: {},
  /** Search, filters and sort of each list with a toolbar (listToolbar), by list id, for this visit. */
  lists: {},
  /** Rows shown in each paged data table by its id (dataTable pageSize), for this visit. */
  tableLimit: {},
  /** Each calendar by its id (components/calendar.js): month shown, selected day, layout, hidden groups, for this visit. */
  calendars: {},
  /** Audit page: show the ledger of the current month or of the whole plan. */
  auditScope: 'month',
  /** Forecast page: which way of looking ahead, and its two inputs. */
  forecast: { sampleMonths: 4, percent: 10, alphaPercent: 50, incomePercent: 20 },
  /** Which forecast the Forecast page shows (a sub-section in the menu). */
  ftab: 'plan',
  /** A forecast shown on top of the month planner, or null. Display only: the plan is not changed. */
  overlay: null,
  /** The open menu item's sub-sections are folded away (click the item again to open them). */
  subClosed: false,
  /** Accounts page: 'cards' or 'list'. */
  accountView: 'cards',
  /** The page whose cards are being arranged (Design mode, components/designGrid.js), or null. Ends on leaving it. */
  design: null,
  /** Month planner: the figures of the month sum to flash once after a tick ({ month, terms }), or null. */
  pulse: null,
  /**
   * My calendar: ids of the drafts made or changed in this visit. Leaving the page asks whether to apply them while any
   * of them is still a draft (applied ones are no longer drafts; Undo of an apply makes them drafts again).
   */
  agendaTouched: new Set(),
  /** My calendar: the own calendar the last appointment went into, for the next new one (this visit only). */
  lastCal: null,
  /** Forecast › Simulation: the what-if compared with the baseline (a scenario id of plan.sim), or null. */
  simScenario: null,
  /** Hidden amounts were tapped to show them (or shown with the eye button). Hidden again in the background. */
  revealed: false,
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
