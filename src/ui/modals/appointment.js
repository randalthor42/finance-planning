/**
 * @file The window of an appointment on My calendar: what, which of the person's calendars, when, how it repeats, and
 * what it costs (or brings). Its money counts in the plan only when "Count in my plan" is on (or it is applied with
 * the drafts); until then it is a draft.
 *
 * Opened on one day of a repeating appointment (`day`), it asks what the changes are for: that day only, that day and
 * the following ones, or every day (Actions.editOccurrence); Delete asks the same. That window saves with its button
 * only, not as you type: the choice decides what is saved.
 */
import { D } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { CATS, INCATS } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { NOTE, formModal } from '../components/form.js';
import { confirmModal, modal } from '../components/modal.js';
import { h } from '../dom.js';
import { UI } from '../state.js';

const REPEAT_OPTIONS = () => [
  ['none', $t('Does not repeat')],
  ['day', $t('Every day')],
  ['week', $t('Every week')],
  ['month', $t('Every month')],
  ['year', $t('Every year')],
];
/**
 * What the changes to one day of a repeating appointment are for.
 * @returns {[string, string][]} ['one' | 'following' | 'all', label] pairs
 */
export const SCOPES = () => [
  ['one', $t('This day')],
  ['following', $t('This and following days')],
  ['all', $t('Every day')],
];

/** "Every week on Tuesday, until 31 Dec 2026." in the window, so the person sees what the repeat means. */
function repeatText(v) {
  const n = D.parse(v.date);
  if (v.repeat === 'none' || n === null || v.scope === 'one') {
    return '';
  }
  const until = D.parse(v.until);
  const text = {
    day: () => $t('Every day from {0}.', D.label(n, { year: 'numeric' })),
    week: () => $t('Every week on {0}.', D.fmt(n, { weekday: 'long' })),
    month: () => $t('Every month on day {0}; in shorter months, on the last day.', D.js(n).getUTCDate()),
    year: () => $t('Every year on {0}.', D.label(n)),
  }[v.repeat]();
  return until === null ? text : text + ' ' + $t('Until {0}.', D.label(until, { year: 'numeric' }));
}
/** What the money line of the window says: whether it counts, and what a repeat costs. */
function moneyText(v) {
  if (!(v.amount > 0)) {
    return '';
  }
  if (!v.on) {
    return $t('A draft: it counts in your plan once you apply it, or switch on “Count in my plan”.');
  }
  return v.repeat !== 'none' && v.scope !== 'one'
    ? $t('Counts in your plan on every day it happens.')
    : $t('Counts in your plan on its day.');
}

/**
 * Asks which days to delete of a repeating appointment (`day` is the one it was opened on), then deletes them.
 * Every day asks once more: it can take many days (Undo still brings them back).
 * @returns {HTMLElement} the open window
 */
export function deleteScopeModal(entry, day) {
  const go = scope => {
    d.close();
    Actions.deleteOccurrence(entry.id, day, scope);
  };
  const d = modal({
    title: $t('Delete “{0}”?', entry.title),
    body: h('p', {
      class: 'muted',
      text: $t(
        'It repeats. Delete only {0}, that day and the following ones, or every day?',
        D.label(day, { year: 'numeric' }),
      ),
    }),
    foot: [
      btn($t('Cancel'), () => d.close(), 'ghost'),
      h('span', { class: 'sp' }),
      btn($t('This day'), () => go('one'), 'danger ghost'),
      btn($t('This and following days'), () => go('following'), 'danger ghost'),
      btn($t('Every day'), () => go('all'), 'danger'),
    ],
  });
  d.classList.add('agenda-scope', 'narrow');
  return d;
}

/**
 * Opens an appointment (id), or a new one with `preset` fields (e.g. { date }). `day`: the day of a repeating
 * appointment it was opened on (a click on that day): the window shows that day and asks what the changes are for.
 * Without it, the whole appointment is edited.
 * @returns {void}
 */
export function appointmentModal(id, preset, day = null) {
  const agenda = Store.plan.agenda;
  const current = id && agenda.entries.find(e => e.id === id);
  const cals = agenda.cals;
  // a new appointment goes into the calendar used last in this visit, if it is still there
  const cal = cals.some(c => c.id === UI.lastCal) ? UI.lastCal : cals[0].id;
  const repeating = !!current && current.repeat !== 'none';
  const onDay = repeating && day !== null;
  // opened on a day of a repeat: the window shows that day (its first and last day)
  const len = current && current.end ? D.parse(current.end) - D.parse(current.date) + 1 : 1;
  let values;
  if (onDay) {
    values = { ...current, date: D.key(day), end: len > 1 ? D.key(day + len - 1) : null, scope: 'one' };
  } else if (current) {
    values = { ...current };
  } else {
    values = {
      id: uid(),
      cal,
      title: '',
      date: D.key(Store.day),
      end: null,
      time: '',
      endTime: '',
      repeat: 'none',
      until: null,
      skip: [],
      note: '',
      amount: 0,
      kind: 'out',
      cat: 'other',
      on: false,
      series: null,
      ...preset,
    };
  }
  const hasMoney = v => v.amount > 0;
  formModal({
    // one day of a repeat saves with its button: the choice below decides what is saved
    auto: !onDay,
    title: current ? $t('Edit appointment') : $t('New appointment'),
    values,
    fields: [
      onDay
        ? {
            k: 'scope',
            type: 'seg',
            label: $t('Apply the changes to'),
            options: SCOPES(),
            live: true,
          }
        : null,
      { k: 'title', type: 'text', label: $t('What'), ph: $t('Dentist, dinner at Ana’s, the school play…') },
      cals.length > 1
        ? { k: 'cal', type: 'select', label: $t('Calendar'), options: cals.map(c => [c.id, c.name]) }
        : null,
      { k: 'date', type: 'date', label: $t('Day'), half: true, live: true },
      { k: 'end', type: 'date', label: $t('Last day'), empty: $t('Same day'), half: true },
      { k: 'time', type: 'time', label: $t('Starts at'), half: true, hint: $t('Leave empty for all day.') },
      { k: 'endTime', type: 'time', label: $t('Ends at'), half: true },
      {
        k: 'repeat',
        type: 'select',
        label: $t('Repeats'),
        options: REPEAT_OPTIONS(),
        live: true,
        half: true,
        show: v => v.scope !== 'one',
        hint: repeating && !onDay ? $t('Changes here apply to every day it repeats on.') : '',
      },
      {
        k: 'until',
        type: 'date',
        label: $t('Until'),
        empty: $t('No end'),
        half: true,
        show: v => v.repeat !== 'none' && v.scope !== 'one',
      },
      { k: 'money', type: 'sec', label: $t('Money') },
      {
        k: 'amount',
        type: 'money',
        label: $t('Amount'),
        half: true,
        blank: true,
        ph: $t('No money'),
        live: true,
        hint: $t('What it costs, or brings in.'),
      },
      {
        k: 'kind',
        type: 'seg',
        label: $t('Type'),
        half: true,
        show: hasMoney,
        options: [
          ['out', $t('Spent')],
          ['in', $t('Received')],
        ],
        then: v => {
          v.cat = 'other';
        },
      },
      { k: 'cat', type: 'select', label: $t('Category'), options: CATS, show: v => hasMoney(v) && v.kind === 'out' },
      { k: 'cat', type: 'select', label: $t('Category'), options: INCATS, show: v => hasMoney(v) && v.kind === 'in' },
      { k: 'on', type: 'toggle', label: $t('Plan'), text: $t('Count in my plan'), show: hasMoney, live: true },
      NOTE,
    ].filter(Boolean),
    preview: v => [repeatText(v), moneyText(v)].filter(Boolean).join(' '),
    onSave: v => {
      const start = D.parse(v.date);
      if (!String(v.title || '').trim()) {
        return $t('Give it a name.');
      }
      if (start === null) {
        return $t('Pick a day.');
      }
      if (v.end && D.parse(v.end) < start) {
        return $t('The last day is before the first day.');
      }
      if (v.time && v.endTime && !v.end && v.endTime <= v.time) {
        return $t('It ends before it starts.');
      }
      if (v.repeat !== 'none' && v.scope !== 'one' && v.until && D.parse(v.until) < start) {
        return $t('It stops repeating before its first day.');
      }
      UI.lastCal = v.cal;
      const { scope, ...rest } = v;
      const entry = {
        ...rest,
        amount: v.amount || 0,
        on: v.amount > 0 && !!v.on,
        endTime: v.time ? v.endTime : '',
        until: v.repeat === 'none' ? null : v.until,
      };
      if (entry.amount > 0 && !entry.on) {
        UI.agendaTouched.add(entry.id); // money not counted yet: leaving the page asks about it (views/agenda.js)
      }
      if (onDay) {
        Actions.editOccurrence(id, day, entry, scope);
      } else {
        Actions.saveEntry(entry);
      }
      return '';
    },
    onDelete:
      current &&
      (() => {
        if (onDay) {
          return deleteScopeModal(current, day);
        }
        if (repeating) {
          return confirmModal(
            $t('Delete “{0}”?', current.title),
            $t('It is deleted from every day it repeats on. You can undo this afterwards.'),
            $t('Delete'),
            () => Actions.removeEntry(id),
          );
        }
        return Actions.removeEntry(id);
      }),
  });
}
