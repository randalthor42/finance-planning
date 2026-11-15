/**
 * @file Editing window for income and bills (fixed, varies, "up to" budgets).
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { CATS, EVERY, INCATS } from '../../models/categories.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { dayFields, find, mainAcc, need, remove, upsert } from '../helpers.js';
import { changeModal } from './change.js';

const BILL_KINDS = [
  ['fixed', $t('Fixed')],
  ['vary', $t('Estimate')],
  ['budget', $t('Budget')],
];
const KIND_HINT = {
  fixed: $t('Same amount every time (rent, internet).'),
  vary: $t('Changes each time (water, power). Enter the real amount when it arrives.'),
  budget: $t('A monthly limit (groceries, fuel). Logging spends is optional.'),
};
export const RESERVE_MODES = [
  ['reserved', $t('Reserved')],
  ['tracked', $t('Limit')],
];
export const RESERVE_HINT = {
  reserved: $t('Held back in full every month.'),
  tracked: $t('Nothing held back; only logged spends count.'),
};
/** One sentence on how the chosen bill type is planned (each sentence translated whole). */
function kindPreview(v) {
  if (v.kind === 'vary') {
    return $t('Planned as an estimate.');
  }
  if (v.kind !== 'budget') {
    return '';
  }
  if (v.reserveMode === 'tracked') {
    return $t('A limit to watch: nothing is set aside until you spend.');
  }
  return $t('Planned as the most you would spend in a month.');
}
const accountOpts = none => [['', none], ...Store.plan.accounts.map(a => [a.id, a.name])];
export function recModal(list, id, preset) {
  const inc = list === 'incomes';
  const current = id && find(list, id);
  const plan = Store.plan;
  const loanOpts = [['', $t('No')], ...plan.loans.map(l => [l.id, $t('Yes, “{0}”', l.name)])];
  // only debts can be taken over by a loan: instalments with an end month, the Debt category, or a card payment
  const debtLike = v => v.kind === 'fixed' && (v.cat === 'debt' || !!v.to || !!v.payTo);
  const start = current || {
    id: uid(),
    name: '',
    amount: 0,
    cat: inc ? 'salary' : 'housing',
    every: 1,
    from: null,
    to: null,
    day: 0,
    shift: 'none',
    budget: false,
    vary: false,
    untilLoan: null,
    payTo: null,
    note: '',
    account: mainAcc(),
    ...preset,
  };
  formModal({
    auto: true,
    title: inc
      ? current
        ? $t('Edit income')
        : $t('Add income')
      : start.cat === 'subs'
        ? current
          ? $t('Edit subscription')
          : $t('Add subscription')
        : current
          ? $t('Edit bill or living cost')
          : $t('Add bill or living cost'),
    values: {
      ...start,
      kind: start.budget ? 'budget' : start.vary ? 'vary' : 'fixed',
      reserveMode: start.reserve === false ? 'tracked' : 'reserved',
    },
    fields: [
      { k: 'name', type: 'text', label: $t('Name'), ph: inc ? $t('Salary') : $t('Rent, groceries, phone…') },
      ...(inc
        ? []
        : [{ k: 'kind', type: 'seg', label: $t('Type'), options: BILL_KINDS, hint: v => KIND_HINT[v.kind] }]),
      {
        k: 'reserveMode',
        type: 'seg',
        label: $t('Money'),
        options: RESERVE_MODES,
        show: v => v.kind === 'budget',
        hint: v => RESERVE_HINT[v.reserveMode],
      },
      { k: 'amount', type: 'money', label: $t('Amount'), half: true },
      { k: 'every', type: 'select', numeric: true, label: $t('How often'), options: EVERY, half: true, live: true },
      { k: 'cat', type: 'select', label: $t('Category'), options: inc ? INCATS : CATS, half: true, live: true },
      ...(plan.accounts.length
        ? [
            {
              k: 'account',
              type: 'select',
              half: true,
              label: inc ? $t('Paid into') : $t('Paid from'),
              options: accountOpts($t('Not set')),
            },
          ]
        : []),
      ...dayFields(inc).map(f => ({ ...f, show: v => v.kind !== 'budget' })),
      {
        k: 'from',
        type: 'month',
        label: $t('Starts'),
        empty: $t('From the start'),
        half: true,
        hint: v => (v.every > 1 ? $t('The first one lands in this month.') : ''),
      },
      {
        k: 'to',
        type: 'month',
        label: $t('Last payment'),
        empty: $t('No end date'),
        half: true,
        live: true,
        info: $t('For instalments.'),
      },
      ...(!inc && plan.accounts.some(a => a.type === 'credit')
        ? [
            {
              k: 'payTo',
              type: 'select',
              live: true,
              show: v => v.kind === 'fixed',
              label: $t('Pays down card'),
              options: [
                ['', $t('Nothing')],
                ...plan.accounts.filter(a => a.type === 'credit').map(a => [a.id, a.name]),
              ],
              info: $t('Each payment lowers what you owe on it.'),
            },
          ]
        : []),
      ...(!inc && plan.loans.length
        ? [
            {
              k: 'untilLoan',
              type: 'select',
              show: debtLike,
              label: $t('Replaced by a loan'),
              options: loanOpts,
              info: $t(
                'For a debt that a new loan takes over. If yes, this bill stops in the month the loan’s first payment is due.',
              ),
            },
          ]
        : []),
      NOTE,
    ].map(f =>
      f.k === 'amount'
        ? { ...f, label: inc ? $t('Amount each time') : $t('Amount'), info: $t('You can type a sum such as 120+35.') }
        : f,
    ),
    preview: v =>
      [kindPreview(v), v.every > 1 && v.amount ? $t('That is about {0} a month.', money(v.amount / v.every)) : '']
        .filter(Boolean)
        .join(' '),
    onSave: v =>
      need(v) ||
      (!(v.amount > 0)
        ? $t('Enter an amount above zero.')
        : v.from && v.to && M.parse(v.to) < M.parse(v.from)
          ? $t('The end month is before the start month.')
          : (upsert(list, {
              ...v,
              budget: v.kind === 'budget',
              reserve: v.kind !== 'budget' || v.reserveMode !== 'tracked',
              vary: v.kind === 'vary',
              payTo: v.kind === 'fixed' && v.payTo ? v.payTo : null,
              untilLoan: !inc && debtLike(v) && v.untilLoan ? v.untilLoan : null,
              account: v.account || null,
            }),
            '')),
    onDelete: current && (() => remove(list, id)),
    extra: current ? [[$t('Amount changes from…'), () => changeModal(list, id)]] : null,
  });
}
