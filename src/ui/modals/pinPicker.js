/**
 * @file "Add from your plan" (My calendar): records of the plan, one by one, to always show on the calendar whatever
 * it shows of the plan otherwise (its layers and categories): a trip, an event, a bill, an upcoming purchase, a loan…
 * A tick is saved at once; everything ticked while the window is open is one step for Undo.
 */
import { D, M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { EVERY } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { modal } from '../components/modal.js';
import { h } from '../dom.js';
import { curK } from '../state.js';

/** Upcoming one-offs shown at most: the soonest first. */
const MAX_ITEMS = 100;
const every = r => (EVERY.find(e => e[0] === r.every) || EVERY[0])[1];
const tripWhen = t => {
  const from = D.parse(t.from);
  const to = D.parse(t.to);
  if (from === null) {
    return M.label(M.parse(t.month), true);
  }
  return to === null
    ? D.label(from, { year: 'numeric' })
    : $t('{0} to {1}', D.label(from), D.label(to, { year: 'numeric' }));
};

/** The sections of the picker: [list, title, records, describe(record)]. Only records that put lines in the months. */
function sections(plan) {
  const today = Store.day;
  const now = curK();
  const upcoming = plan.items
    .filter(i => (i.date ? D.parse(i.date) >= today : M.parse(i.month) >= now))
    .sort((a, b) => (a.date || a.month).localeCompare(b.date || b.month))
    .slice(0, MAX_ITEMS);
  return [
    ['trips', $t('Trips and events'), plan.trips.filter(t => t.on && t.kind !== 'idea'), tripWhen],
    ['incomes', $t('Income'), plan.incomes, r => $t('{0} · {1}', money(r.amount), every(r))],
    ['bills', $t('Bills and budgets'), plan.bills, r => $t('{0} · {1}', money(r.amount), every(r))],
    [
      'items',
      $t('Upcoming transactions'),
      upcoming,
      i =>
        $t(
          '{0} · {1}',
          money(i.amount),
          i.date ? D.label(D.parse(i.date), { year: 'numeric' }) : M.label(M.parse(i.month)),
        ),
    ],
    [
      'loans',
      $t('Loans'),
      plan.loans.filter(l => l.on),
      l => $t('{0} · from {1}', money(l.amount), M.label(M.parse(l.first))),
    ],
    [
      'goals',
      $t('Savings goals'),
      plan.goals.filter(g => g.on),
      g => (g.monthly ? $t('{0} a month', money(g.monthly)) : ''),
    ],
    [
      'wishes',
      $t('Wishlist'),
      plan.wishes.filter(w => w.on),
      w => $t('{0} · {1}', money(w.price), M.label(M.parse(w.month))),
    ],
  ].filter(([, , records]) => records.length);
}

/**
 * Opens "Add from your plan": a list of the records of the plan to tick, to always show them on My calendar.
 * @returns {HTMLElement} the open window
 */
export function pinPicker() {
  const plan = Store.plan;
  const tag = 'p' + uid();
  const pinned = new Set(plan.agenda.pins.map(p => p.list + ':' + p.id));
  const toggle = (list, id, on) => {
    const key = list + ':' + id;
    const pins = Store.plan.agenda.pins.filter(p => p.list + ':' + p.id !== key);
    if (on) {
      pins.push({ list, id });
    }
    Store.tag = tag;
    try {
      Actions.setAgenda({ pins });
    } finally {
      Store.tag = null;
    }
  };
  const groups = sections(plan).map(([list, title, records, describe]) =>
    h(
      'div',
      { class: 'agenda-pick-g' },
      h('div', { class: 'grp-h', text: title }),
      h(
        'div',
        { class: 'rows' },
        records.map(r =>
          h(
            'label',
            { class: 'row agenda-pick-r', 'data-name': r.name.toLowerCase() },
            h('input', {
              type: 'checkbox',
              class: 'check',
              checked: pinned.has(list + ':' + r.id),
              onchange: e => toggle(list, r.id, e.target.checked),
            }),
            h(
              'div',
              { class: 'grow' },
              h('div', { class: 't', text: r.name }),
              h('div', { class: 'd', text: describe(r) }),
            ),
          ),
        ),
      ),
    ),
  );
  const none = h('p', { class: 'muted', hidden: true, text: $t('Nothing matches.') });
  const search = h('input', {
    class: 'inp',
    type: 'search',
    placeholder: $t('Search…'),
    'aria-label': $t('Search your plan'),
    oninput: () => {
      const q = search.value.trim().toLowerCase();
      let any = false;
      for (const g of groups) {
        let shown = 0;
        for (const r of g.querySelectorAll('.agenda-pick-r')) {
          r.hidden = !!q && !r.dataset.name.includes(q);
          shown += r.hidden ? 0 : 1;
        }
        g.hidden = !shown;
        any = any || shown > 0;
      }
      none.hidden = any;
    },
  });
  const d = modal({
    title: $t('Add from your plan'),
    wide: true,
    body: h(
      'div',
      { class: 'agenda-pick' },
      h('p', {
        class: 'muted',
        text: $t('Ticked records are always on your calendar, whatever else it shows of your plan.'),
      }),
      groups.length ? search : null,
      groups.length ? groups : h('p', { class: 'muted', text: $t('Your plan has nothing to add yet.') }),
      none,
    ),
    foot: [h('span', { class: 'sp' }), btn($t('Done'), () => d.close(), 'primary')],
  });
  search.focus();
  return d;
}
