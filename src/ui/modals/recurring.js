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
  ['vary', $t('Varies')],
  ['budget', $t('Up to')],
];
const KIND_HINT = {
  fixed: $t('The same amount every time, like rent or internet. Tick it off when it is paid.'),
  vary: $t(
    'An estimate, like water or electricity. When the real bill arrives, click it in the month planner and enter what it really was.',
  ),
  budget: $t(
    'An upper limit you spend from during the month, like groceries, cigarettes or a haircut. You do not have to log anything: logging purchases is optional and only shows what is left.',
  ),
};
export const RESERVE_MODES = [
  ['reserved', $t('Reserved')],
  ['tracked', $t('Tracked')],
];
export const RESERVE_HINT = {
  reserved: $t(
    'The whole amount is set aside every month, and what you log uses it up. Best for money you will certainly spend, like groceries.',
  ),
  tracked: $t(
    'Nothing is set aside. Only what you really log counts, and it comes out of your free money. Best for spending you want to watch but not plan for, like eating out or shopping.',
  ),
};
const accountOpts = none => [['', none], ...Store.plan.accounts.map(a => [a.id, a.name])];
export function recModal(list, id, preset) {
  const inc = list === 'incomes';
  const current = id && find(list, id);
  const plan = Store.plan;
  const loanOpts = [['', $t('No')], ...plan.loans.map(l => [l.id, $t('Yes, “') + l.name + '”'])];
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
        label: $t('Ends after'),
        empty: $t('No end date'),
        half: true,
        live: true,
        info: $t(
          'For something you pay off in instalments, set the last month here. The list then shows how many payments and how much are left.',
        ),
      },
      ...(!inc && plan.accounts.some(a => a.type === 'credit')
        ? [
            {
              k: 'payTo',
              type: 'select',
              live: true,
              show: v => v.kind === 'fixed',
              label: $t('Pays off'),
              options: [
                ['', $t('Nothing')],
                ...plan.accounts.filter(a => a.type === 'credit').map(a => [a.id, a.name]),
              ],
              info: $t(
                'For the bill you pay your credit card with. Each payment lowers what you owe on the card and frees the same amount to use again.',
              ),
            },
          ]
        : []),
      ...(!inc && plan.loans.length
        ? [
            {
              k: 'untilLoan',
              type: 'select',
              show: debtLike,
              label: $t('Paid off by a loan?'),
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
      (v.kind === 'vary'
        ? $t('Planned as an estimate. ')
        : v.kind === 'budget'
          ? v.reserveMode === 'tracked'
            ? $t('A limit to watch: nothing is set aside until you spend. ')
            : $t('Planned as the most you would spend in a month. ')
          : '') + (v.every > 1 && v.amount ? $t('That is about {0} a month.', money(v.amount / v.every)) : ''),
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
