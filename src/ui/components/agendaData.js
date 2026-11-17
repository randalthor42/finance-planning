/**
 * @file My calendar on the calendar component: options for calendar() (components/calendar.js) with the person's own
 * appointments, their drafts, and what they chose to see of the plan (layers, spending categories, pinned records).
 *
 * Usage:
 *   calendar({ ...agendaCalendar(), id: AGENDA_CAL, mode: 'full' })
 *
 * It is planCalendar() (calendarData.js) with more in it, so plan lines look, add up and open exactly as in the Month
 * planner; on top of that:
 * - months are calendar months (an appointment calendar follows the calendar, not paydays) and are not bounded by
 *   the plan: appointments can be anywhere, and the plan's lines are there for the months it covers;
 * - a group per own calendar, one for drafts, then the plan's groups;
 * - the day menu adds an appointment, or a draft spending, income, trip or event (inside the plan's months);
 * - the menu of an appointment edits (that day, for a repeating one: the window asks for which days), copies or
 *   deletes it (that day, that day and the following ones, or every day); of a draft, edits, applies or deletes it;
 *   of a plan line, what the planner offers plus "Always show on my calendar" (a pin);
 * - a counted appointment's money is a line of the plan, but here the appointment shows it, so that line is left out.
 */
import { D, M, Period } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { agendaEvents, categoryFilter, draftEvents, pinKey, prepareEntries } from '../../logic/agenda.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { inDrafts } from '../helpers.js';
import { applyDraftsModal } from '../modals/applyDrafts.js';
import { appointmentModal } from '../modals/appointment.js';
import { itemModal } from '../modals/item.js';
import { tripModal } from '../modals/trip.js';
import { PLAN_GROUPS, planCalendar } from './calendarData.js';
import { confirmModal } from './modal.js';

/** The id of the calendar on the page (its state in UI.calendars). */
export const AGENDA_CAL = 'agenda';
/** First and last month one can page to: the dates the app can store. */
const MIN_K = M.parse('1970-01');
const MAX_K = M.parse('2200-12');

/**
 * The drafts one can make, in menu order: [label, open(c)], where c = { date: 'YYYY-MM-DD', month: 'YYYY-MM' } is the
 * day chosen and its budget month. The same windows as the plan's, saving to the drafts (helpers.js inDrafts).
 * @returns {[string, (c: {date: string, month: string}) => HTMLElement][]} [label, open] pairs
 */
export const draftChoices = () => [
  [$t('Spending'), c => itemModal(null, { date: c.date, month: c.month, kind: 'out' }, null, inDrafts)],
  [$t('Income'), c => itemModal(null, { date: c.date, month: c.month, kind: 'in', cat: 'other' }, null, inDrafts)],
  [$t('Trip'), c => tripModal(null, { kind: 'trip', month: c.month, from: c.date, to: null }, inDrafts)],
  [$t('Event'), c => tripModal(null, { kind: 'event', month: c.month, from: c.date, to: null }, inDrafts)],
];
/**
 * The title of the drafts part of a menu.
 * @returns {string}
 */
export const draftsTitle = () => $t('Draft, not in your plan yet');

/**
 * Opens a draft in its window.
 * @returns {HTMLElement} the open window
 */
export function openDraft({ list, id }) {
  return list === 'items' ? itemModal(id, null, null, inDrafts) : tripModal(id, null, inDrafts);
}

/** The menu of one day of an appointment (`day` is the day of that occurrence). */
function appointmentMenu(entry, day) {
  const repeating = entry.repeat !== 'none';
  return [
    [$t('Edit'), () => appointmentModal(entry.id, null, day)],
    [$t('Copy'), () => Actions.saveEntry({ ...entry, id: uid(), skip: [], series: null, on: false })],
    ...(repeating
      ? [
          [$t('Delete only this day'), () => Actions.deleteOccurrence(entry.id, day, 'one'), 'danger'],
          [$t('Delete this and following days'), () => Actions.deleteOccurrence(entry.id, day, 'following'), 'danger'],
          [
            $t('Delete every day'),
            () =>
              confirmModal(
                $t('Delete “{0}”?', entry.title),
                $t('It is deleted from every day it repeats on. You can undo this afterwards.'),
                $t('Delete'),
                () => Actions.deleteOccurrence(entry.id, day, 'all'),
              ),
            'danger',
          ],
        ]
      : [[$t('Delete'), () => Actions.removeEntry(entry.id), 'danger']]),
  ];
}
/** The menu of a draft. */
function draftMenu(draft) {
  return [
    [$t('Edit'), () => openDraft(draft)],
    [$t('Add to my plan…'), () => applyDraftsModal({ only: [draft.id] })],
    [$t('Delete draft'), () => inDrafts.remove(draft.list, draft.id), 'danger'],
  ];
}
/** Pins or unpins a record ('list:id'): a pinned one is always shown, whatever the layers and categories. */
function setPin(key, on) {
  const pins = Store.plan.agenda.pins.filter(p => p.list + ':' + p.id !== key);
  if (on) {
    const [list, id] = key.split(':');
    pins.push({ list, id });
  }
  return Actions.setAgenda({ pins });
}

/**
 * The day of a new appointment from the page's buttons: the day chosen, else today in the month shown, else its first day.
 * @returns {number} the day (day number)
 */
export function dayForNew(state) {
  if (state.sel !== null && state.sel !== undefined) {
    return state.sel;
  }
  const k = state.k ?? D.month(Store.day);
  return D.month(Store.day) === k ? Store.day : D.of(Math.floor(k / 12), k % 12, 1);
}

/**
 * Options for calendar() that show My calendar of the open plan.
 * @returns {object} the options for calendar()
 */
export function agendaCalendar() {
  const plan = Store.plan;
  const agenda = plan.agenda;
  const settings = plan.settings;
  const { s0, n } = Store.proj.summary;
  // every plan line and trip is asked for; what is shown is decided here, so pinned records pass any filter
  const base = planCalendar({ trips: true, figure: agenda.figure === 'none' ? null : agenda.figure });
  const layers = new Set(agenda.layers);
  const pins = new Set(agenda.pins.map(p => p.list + ':' + p.id));
  const byCategory = categoryFilter(agenda.cats, new Map(plan.bills.map(b => [b.id, b.cat])));
  const bars = Store.db.calendar.trips; // Settings › Calendar: trips as bars
  const shows = ev => {
    // the money of a counted appointment is a line of the plan too: the appointment itself shows it here
    if (ev.data.entry && ev.data.entry.appt) {
      return false;
    }
    if (pins.size && pins.has(pinKey(ev))) {
      return true;
    }
    if (!layers.has(ev.group) || (ev.data.trip && !bars)) {
      return false;
    }
    return !byCategory || byCategory(ev);
  };
  const prepared = prepareEntries(agenda.entries); // once per drawing of the page, not once per month shown
  const planMonth = day => {
    const k = Period.of(settings, day);
    return k >= s0 && k < s0 + n ? k : null;
  };
  return {
    ...base,
    period: undefined,
    initial: D.month(Store.day),
    min: MIN_K,
    max: MAX_K,
    groups: [
      ...agenda.cals.map(c => ({ key: 'cal:' + c.id, label: c.name, tone: c.tone })),
      { key: 'draft', label: $t('Drafts'), tone: 'warn' },
      ...PLAN_GROUPS,
    ],
    events: days => [
      ...agendaEvents(agenda, days.from, days.to, prepared),
      ...draftEvents(agenda.drafts, days.k),
      ...base.events(days).filter(shows),
    ],
    dayInfo: agenda.figure === 'none' ? null : base.dayInfo,
    onEvent: ev => {
      const data = ev.data || {};
      if (data.agenda) {
        return appointmentModal(data.agenda.id, null, data.day);
      }
      if (data.draft) {
        return openDraft(data.draft);
      }
      return base.onEvent ? base.onEvent(ev) : false;
    },
    // "+" on a day without a menu: a new appointment (there is always a menu here; this is for completeness)
    onAdd: day => appointmentModal(null, { date: D.key(day) }),
    dayMenu: day => {
      const k = planMonth(day);
      const c = { date: D.key(day), month: M.key(Period.of(settings, day)) };
      return [
        $t('On your calendar'),
        [$t('New appointment'), () => appointmentModal(null, { date: c.date })],
        // a draft needs a month of the plan to count in once applied
        ...(k === null ? [] : [draftsTitle(), ...draftChoices().map(([label, open]) => [label, () => open(c)])]),
        ...(k === null ? [] : ['-', [$t('Open the month in the planner'), () => App.go('months', { month: k })]]),
      ];
    },
    eventMenu: ev => {
      const data = ev.data || {};
      if (data.agenda) {
        return appointmentMenu(data.agenda, data.day);
      }
      if (data.draft) {
        return draftMenu(data.draft);
      }
      const key = pinKey(ev);
      const pinned = !!key && pins.has(key);
      const baseItems = base.eventMenu ? base.eventMenu(ev) : [];
      let pinItem = null;
      if (pinned) {
        pinItem = [$t('Stop always showing it'), () => setPin(key, false)];
      } else if (key) {
        pinItem = [$t('Always show on my calendar'), () => setPin(key, true)];
      }
      return [...baseItems, pinItem];
    },
  };
}
