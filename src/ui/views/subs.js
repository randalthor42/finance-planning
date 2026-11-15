/**
 * @file Subscriptions page: recurring bills in the subscriptions category.
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t, ordinal, plural } from '../../core/i18n.js';
import { recurs } from '../../logic/projection.js';
import { EVERY } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { amt, card, chip, empty, mono, page, row } from '../components/layout.js';
import { h } from '../dom.js';
import { remove } from '../helpers.js';
import { changeModal } from '../modals/change.js';
import { recModal } from '../modals/recurring.js';
import { curK } from '../state.js';
import { recStatus } from './recurring.js';
import { V } from './registry.js';

/**
 * What a bill really costs over the next 12 months, from this month on: a subscription that ends
 * (Spotify until Dec) only counts the months it still runs, one that starts later only the months after it starts.
 */
function nextYearCost(bill, fromK, anchorK) {
  let total = 0;
  for (let k = fromK; k < fromK + 12; k++) {
    if (recurs(bill, k, anchorK)) {
      total += bill.amount;
    }
  }
  return total;
}
V.subs = () => {
  const plan = Store.plan;
  const currentMonth = curK();
  const subs = plan.bills.filter(b => b.cat === 'subs');
  const anchorK = Store.proj.summary.s0;
  let perM = 0;
  let perYear = 0;
  let n = 0;
  const rows = subs.map(b => {
    const st = recStatus(b, currentMonth);
    const live = !st || (!st[2] && !st[3]);
    const yearCost = nextYearCost(b, currentMonth, anchorK);
    perYear += yearCost;
    if (live) {
      perM += b.amount / b.every;
      n++;
    }
    return row({
      left: mono(b.name),
      title: b.name,
      cls: st && st[2] ? 'off' : '',
      chips: st ? chip(st[0], st[1]) : null,
      desc: [
        EVERY.find(e => e[0] === b.every)[1],
        b.day ? $t('on the {0}', ordinal(b.day)) : '',
        $t('{0} in the next 12 months', money(yearCost)),
      ]
        .filter(Boolean)
        .join(' · '),
      right: amt(-b.amount, true),
      onclick: () => recModal('bills', b.id),
      del: () => remove('bills', b.id),
      menu: [
        live
          ? [
              $t('Cancel it after {0}', M.label(currentMonth)),
              () =>
                Actions.patch(
                  'bills',
                  b.id,
                  { to: M.key(currentMonth) },
                  $t('Cancelled “{0}” after {1}', b.name, M.label(currentMonth)),
                ),
            ]
          : null,
        [$t('Price changes from…'), () => changeModal('bills', b.id)],
      ],
    });
  });
  const add = () => recModal('bills', null, { cat: 'subs' });
  return page(
    $t('Subscriptions'),
    $t('Your subscriptions side by side. Already counted as bills.'),
    [btn($t('Add a subscription'), add, 'primary', 'plus')],
    h(
      'div',
      { class: 'kpis' },
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'l', text: $t('Subscriptions per month') }),
        h('div', { class: 'v', text: money(perM) }),
        h('div', { class: 's', text: plural(n, 'active subscription') }),
      ),
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'l', text: $t('Next 12 months') }),
        h('div', { class: 'v', text: money(perYear) }),
        h('div', { class: 's', text: $t('what cancelling all of them would free up') }),
      ),
    ),
    card(
      null,
      null,
      null,
      rows.length
        ? [
            h('div', { class: 'rows' }, rows),
            h('p', {
              class: 'small muted',
              style: 'margin-top:10px',
              text: $t('Right-click a subscription to cancel it or change its price.'),
            }),
          ]
        : empty(
            $t('No subscriptions yet'),
            $t('Add the things you pay for every month or year and could cancel.'),
            $t('Add a subscription'),
            add,
          ),
    ),
  );
};
