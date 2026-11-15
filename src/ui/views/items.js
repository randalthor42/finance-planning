/**
 * @file Purchase log page.
 */
import { D, M } from '../../core/dates.js';
import { signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { CAT_NAME } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { info } from '../components/info.js';
import { amt, card, chip, empty, page, row, segc } from '../components/layout.js';
import { h } from '../dom.js';
import { remove } from '../helpers.js';
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
  const body = [];
  for (const [monthKey, items] of by) {
    body.push(
      h(
        'div',
        { class: 'grp-h' },
        h('span', { text: M.label(M.parse(monthKey), true) }),
        h('span', {
          class: 'num',
          text: signed(items.reduce((s, i) => s + (i.kind === 'in' ? i.amount : -i.amount), 0)),
        }),
      ),
    );
    body.push(
      h(
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
    );
  }
  return page(
    $t('Purchase log'),
    $t(
      'Your purchase log: everything that happens once. Planned costs, things you bought, money that came in, and spends taken from a budget.',
    ),
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
      btn($t('Log a purchase'), () => logPurchase(monthAt(currentMonth)), '', 'plus'),
      btn($t('Add to the log'), () => itemModal(null, { month: M.key(currentMonth) }), 'primary', 'plus'),
    ],
    card(
      null,
      null,
      null,
      body.length
        ? body
        : empty(
            plan.items.length ? $t('Nothing upcoming') : $t('Nothing logged yet'),
            plan.items.length
              ? $t('Switch to All to see past items.')
              : $t('Add anything that happens once. It lands in the month you pick.'),
            $t('Add to the log'),
            () => itemModal(null, { month: M.key(currentMonth) }),
          ),
    ),
  );
};
