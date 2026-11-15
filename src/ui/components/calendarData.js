/**
 * @file The plan on a calendar: ready-made options for calendar() (components/calendar.js).
 *
 * Usage:
 *   calendar({ ...planCalendar(), id: 'planner-cal' })                                         // every line, every month
 *   calendar({ ...planCalendar({ only: ['bill', 'loan'] }), id: 'due-cal', mode: 'compact' })  // what is due
 *   calendar({ ...planCalendar({ only: SPENDING, figure: 'spent' }), id: 'spent-cal' })          // what goes out
 *   calendar({ ...planCalendar(), id: 'cal', onNavigate: k => App.go('months', { month: k }) }) // follow the planner
 * Anything returned can be overridden by the options written after it, as in the last line.
 *
 * Months follow the plan: from payday to payday when a payday is set, and only the months the plan covers.
 * Each event keeps its ledger line and month in `data` (or its trip), so a click opens the usual window.
 * With `edit` (the default) the calendar also has context menus: a day adds things on that day (one-offs, trips, events,
 * wishes, recurring lines, goals, loans), a line can be edited, ticked off, skipped for the month, copied or deleted.
 * "Delete" always asks first, saying what goes (this line, every month, a whole loan…); Undo works afterwards too.
 */
import { D, M, Period } from '../../core/dates.js';
import { compact, money, signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { dayBalances, entryEvents, lastDay, totals, tripEvents } from '../../logic/calendar.js';
import { SPENDING } from '../../models/calendarPrefs.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { tickOf } from '../helpers.js';
import { entryModal } from '../modals/entry.js';
import { goalModal } from '../modals/goal.js';
import { itemModal, lastBudget, logSpend } from '../modals/item.js';
import { loanModal } from '../modals/loan.js';
import { recModal } from '../modals/recurring.js';
import { tripModal } from '../modals/trip.js';
import { wishModal } from '../modals/wish.js';
import { confirmModal } from './modal.js';
import { curK } from '../state.js';

/** The groups of plan events (logic/calendar.js entryGroup), in legend order, with their colours. */
export const PLAN_GROUPS = [
  { key: 'inc', label: $t('Income'), tone: 'good' },
  { key: 'bill', label: $t('Bills'), tone: 'bad' },
  { key: 'budget', label: $t('Budgets'), tone: 'warn' },
  { key: 'spend', label: $t('Transactions'), tone: 'acc' },
  { key: 'trip', label: $t('Trips and events'), tone: 'trip' },
  { key: 'loan', label: $t('Loans'), tone: 'debt' },
  { key: 'goal', label: $t('Savings'), tone: 'save' },
  { key: 'wish', label: $t('Wishlist'), tone: 'wish' },
  { key: 'transfer', label: $t('Borrowed or from savings'), tone: 'cash' },
  { key: 'adjust', label: $t('Balance correction'), tone: 'muted' },
];

/** Groups that are money spent (models/calendarPrefs.js): not income, not money put into savings, not what a budget
 *  still holds back (its spends are in), not corrections. */
export { SPENDING };

/** The list a ledger line comes from, by the start of its key ("bill:<id>", "loan:<id>:fee", …): what Delete removes. */
const LISTS = {
  item: 'items',
  bill: 'bills',
  inc: 'incomes',
  trip: 'trips',
  loan: 'loans',
  goal: 'goals',
  wish: 'wishes',
};

/**
 * Everything the day menu can add, in menu order and sections: [title, [[setting, group, label, open, when?], …]].
 * `setting` is its switch in Settings › Calendar (models/calendarPrefs.js CAL_ADD), `group` where it lands (a calendar
 * filtered to some groups only offers what it shows), `open(c)` opens its window for the day c (see addMenu), and
 * `when({ budgets })` hides it for the whole plan when it cannot apply (no budget to log a spend against).
 * One-offs carry the day. A trip or an event starts that day (its month follows); the last day is left for the person
 * to pick in the window. A wish is planned for that month; recurring lines, goals and loans start that month, on that day.
 */
export const addChoices = () => [
  [
    $t('On this day'),
    [
      ['expense', 'spend', $t('Add an expense'), c => itemModal(null, { date: c.date, month: c.month })],
      [
        'spend',
        'spend',
        $t('Log a spend'),
        c => itemModal(null, { date: c.date, month: c.month, budget: lastBudget(c.budgets).id }),
        c => c.budgets.length > 0,
      ],
      [
        'income',
        'inc',
        $t('Add income'),
        c => itemModal(null, { date: c.date, month: c.month, kind: 'in', cat: 'other' }),
      ],
    ],
  ],
  [
    $t('Plans'),
    [
      [
        'trip',
        'trip',
        $t('Plan a trip'),
        c => tripModal(null, { kind: 'trip', month: c.month, from: c.date, to: null }),
      ],
      [
        'event',
        'trip',
        $t('Plan an event'),
        c => tripModal(null, { kind: 'event', month: c.month, from: c.date, to: null }),
      ],
      // planned for this month and counted, so it shows on the calendar; the window can still make it "some day"
      ['wish', 'wish', $t('Add to wishlist'), c => wishModal(null, { month: c.month, flex: false, on: true })],
    ],
  ],
  [
    $t('From this day on'),
    [
      ['bill', 'bill', $t('Add a recurring bill'), c => recModal('bills', null, { from: c.month, day: c.dayOfMonth })],
      [
        'subs',
        'bill',
        $t('Add a subscription'),
        c => recModal('bills', null, { cat: 'subs', from: c.month, day: c.dayOfMonth }),
      ],
      [
        'recIncome',
        'inc',
        $t('Add a recurring income'),
        c => recModal('incomes', null, { from: c.month, day: c.dayOfMonth }),
      ],
      ['goal', 'goal', $t('Start a savings goal'), c => goalModal(null, { from: c.month })],
      ['loan', 'loan', $t('Add a loan'), c => loanModal(null, { first: c.month, day: c.dayOfMonth })],
    ],
  ],
];

/** What the menu of a line can do besides Edit: [setting (CAL_LINE), label, explanation] for Settings › Calendar. */
export const lineChoices = () => [
  ['paid', $t('Mark as paid or received'), $t('Also closes or reopens a budget.')],
  ['skip', $t('Skip this month'), $t('Leaves a bill or an income out of one month only.')],
  ['copy', $t('Copy'), $t('Adds the same transaction again.')],
  ['delete', $t('Delete'), $t('Always asks first, and can be undone.')],
];

/**
 * The day menu of a calendar: (day, k) => the addChoices that are switched on in `allowed` (CAL_ADD keys), land in a
 * group the calendar shows (`wanted`, or null for all) and apply (`when`). Sections with nothing left are left out.
 * The choices are picked once per calendar, not once per day: the calendar asks every day of the grid whether it has
 * anything to add (to show "+"), so only the day itself is worked out per call.
 */
function addMenu(wanted, allowed) {
  const budgets = Store.plan.bills.filter(b => b.budget);
  const sections = addChoices()
    .map(([title, choices]) => [
      title,
      choices.filter(
        ([key, group, , , when]) => allowed[key] && (!wanted || wanted.has(group)) && (!when || when({ budgets })),
      ),
    ])
    .filter(([, choices]) => choices.length);
  return (day, k) => {
    if (!sections.length) {
      return [];
    }
    const c = { date: D.key(day), month: M.key(k), dayOfMonth: D.js(day).getUTCDate(), budgets };
    return sections.flatMap(([title, choices]) => [
      title,
      ...choices.map(([, , label, open]) => [label, () => open(c)]),
    ]);
  };
}

/** What the delete question explains, by kind of record: what goes, and from where. */
const DELETE_TEXT = {
  items: name => $t('“{0}” is removed from your transactions. You can undo this afterwards.', name),
  spend: (name, budget) =>
    $t(
      '“{0}” is removed from your transactions and from the budget “{1}”. You can undo this afterwards.',
      name,
      budget,
    ),
  bills: (name, month) =>
    $t(
      '“{0}” is deleted from every month of your plan, not only from {1}. To leave out one month, use “Skip this month” instead. You can undo this afterwards.',
      name,
      month,
    ),
  budget: name =>
    $t(
      'The budget “{0}” is deleted from every month of your plan. The spends logged against it stay, as separate purchases. You can undo this afterwards.',
      name,
    ),
  trip: name =>
    $t(
      'The trip “{0}” and all its costs are deleted from every month they are in. You can undo this afterwards.',
      name,
    ),
  event: name =>
    $t(
      'The event “{0}” and all its costs are deleted from every month they are in. You can undo this afterwards.',
      name,
    ),
  loans: name =>
    $t(
      'The loan “{0}” is deleted with all its payments, from every month of your plan. You can undo this afterwards.',
      name,
    ),
  goals: name =>
    $t(
      'The savings goal “{0}” is deleted with everything it puts aside, from every month of your plan. You can undo this afterwards.',
      name,
    ),
  wishes: name =>
    $t(
      '“{0}” is deleted from your wishlist and from every month it is planned in. You can undo this afterwards.',
      name,
    ),
};

/**
 * "Delete" in a menu: asks first, saying what goes (one line, every month, a whole loan…), then deletes with Undo.
 * `text()` writes that explanation when Delete is clicked: a menu is made for every line shown, so only do the work
 * for the one that is used.
 */
function deleteItem(list, record, text) {
  return [
    $t('Delete'),
    () => confirmModal($t('Delete “{0}”?', record.name), text(), $t('Confirm'), () => Actions.remove(list, record.id)),
    'danger',
  ];
}

/** Records by id, one Map per list, made on first use: a busy month asks for hundreds of lines' records. */
function recordIndex(plan) {
  const maps = {};
  return (list, id) => {
    if (!maps[list]) {
      maps[list] = new Map(plan[list].map(x => [x.id, x]));
    }
    return maps[list].get(id) || null;
  };
}

/**
 * What can be done with one line: the context menu (and the ⋯ button) of an event. Mirrors the month planner.
 * `allowed` are the line switches of Settings › Calendar (CAL_LINE); Edit is always there.
 */
/** The tick entry of a line's menu: received / paid, or the way back. */
function tickLabel(e) {
  if (e.amount > 0) {
    return e.paid ? $t('Mark as not received') : $t('Mark as received');
  }
  return e.paid ? $t('Mark as not paid') : $t('Mark as paid');
}
/** What "Delete" says it removes: the spend, the one-off, the whole budget or bill, the trip or event, … */
function deleteText(e, m, list, record, budgetLine, recurring, find) {
  if (list === 'items') {
    const budget = e.of ? find('bills', e.of) : null;
    return budget ? DELETE_TEXT.spend(record.name, budget.name) : DELETE_TEXT.items(record.name);
  }
  if (budgetLine) {
    return DELETE_TEXT.budget(record.name);
  }
  if (recurring) {
    return DELETE_TEXT.bills(record.name, M.label(m.k, true));
  }
  if (list === 'trips') {
    return (record.kind === 'event' ? DELETE_TEXT.event : DELETE_TEXT.trip)(record.name);
  }
  return DELETE_TEXT[list](record.name);
}
function lineMenu(ev, allowed, find) {
  if (ev.data.trip) {
    const trip = find('trips', ev.data.trip.id);
    return [
      [$t('Edit'), () => tripModal(ev.data.trip.id)],
      trip && allowed.delete
        ? deleteItem('trips', trip, () => (trip.kind === 'event' ? DELETE_TEXT.event : DELETE_TEXT.trip)(trip.name))
        : null,
    ];
  }
  const e = ev.data.entry;
  const m = ev.data.month;
  if (e.key === 'whatif') {
    return [];
  }
  if (e.group === 'adjust') {
    return [[$t('Remove the correction'), () => Actions.clearFix(m.key), 'danger']];
  }
  const list = LISTS[e.key.split(':')[0]];
  const record = list ? find(list, e.id) : null;
  const b = e.budget;
  const recurring = (list === 'bills' || list === 'incomes') && !b;
  const toggle = () => Actions.setPaid(m.key, tickOf(e), !e.paid);
  // a budget closes instead of being ticked; a logged spend is always paid
  const canTick = allowed.paid && !b && !e.of;
  const tick = canTick ? [tickLabel(e), toggle] : null;
  const text = () => deleteText(e, m, list, record, b, recurring, find);
  return [
    [$t('Edit'), () => entryModal(e, m)],
    tick,
    b && !b.done && !b.closed ? [$t('Log a spend'), () => logSpend(e.id, m)] : null,
    allowed.paid && b && b.done ? [$t('Reopen budget'), toggle] : null,
    allowed.paid && b && !b.done && !b.closed ? [$t('Close budget'), toggle] : null,
    allowed.skip && recurring && !e.skipped
      ? [$t('Skip this month'), () => Actions.setOverride(m.key, e.key, 0, e.label)]
      : null,
    allowed.skip && recurring && e.over
      ? [$t('Back to usual'), () => Actions.setOverride(m.key, e.key, null, e.label)]
      : null,
    allowed.copy && list === 'items' ? [$t('Copy'), () => Actions.duplicate('items', e.id)] : null,
    allowed.delete && record ? deleteItem(list, record, text) : null,
  ];
}

/**
 * Options for calendar() that show the open plan.
 * @param {object} [choice]
 * @param {?string[]} [choice.only] keys of PLAN_GROUPS to show; all when left out
 * @param {?('balance'|'spent')} [choice.figure] the number on each day: 'balance' (default) is the end-of-day balance,
 *   red under zero and amber under the cushion; 'spent' is the money out of the lines shown that day; null for none
 * @param {boolean} [choice.trips] trips and events with dates as bars across their days
 * @param {boolean} [choice.edit] a click on a line opens its window; context menus add, tick off, skip and delete
 * @param {boolean} [choice.openPlanner] the day menu also offers to open that month in the month planner
 */
/**
 * The number and markers of one day (audit 6.0b and 6.7). Balances come from the projection (dayBalances), never
 * from the lines shown, so a filter never changes them:
 * - balance: the end-of-day balance, only on days where something happens, today and the last day of the period
 *   (the same number on twenty quiet days is noise); its colour is the day's status (below zero / under the cushion);
 * - net: money in minus money out of the lines shown (it follows the filters, and says so in its title);
 * - spent: money out of the lines shown, likewise.
 * Markers: payday (first day of a budget month with a payday), the lowest day of the month, and an unpaid payment
 * whose day has passed.
 */
function dayFigure(figure, day, mode, events, settings, balanceOn, lowestOn) {
  const k = Period.of(settings, day);
  const balance = balanceOn(day);
  const marks = [];
  if (settings.payDay && day === Period.start(settings, k)) {
    marks.push({ kind: 'payday', short: $t('payday'), title: $t('Payday.') });
  }
  const low = lowestOn(day);
  if (low && low.day === day) {
    marks.push({ kind: 'lowest', short: $t('lowest'), title: $t('Lowest day of the month: {0}.', money(low.value)) });
  }
  if (day < Store.day && events.some(ev => !ev.done && ev.amount < 0 && ev.group === 'bill')) {
    marks.push({ kind: 'overdue', short: '!', title: $t('A payment of this day is not ticked as paid yet.') });
  }
  const tone = balance === null || balance === undefined ? null : statusTone(balance, settings.cushion);
  const info = { marks, tone, text: '', title: '', panel: false };
  if (figure === 'balance') {
    const active = events.length > 0 || day === Store.day || day === Period.end(settings, k);
    if (active && balance !== null && balance !== undefined) {
      info.text = mode === 'full' ? money(balance) : compact(balance);
      info.title = $t('End-of-day balance: {0}.', money(balance));
      info.panel = true;
    }
    return info;
  }
  const flow = totals(events);
  if (figure === 'net' && (flow.in || flow.out)) {
    info.text = mode === 'full' ? signed(flow.net) : compact(flow.net);
    info.title = $t('Net of the lines shown: {0}.', signed(flow.net));
  }
  if (figure === 'spent' && flow.out) {
    info.text = mode === 'full' ? money(flow.out) : compact(flow.out);
    info.title = $t('Spent on the lines shown: {0}.', money(flow.out));
  }
  return info;
}
/** A day's status colour: below zero, under the cushion, or none. */
function statusTone(balance, cushion) {
  if (balance < 0) {
    return 'bad';
  }
  return balance < cushion ? 'warn' : null;
}
export function planCalendar({
  only = null,
  figure = 'balance',
  trips,
  edit = true,
  openPlanner = false,
  ahead = false,
} = {}) {
  // Settings › Calendar (models/calendarPrefs.js); an option passed here wins
  const prefs = Store.db.calendar;
  const showTrips = trips ?? prefs.trips;
  const menus = edit && prefs.menus;
  const plan = Store.plan;
  const settings = plan.settings;
  const projection = Store.proj;
  const { s0, n } = projection.summary;
  const wanted = only ? new Set(only) : null;
  const balances = new Map();
  const balanceOn = day => {
    const k = Period.of(settings, day);
    const month = projection.months[k - s0];
    if (!month) {
      return null;
    }
    if (!balances.has(k)) {
      balances.set(k, dayBalances(month));
    }
    return balances.get(k).get(day);
  };
  // the lowest end-of-day balance of each budget month, for its marker
  const lowest = new Map();
  const lowestOn = day => {
    const k = Period.of(settings, day);
    if (!lowest.has(k)) {
      const start = Period.start(settings, k);
      const end = Period.end(settings, k);
      let low = null;
      for (let n = start; n <= end; n++) {
        const value = balanceOn(n);
        if (value !== null && value !== undefined && (low === null || value < low.value)) {
          low = { day: n, value };
        }
      }
      lowest.set(k, low);
    }
    return lowest.get(k);
  };
  const addsOn = menus ? addMenu(wanted, prefs.add) : null;
  return {
    weekStart: prefs.weekStart,
    fixedWeeks: prefs.fixedWeeks,
    maxChips: prefs.maxChips,
    legend: prefs.legend,
    groups: PLAN_GROUPS,
    today: Store.day,
    initial: curK(),
    min: s0,
    max: s0 + n - 1,
    period: k => ({ start: Period.start(settings, k), end: Period.end(settings, k) }),
    events: ({ k, from, to }) => {
      const list = [];
      for (const month of projection.months) {
        if (month.end < from || month.start > to) {
          continue;
        }
        // the days of the months around it are drawn too; lines without a day belong to the month shown only
        list.push(...entryEvents(month).filter(ev => ev.date !== null || month.k === k));
      }
      if (showTrips) {
        list.push(
          ...tripEvents(plan.trips).map(ev => ({
            ...ev,
            sub: ev.data.trip.budget ? $t('Budget {0}', money(ev.data.trip.budget)) : '',
          })),
        );
      }
      const shown = wanted ? list.filter(ev => wanted.has(ev.group)) : list;
      // the Overview is about what is ahead: lines of days already past are left out (6.6), undated ones stay
      return ahead ? shown.filter(ev => ev.date === null || lastDay(ev) >= Store.day) : shown;
    },
    dayInfo: (day, mode, events) => dayFigure(figure, day, mode, events, settings, balanceOn, lowestOn),
    onEvent: edit
      ? ev => {
          if (ev.data.trip) {
            return tripModal(ev.data.trip.id);
          }
          const entry = ev.data.entry;
          // a balance correction and a what-if have no window of their own (as in the month planner)
          if (entry.group === 'adjust' || entry.key === 'whatif') {
            return false;
          }
          entryModal(entry, ev.data.month);
        }
      : null,
    // "+" without a menu adds an expense, if that is switched on
    onAdd: edit && prefs.add.expense ? day => itemModal(null, { date: D.key(day) }) : null,
    dayMenu: menus
      ? day => {
          const k = Period.of(settings, day);
          // a day outside the plan has no month to put anything in
          if (k < s0 || k > s0 + n - 1) {
            return [];
          }
          const adds = addsOn(day, k);
          const open = openPlanner ? [[$t('Open the month'), () => App.go('months', { month: k })]] : [];
          // the dividing line only between the two parts
          return adds.length && open.length ? [...adds, '-', ...open] : [...adds, ...open];
        }
      : null,
    eventMenu: menus
      ? (() => {
          const lookup = recordIndex(plan);
          return ev => lineMenu(ev, prefs.line, lookup);
        })()
      : null,
  };
}
