/**
 * @file Window for one line of one month: change the amount for that month only, mark it paid, choose the account.
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { has, uid } from '../../core/util.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { formModal } from '../components/form.js';
import { find, mainAcc } from '../helpers.js';
import { goalModal } from './goal.js';
import { itemModal } from './item.js';
import { RESERVE_HINT, RESERVE_MODES, recModal } from './recurring.js';
import { tripModal } from './trip.js';
import { wishModal } from './wish.js';

/** Click on a ledger line in the month planner: edit the thing it came from, scoped to that month where it makes sense. */
export function entryModal(e, m) {
  const when = M.label(m.k, true);
  if (e.key.startsWith('item:')) {
    return itemModal(e.id);
  }
  if (e.group === 'trip') {
    return tripModal(e.id);
  }
  if (e.group === 'wish') {
    return wishModal(e.id);
  }
  if (e.group === 'goal') {
    return goalModal(e.id);
  }
  if (e.group === 'inc' || e.group === 'bill') {
    const list = e.group === 'inc' ? 'incomes' : 'bills';
    const set = val => Actions.setOverride(m.key, e.key, val === e.base ? null : val, e.label);
    return formModal({
      title: `${e.label} · ${when}`,
      values: {
        amount: e.budget ? e.budget.planned : e.onCard ? e.charged : Math.abs(e.amount),
        paid: !e.paid ? 'no' : e.paidFrom || mainAcc() || 'yes',
        reserveMode: e.budget && !e.budget.reserve ? 'tracked' : 'reserved',
      },
      fields: [
        ...(e.budget
          ? []
          : [
              {
                k: 'paid',
                type: 'select',
                label: e.amount > 0 ? $t('Received') : $t('Paid'),
                options: [
                  ['no', $t('Not yet')],
                  ...(Store.plan.accounts.length
                    ? Store.plan.accounts
                        .filter(a => a.type !== 'savings' && (e.amount < 0 || a.type !== 'credit'))
                        .map(a => [a.id, e.amount > 0 ? $t('Yes, into {0}', a.name) : $t('Yes, from {0}', a.name)])
                    : [['yes', $t('Yes')]]),
                ],
                info: $t('Choose a credit card and the cost takes no cash: it is added to what you owe on the card.'),
              },
            ]),
        {
          k: 'amount',
          type: 'money',
          blank: true,
          label: e.budget
            ? $t('Budget for this month only')
            : e.vary
              ? $t('What it really was this month')
              : $t('Amount for this month only'),
          hint: $t('Usual amount: {0}. Enter 0 to skip it this month. Other months do not change.', money(e.base)),
        },
        ...(e.budget
          ? [
              {
                k: 'reserveMode',
                type: 'seg',
                label: $t('Money this month'),
                options: RESERVE_MODES,
                hint: v => RESERVE_HINT[v.reserveMode],
              },
            ]
          : []),
      ],
      extra: [
        ...(e.over || (e.budget && e.budget.reserveOver)
          ? [
              [
                $t('Back to usual'),
                () => {
                  Store.tag = 'e' + uid();
                  set(null);
                  if (e.budget) {
                    Actions.setReserve(m.key, e.key, null, e.label);
                  }
                  Store.tag = null;
                },
              ],
            ]
          : []),
        [$t('Edit for every month'), () => recModal(list, e.id)],
      ],
      onSave: v => {
        Store.tag = 'e' + uid();
        set(v.amount === null ? null : v.amount);
        if (e.budget) {
          const want = v.reserveMode === 'reserved';
          Actions.setReserve(m.key, e.key, want === (find('bills', e.id).reserve !== false) ? null : want, e.label);
        }
        const was = !e.paid ? 'no' : e.paidFrom || mainAcc() || 'yes';
        if (!e.budget && v.paid !== was) {
          const amount = (e.amount > 0 ? 1 : -1) * (v.amount === null ? e.base : v.amount);
          Actions.setPaid(
            m.key,
            { key: e.key, label: e.label, amount, payTo: e.payTo || null },
            v.paid !== 'no',
            v.paid === 'yes' || v.paid === 'no' ? null : v.paid,
          );
        }
        Store.tag = null;
        return '';
      },
    });
  }
  if (e.group === 'loan' && e.canExtra) {
    const L = find('loans', e.id);
    return formModal({
      auto: true,
      title: `${L.name} · ${when}`,
      values: { x: has(L.extras, m.key) ? L.extras[m.key] : null },
      fields: [
        {
          k: 'x',
          type: 'money',
          blank: true,
          label: $t('Extra payment this month'),
          hint: $t('Leave empty to use the loan’s usual extra ({0}). Extra payments shorten the loan.', money(L.extra)),
        },
      ],
      extra: [[$t('Open loan'), () => App.go('loans')]],
      onSave: v => (Actions.setLoanExtra(e.id, m.key, v.x), ''),
    });
  }
  if (e.group === 'loan') {
    App.go('loans');
  }
}
