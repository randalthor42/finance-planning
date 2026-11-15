/**
 * @file Purchase log page.
 */
import { D, M } from '../../core/dates.js';
import { signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
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

V.items = () => {
  const plan = Store.plan;
  const currentMonth = curK();
  const all = UI.itemFilter === 'all';
  const list = plan.items
    .filter(i => all || M.parse(i.month) >= currentMonth)
    .sort((a, b) => M.parse(a.month) - M.parse(b.month) || (D.parse(a.date) || 0) - (D.parse(b.date) || 0));
  const by = new Map();
  for (const i of list) {
    if (!by.has(i.month)) {
      by.set(i.month, []);
    }
    by.get(i.month).push(i);
  }
  const bn = Object.fromEntries(plan.bills.map(b => [b.id, b.name]));
  const cards = [];
  for (const [monthKey, items] of by) {
    // each month is a card of its own; past months start folded, and a hand choice is remembered
    const isClosed = monthKey in UI.itemMonths ? UI.itemMonths[monthKey] : M.parse(monthKey) < currentMonth;
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
          h('span', {
            class: 'num',
            text: signed(items.reduce((s, i) => s + (i.kind === 'in' ? i.amount : -i.amount), 0)),
          }),
        ),
        isClosed
          ? null
          : h(
              'div',
              { class: 'rows' },
              items.map(i =>
                row({
                  title: i.name,
                  chips: [i.note ? info(i.note) : null, i.budget ? chip($t('from {0}', bn[i.budget]), 'acc') : null],
                  desc: [i.date ? D.label(D.parse(i.date), { weekday: 'short' }) : '', CAT_NAME[i.cat]]
                    .filter(Boolean)
                    .join(' · '),
                  right: amt(i.kind === 'in' ? i.amount : -i.amount),
                  onclick: () => itemModal(i.id),
                  del: () => remove('items', i.id),
                  menu: [[$t('Copy'), () => Actions.duplicate('items', i.id)]],
                }),
              ),
            ),
      ),
    );
  }
  return page(
    $t('Purchase log'),
    $t('Everything that happens once: spent, planned or received.'),
    [
      segc(
        [
          ['upcoming', $t('Upcoming')],
          ['all', $t('All')],
        ],
        UI.itemFilter,
        v => {
          UI.itemFilter = v;
          App.render();
        },
      ),
      btn($t('Add transaction'), () => logPurchase(monthAt(currentMonth)), '', 'plus'),
      btn($t('Add planned expense'), () => itemModal(null, { month: M.key(currentMonth) }), 'primary', 'plus'),
    ],
    cards.length
      ? h('div', { class: 'stack' }, cards)
      : card(
          null,
          null,
          null,
          empty(
            plan.items.length ? $t('Nothing upcoming') : $t('Nothing logged yet'),
            plan.items.length
              ? $t('Switch to All to see past items.')
              : $t('Add anything that happens once. It lands in the month you pick.'),
            $t('Add planned expense'),
            () => itemModal(null, { month: M.key(currentMonth) }),
          ),
        ),
  );
};
