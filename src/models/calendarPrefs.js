/**
 * @file Calendar settings (Settings › Calendar): how the calendars on the Overview and in the Month planner look and
 * what their context menus offer. Stored with the browser preferences (db.calendar), like the theme: the same for
 * every plan and not part of backups. normCalendar is the only way they get in, so a stored value can never break a page.
 */
import { isObj } from '../core/util.js';

/** The layouts a calendar can have (components/calendar.js); 'auto' follows the width it gets. */
export const CAL_LAYOUTS = ['auto', 'full', 'tablet', 'mobile', 'compact'];
/** The number on each day: the end-of-day balance, what went out that day, or nothing. */
export const CAL_FIGURES = ['balance', 'spent', 'none'];
/** Event groups of the plan (logic/calendar.js entryGroup). */
export const CAL_GROUPS = ['inc', 'bill', 'budget', 'spend', 'trip', 'loan', 'goal', 'wish', 'transfer', 'adjust'];
/** What the day menu can add, in menu order (components/calendarData.js). */
export const CAL_ADD = [
  'expense',
  'spend',
  'income',
  'trip',
  'event',
  'wish',
  'bill',
  'subs',
  'recIncome',
  'goal',
  'loan',
];
/** What the menu of a line can do besides Edit, which is always there. */
export const CAL_LINE = ['paid', 'skip', 'copy', 'delete'];

/** Money spent: bills, purchases and spends, trips, loan payments, wishes. What the Overview calendar shows at first.
 *  In CAL_GROUPS order, so that cleaning the defaults leaves them exactly as they are. */
export const SPENDING = ['bill', 'spend', 'trip', 'loan', 'wish'];

const flags = keys => Object.fromEntries(keys.map(key => [key, true]));

/** A fresh copy of the defaults. */
export const calendarDefaults = () => ({
  weekStart: 1,
  fixedWeeks: false,
  maxChips: 3,
  trips: true,
  legend: true,
  overview: true,
  overviewLayout: 'auto',
  overviewFigure: 'spent',
  overviewGroups: [...SPENDING],
  plannerLayout: 'auto',
  plannerFigure: 'balance',
  menus: true,
  add: flags(CAL_ADD),
  line: flags(CAL_LINE),
});

/**
 * Clean calendar settings: anything missing, of the wrong type or unknown gets its default. Pure.
 * The Overview always shows at least one group (an empty choice goes back to the default spending groups).
 */
export function normCalendar(raw) {
  const d = calendarDefaults();
  const r = isObj(raw) ? raw : {};
  const bool = (v, def) => (typeof v === 'boolean' ? v : def);
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const switches = (value, keys, def) => {
    const v = isObj(value) ? value : {};
    return Object.fromEntries(keys.map(key => [key, bool(v[key], def[key])]));
  };
  const groups = Array.isArray(r.overviewGroups)
    ? CAL_GROUPS.filter(key => r.overviewGroups.includes(key)) // known keys, once each, in the usual order
    : [];
  return {
    weekStart: r.weekStart === 0 ? 0 : 1,
    fixedWeeks: bool(r.fixedWeeks, d.fixedWeeks),
    maxChips: Number.isInteger(r.maxChips) ? Math.min(6, Math.max(1, r.maxChips)) : d.maxChips,
    trips: bool(r.trips, d.trips),
    legend: bool(r.legend, d.legend),
    overview: bool(r.overview, d.overview),
    overviewLayout: pick(r.overviewLayout, CAL_LAYOUTS, d.overviewLayout),
    overviewFigure: pick(r.overviewFigure, CAL_FIGURES, d.overviewFigure),
    overviewGroups: groups.length ? groups : d.overviewGroups,
    plannerLayout: pick(r.plannerLayout, CAL_LAYOUTS, d.plannerLayout),
    plannerFigure: pick(r.plannerFigure, CAL_FIGURES, d.plannerFigure),
    menus: bool(r.menus, d.menus),
    add: switches(r.add, CAL_ADD, d.add),
    line: switches(r.line, CAL_LINE, d.line),
  };
}
