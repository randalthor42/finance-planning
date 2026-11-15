/**
 * @file Transactions page (the purchase log): everything that happens once, newest first, with search, filters and
 * a total of what is shown. Grouped by budget month; past months start folded unless a search or filter is on.
 */
import { D, M } from '../../core/dates.js';
import { signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { normaliseText } from '../../logic/search.js';
import { CAT_NAME } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { info } from '../components/info.js';
import { amt, card, chip, empty, page, row, segc } from '../components/layout.js';
import { h } from '../dom.js';
import { remove } from '../helpers.js';
import { icon } from '../icons.js';
import { itemModal, logPurchase } from '../modals/item.js';
import { UI, curK, monthAt } from '../state.js';
import { V } from './registry.js';

/** Lines drawn per "page" of the log. */
const LOG_PAGE = 200;
/** Signed amount of one entry: money out is negative. */
const signedAmount = item => (item.kind === 'in' ? item.amount : -item.amount);
/** Sort key inside the log: by budget month, then by day (undated last within a month). */
const when = item => M.parse(item.month) * 100000 + (D.parse(item.date) ?? 99999);

/** Does an entry pass the search text and the filters chosen in the toolbar? */
function matches(item, filter, budgetNames) {
  if (filter.kind !== 'all' && item.kind !== filter.kind) {
    return false;
  }
  if (filter.budget === 'none' && item.budget) {
    return false;
  }
  if (filter.budget && filter.budget !== 'none' && item.budget !== filter.budget) {
    return false;
  }
  if (filter.text) {
    const haystack = normaliseText([item.name, item.note, CAT_NAME[item.cat], budgetNames[item.budget]].join(' '));
    return haystack.includes(normaliseText(filter.text).trim());
  }
  return true;
}

/** Search field, filters and sort. Typing redraws after a short pause so the field keeps up on long logs. */
function toolbar(filter, budgets, shownCount, totalCount, shownSum) {
  let timer = 0;
  const search = h('input', {
    type: 'search',
    value: filter.text,
    placeholder: $t('Search'),
    'aria-label': $t('Search transactions'),
    oninput: () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        filter.text = search.value;
        App.render();
        const again = document.querySelector('.logbar input[type=search]');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      }, 150);
    },
  });
  const select = (label, value, options, onChange) =>
    h(
      'select',
      { class: 'lbar-btn lbar-select', 'aria-label': label, onchange: event => onChange(event.target.value) },
      options.map(([optionValue, text]) => h('option', { value: optionValue, selected: optionValue === value, text })),
    );
  const set = change => {
    Object.assign(filter, change);
    App.render();
  };
  const active = filter.text || filter.kind !== 'all' || filter.budget;
  return h(
    'div',
    { class: 'lbar logbar' },
    h('label', { class: 'lbar-search' }, icon('search'), search),
    select(
      $t('Type'),
      filter.kind,
      [
        ['all', $t('Spent and received')],
        ['out', $t('Spent')],
        ['in', $t('Received')],
      ],
      kind => set({ kind }),
    ),
    budgets.length
      ? select(
          $t('Budget'),
          filter.budget,
          [['', $t('Any budget')], ['none', $t('No budget')], ...budgets.map(b => [b.id, b.name])],
          budget => set({ budget }),
        )
      : null,
    select(
      $t('Order'),
      filter.order,
      [
        ['new', $t('Newest first')],
        ['old', $t('Oldest first')],
      ],
      order => set({ order }),
    ),
    h(
      'span',
      { class: 'lbar-count' },
      active
        ? $t('{0} of {1} · {2}', shownCount, totalCount, signed(shownSum))
        : $t('{0} · {1}', plural(totalCount, 'entry'), signed(shownSum)),
      active
        ? h('button', {
            type: 'button',
            class: 'lbar-clear',
            text: $t('Clear'),
            onclick: () => set({ text: '', kind: 'all', budget: '' }),
          })
        : null,
    ),
  );
}

V.items = () => {
  const plan = Store.plan;
  const currentMonth = curK();
  const filter = UI.logFilter;
  const all = UI.itemFilter === 'all';
  const budgets = plan.bills.filter(b => b.budget);
  const budgetNames = Object.fromEntries(plan.bills.map(b => [b.id, b.name]));
  const inRange = plan.items.filter(i => all || M.parse(i.month) >= currentMonth);
  const direction = filter.order === 'old' ? 1 : -1;
  const list = inRange.filter(i => matches(i, filter, budgetNames)).sort((a, b) => (when(a) - when(b)) * direction);
  const searching = !!(filter.text || filter.kind !== 'all' || filter.budget);
  const by = new Map();
  for (const i of list) {
    if (!by.has(i.month)) {
      by.set(i.month, []);
    }
    by.get(i.month).push(i);
  }
  const cards = [];
  // at most UI.logLimit lines are drawn (200 at first, "Show more" adds 200): a long log stays quick on a phone
  let linesLeft = UI.logLimit;
  let linesHidden = 0;
  for (const [monthKey, items] of by) {
    // past months start folded and a hand choice is remembered; a search or filter opens every month with a match
    const folded = monthKey in UI.itemMonths ? UI.itemMonths[monthKey] : M.parse(monthKey) < currentMonth;
    const isClosed = !searching && folded;
    const drawn = isClosed ? [] : items.slice(0, Math.max(0, linesLeft));
    if (!isClosed) {
      linesLeft -= drawn.length;
      linesHidden += items.length - drawn.length;
    }
    cards.push(
      card(
        null,
        null,
        null,
        h(
          'button',
          {
            type: 'button',
            class: 'grp-h grp-toggle' + (isClosed ? ' closed' : ''),
            'aria-expanded': String(!isClosed),
            title: isClosed ? $t('Show the lines') : $t('Hide the lines'),
            onclick: () => {
              UI.itemMonths[monthKey] = !isClosed;
              App.render();
            },
          },
          icon('right'),
          h('span', { text: M.label(M.parse(monthKey), true) }),
          h('span', { class: 'grp-n', text: plural(items.length, 'entry') }),
          h('span', { class: 'grow' }),
          h('span', { class: 'num', text: signed(items.reduce((s, i) => s + signedAmount(i), 0)) }),
        ),
        isClosed || !drawn.length
          ? null
          : h(
              'div',
              { class: 'rows' },
              drawn.map(i =>
                row({
                  title: i.name,
                  chips: [
                    i.note ? info(i.note) : null,
                    i.budget ? chip($t('from {0}', budgetNames[i.budget]), 'acc') : null,
                    D.parse(i.date) !== null && D.parse(i.date) > Store.day ? chip($t('planned')) : null,
                  ],
                  desc: [i.date ? D.label(D.parse(i.date), { weekday: 'short' }) : '', CAT_NAME[i.cat]]
                    .filter(Boolean)
                    .join(' · '),
                  right: amt(signedAmount(i)),
                  onclick: () => itemModal(i.id),
                  del: () => remove('items', i.id),
                  menu: [[$t('Copy'), () => Actions.duplicate('items', i.id)]],
                }),
              ),
            ),
      ),
    );
  }
  if (linesHidden > 0) {
    cards.push(
      h(
        'div',
        { class: 'tblmore' },
        h('button', {
          type: 'button',
          class: 'btn sm ghost',
          text: $t('Show {0} more', Math.min(linesHidden, LOG_PAGE)),
          onclick: () => {
            UI.logLimit += LOG_PAGE;
            App.render();
          },
        }),
        h('span', { class: 'muted small', text: $t('{0} lines not shown', linesHidden) }),
      ),
    );
  }
  const shownSum = list.reduce((s, i) => s + signedAmount(i), 0);
  const add = () => logPurchase(monthAt(currentMonth));
  return page(
    $t('Transactions'),
    $t('Everything that happens once: spent, planned or received.'),
    [
      segc(
        [
          ['upcoming', $t('This month on')],
          ['all', $t('All')],
        ],
        UI.itemFilter,
        v => {
          UI.itemFilter = v;
          App.render();
        },
      ),
      btn($t('Add transaction'), add, 'primary', 'plus'),
    ],
    plan.items.length ? toolbar(filter, budgets, list.length, inRange.length, shownSum) : null,
    cards.length
      ? h('div', { class: 'stack' }, cards)
      : card(
          null,
          null,
          null,
          searching
            ? empty($t('Nothing matches'), $t('Try another word or clear the filters.'), $t('Clear'), () => {
                Object.assign(filter, { text: '', kind: 'all', budget: '' });
                App.render();
              })
            : empty(
                plan.items.length ? $t('Nothing from this month on') : $t('Nothing logged yet'),
                plan.items.length
                  ? $t('Switch to All to see past transactions.')
                  : $t('Add anything that happens once. A later day or month makes it planned.'),
                $t('Add transaction'),
                add,
              ),
        ),
  );
};
