/**
 * @file Income and bills page.
 */
import { M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, ordinal, plural } from '../../core/i18n.js';
import { recurs } from '../../logic/projection.js';
import { CAT_NAME, EVERY } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { info } from '../components/info.js';
import { card, chip, empty, page, row } from '../components/layout.js';
import { grip, sortable } from '../components/sortable.js';
import { h } from '../dom.js';
import { find, remove } from '../helpers.js';
import { changeModal } from '../modals/change.js';
import { recModal } from '../modals/recurring.js';
import { curK } from '../state.js';
import { V } from './registry.js';

/** For something paid off in instalments (it has an end month): how many payments and how much are left. */
function leftToPay(r) {
  const t = M.parse(r.to);
  const currentMonth = curK();
  const s0 = Store.proj.summary.s0;
  if (t === null || t < currentMonth) {
    return '';
  }
  let n = 0;
  for (let x = currentMonth; x <= t; x++) {
    if (recurs(r, x, s0)) {
      n++;
    }
  }
  return n ? $t('{0} left, {1} to go', plural(n, 'payment'), money(n * r.amount)) : '';
}
export function recStatus(r, k) {
  const f = M.parse(r.from);
  const t = M.parse(r.to);
  const L = r.untilLoan && find('loans', r.untilLoan);
  const takeover = L && L.on && Store.proj.loans[L.id];
  if (t !== null && t < k) {
    return [$t('ended ') + M.label(t), '', true];
  }
  if (takeover && takeover.f0 <= k) {
    return [$t('paid off by “{0}”', L.name), '', true];
  }
  if (f !== null && f > k) {
    return [$t('starts ') + M.label(f), 'acc', false, true];
  }
  if (takeover) {
    return [$t('until “{0}” starts, {1}', L.name, M.label(takeover.f0)), 'acc', false];
  }
  if (t !== null) {
    return [$t('until ') + M.label(t), 'acc', false];
  }
  return null;
}
V.recurring = () => {
  const plan = Store.plan;
  const currentMonth = curK();
  const totals = {};
  const block = (list, title, sub, addLabel) => {
    const rows = plan[list];
    const inc = list === 'incomes';
    let total = 0;
    const els = rows.map(r => {
      const st = recStatus(r, currentMonth);
      const live = !st || (!st[2] && !st[3]);
      if (live) {
        total += r.amount / r.every;
      }
      return row({
        left: grip(),
        title: r.name,
        cls: 'srow ' + (st && st[2] ? 'off' : ''),
        chips: [
          r.note ? info(r.note) : null,
          r.budget
            ? chip(r.reserve === false ? $t('tracked budget') : $t('budget'), 'acc')
            : r.vary
              ? chip($t('varies'))
              : null,
          st ? chip(st[0], st[1]) : null,
        ],
        desc: [
          CAT_NAME[r.cat],
          EVERY.find(e => e[0] === r.every)[1].toLowerCase(),
          r.budget
            ? r.reserve === false
              ? $t('counts only when spent')
              : $t('spent bit by bit')
            : r.day
              ? $t('on the ') + ordinal(r.day)
              : '',
          leftToPay(r),
          (plan.accounts.find(a => a.id === r.account) || {}).name,
        ]
          .filter(Boolean)
          .join(' · '),
        right: h(
          'div',
          { class: 'amt' },
          money(r.amount),
          r.every > 1 ? h('div', { class: 'd', text: $t('≈ {0} a month', money(r.amount / r.every)) }) : null,
        ),
        onclick: () => recModal(list, r.id),
        del: () => remove(list, r.id),
        menu: [
          [$t('Amount changes from…'), () => changeModal(list, r.id)],
          [$t('Copy'), () => Actions.duplicate(list, r.id)],
        ],
      });
    });
    totals[list] = total;
    const box = h('div', { class: 'rows' }, els);
    sortable(box, '.srow', (a, b) => Actions.move(list, a, b), list);
    return card(
      title,
      sub,
      btn(addLabel, () => recModal(list), 'primary sm', 'plus'),
      rows.length
        ? [
            box,
            h(
              'div',
              { class: 'row', style: 'font-weight:650' },
              h('span', { class: 'grow', text: inc ? $t('Total income per month') : $t('Total bills per month') }),
              h('span', { class: 'amt', text: money(total) }),
            ),
          ]
        : empty(
            inc ? $t('No income yet') : $t('No bills yet'),
            inc
              ? $t('Add your salary and anything else that comes in regularly.')
              : $t('Add rent, groceries, phone, subscriptions and other regular costs.'),
            addLabel,
            () => recModal(list),
          ),
    );
  };
  const a = block('incomes', $t('Income'), $t('Money you receive regularly.'), $t('Add income'));
  const b = block(
    'bills',
    $t('Bills and living costs'),
    $t('Money that goes out regularly. Drag the dots to reorder.'),
    $t('Add a bill'),
  );
  const left = totals.incomes - totals.bills;
  return page(
    $t('Income and bills'),
    $t(
      'What comes in and goes out on a regular basis. If an amount changes (a raise, a rent increase), right-click the line and choose “Amount changes from…”.',
    ),
    null,
    h(
      'div',
      { class: 'kpis' },
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'l', text: $t('Regular income per month') }),
        h('div', { class: 'v', text: money(totals.incomes) }),
        h('div', { class: 's', text: $t('as of {0}', M.label(currentMonth)) }),
      ),
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'l', text: $t('Regular bills per month') }),
        h('div', { class: 'v', text: money(totals.bills) }),
        h('div', { class: 's', text: $t('yearly bills are spread over 12 months') }),
      ),
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'l', text: $t('Left after regular bills') }),
        h('div', { class: 'v ' + (left < 0 ? 'bad' : 'good'), text: signed(left) }),
        h('div', { class: 's', text: $t('before one-offs, trips, loans and savings') }),
      ),
    ),
    // one column: income is short and bills are long, so side by side they never lined up
    h('div', { class: 'stack' }, a, b),
  );
};
