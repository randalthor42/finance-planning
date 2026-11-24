/**
 * @file "My calendar" (views/agenda.js): the person's own calendar, stored in the plan as `plan.agenda`, so it is in
 * backups, in Undo and in the activity log like everything else they own. normPlan calls normAgenda with its own
 * helpers, so ids stay unique across the whole plan and drafts are cleaned exactly like the records they will become.
 *
 *   agenda = {
 *     name,      the page title; '' shows "My calendar" in the language of the app
 *     cals,      the person's own calendars, at least one: [{ id, name, tone }] (a colour of the app, see AGENDA_TONES)
 *     entries,   appointments: [{ id, cal, title, date, end, time, endTime, repeat, until, skip, note,
 *                amount, kind, cat, on, series }]. An appointment may cost or bring money (amount, kind 'out' or
 *                'in', a category): like a wish or a trip, it counts in the plan only when `on` ("Count in my plan",
 *                or applied from the drafts), once per occurrence (logic/projection.js). `series` links a day
 *                changed on its own, or the rest of a repeat split in two, to the repeat it came from.
 *     layers,    which parts of the plan are shown next to them (calendar groups, models/calendarPrefs.js CAL_GROUPS)
 *     cats,      spending categories shown ([] = all); only spending is filtered (logic/agenda.js categoryFilter)
 *     figure,    the number on each day: 'balance', 'net', 'spent' (as in the Month planner) or 'none'
 *     drafts,    { items, trips }: one-offs and trips or events made on the calendar. They count for nothing until the
 *                person applies them, which moves them into plan.items and plan.trips (logic/agenda.js moveDrafts).
 *     pins,      records of the plan always shown, whatever the layers and categories: [{ list, id }]. Added from the
 *                plan ("Add from your plan") or by applying a draft, so what was applied stays in sight.
 *   }
 * Money made on the calendar (drafts, and the money of an appointment not counted yet) is a draft until applied.
 */
import { DRAFT_LISTS } from '../config.js';
import { D } from '../core/dates.js';
import { $t } from '../core/i18n.js';
import { isObj } from '../core/util.js';
import { CAL_GROUPS } from './calendarPrefs.js';
import { CATS, INCATS } from './categories.js';

/** Colours an own calendar can have: tones of the app, so they follow light and dark themes. In swatch order. */
export const AGENDA_TONES = ['acc', 'good', 'trip', 'wish', 'save', 'debt', 'warn', 'bad', 'cash', 'muted'];
/** How an appointment repeats. A monthly one on the 31st falls on the last day of shorter months, like a bill. */
export const REPEATS = ['none', 'day', 'week', 'month', 'year'];
/** Parts of the plan the calendar can show, in legend order. */
export const AGENDA_LAYERS = CAL_GROUPS;
/** What a new calendar shows of the plan: paydays and income, bills, trips and events. */
export const DEFAULT_LAYERS = ['inc', 'bill', 'trip'];
/** The number on each day. */
export const AGENDA_FIGURES = ['balance', 'net', 'spent', 'none'];
/**
 * The names of the layers, as the legend says them (components/calendarData.js PLAN_GROUPS), for the activity log.
 * @returns {Object<string, string>} layer key → its name, translated
 */
export const LAYER_NAMES = () => ({
  inc: $t('Income'),
  bill: $t('Bills'),
  budget: $t('Budgets'),
  spend: $t('Transactions'),
  trip: $t('Trips and events'),
  loan: $t('Loans'),
  goal: $t('Savings'),
  wish: $t('Wishlist'),
  transfer: $t('Borrowed or from savings'),
  adjust: $t('Balance correction'),
});
/**
 * The names of the numbers on each day, as Customise says them.
 * @returns {Object<string, string>} figure key → its name, translated
 */
export const FIGURE_NAMES = () => ({
  balance: $t('Balance'),
  net: $t('Net'),
  spent: $t('Spent'),
  none: $t('Nothing'),
});
/** Lists of the plan a draft can become a record of, in the order they are shown. */
export { DRAFT_LISTS };
/** Lists of the plan whose records can be pinned to the calendar. */
export const PIN_LISTS = ['incomes', 'bills', 'items', 'trips', 'loans', 'goals', 'wishes'];
/** Limits, like every list of the plan. */
export const AGENDA_MAX = { entries: 1000, cals: 12, skip: 100, items: 200, trips: 50, pins: 500 };
/** The id of the calendar every plan starts with. */
export const FIRST_CAL = 'personal';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Cleans an agenda. `t` are normPlan's helpers: id (unique in the plan), str, num, day ('YYYY-MM-DD' or null), note, and the
 * cleaners of a one-off (item) and a trip, which know the plan's settings, budgets and accounts, and `records`: the
 * plan's clean lists, which pins must point into.
 * @returns {import('../types.js').Agenda} the clean agenda
 */
export function normAgenda(raw, t) {
  const a = isObj(raw) ? raw : {};
  const objects = (v, max) => (Array.isArray(v) ? v.filter(isObj).slice(0, max) : []);
  const cals = objects(a.cals, AGENDA_MAX.cals).map(x => ({
    id: t.id(x.id),
    name: t.str(x.name, 40) || $t('Calendar'),
    tone: AGENDA_TONES.includes(x.tone) ? x.tone : 'acc',
  }));
  if (!cals.length) {
    cals.push({ id: t.id(FIRST_CAL), name: $t('Personal'), tone: 'acc' });
  }
  const calIds = new Set(cals.map(c => c.id));
  const entries = [];
  for (const x of objects(a.entries, AGENDA_MAX.entries)) {
    const date = t.day(x.date);
    if (!date) {
      continue; // an appointment without a real day cannot be shown anywhere
    }
    const start = D.parse(date);
    const endDay = t.day(x.end);
    const end = endDay && D.parse(endDay) > start ? endDay : null;
    const time = typeof x.time === 'string' && TIME.test(x.time) ? x.time : '';
    // an end time needs a start time, and on a one-day appointment it comes after it
    const endTime =
      time && typeof x.endTime === 'string' && TIME.test(x.endTime) && (end || x.endTime > time) ? x.endTime : '';
    const repeat = REPEATS.includes(x.repeat) ? x.repeat : 'none';
    const untilDay = repeat !== 'none' ? t.day(x.until) : null;
    const until = untilDay && D.parse(untilDay) >= start ? untilDay : null;
    const skip =
      repeat !== 'none' && Array.isArray(x.skip)
        ? [...new Set(x.skip.map(t.day).filter(s => s && D.parse(s) >= start))].sort().slice(0, AGENDA_MAX.skip)
        : [];
    const amount = t.num(x.amount, 0, 1e9, 0);
    const kind = x.kind === 'in' ? 'in' : 'out';
    const cats = kind === 'in' ? INCATS : CATS;
    entries.push({
      id: t.id(x.id),
      cal: calIds.has(x.cal) ? x.cal : cals[0].id,
      title: t.str(x.title) || $t('Untitled'),
      date,
      end,
      time,
      endTime,
      repeat,
      until,
      skip,
      note: t.note(x),
      amount,
      kind,
      cat: cats.some(c => c[0] === x.cat) ? x.cat : 'other',
      on: amount > 0 && x.on === true,
      series: typeof x.series === 'string' ? x.series : null,
    });
  }
  // a link points at the first appointment of its repeat, which exists and links nowhere itself
  const byId = new Map(entries.map(e => [e.id, e]));
  for (const e of entries) {
    let root = e.series && byId.get(e.series);
    if (root && root.series && root.series !== e.id && byId.has(root.series)) {
      root = byId.get(root.series);
    }
    e.series = root && root !== e && !root.series ? root.id : null;
  }
  const drafts = isObj(a.drafts) ? a.drafts : {};
  const pinned = new Set();
  const pins = [];
  for (const x of objects(a.pins, AGENDA_MAX.pins)) {
    const key = x.list + ':' + x.id;
    if (PIN_LISTS.includes(x.list) && !pinned.has(key) && t.records[x.list].some(r => r.id === x.id)) {
      pinned.add(key);
      pins.push({ list: x.list, id: x.id });
    }
  }
  return {
    name: t.str(a.name, 40),
    cals,
    entries,
    // known keys, once each, in the usual order; an empty list is a choice (nothing of the plan shown)
    layers: Array.isArray(a.layers) ? AGENDA_LAYERS.filter(key => a.layers.includes(key)) : [...DEFAULT_LAYERS],
    cats: Array.isArray(a.cats) ? CATS.map(c => c[0]).filter(key => a.cats.includes(key)) : [],
    figure: AGENDA_FIGURES.includes(a.figure) ? a.figure : 'balance',
    drafts: {
      items: objects(drafts.items, AGENDA_MAX.items).map(t.item),
      trips: objects(drafts.trips, AGENDA_MAX.trips).map(t.trip),
    },
    pins,
  };
}
