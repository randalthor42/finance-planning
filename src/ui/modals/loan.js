/**
 * @file Editing window for a loan.
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { loanCalc } from '../../logic/loans.js';
import { normPlan } from '../../models/plan.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { dayFields, find, need, remove, upsert } from '../helpers.js';
import { nowK } from '../state.js';

export function loanModal(id) {
  const current = id && find('loans', id);
  const settings = Store.plan.settings;
  formModal({
    auto: true,
    title: current ? $t('Edit loan') : $t('Add a loan'),
    wide: true,
    values: current || {
      id: uid(),
      name: '',
      on: true,
      amount: 0,
      rate: 7,
      term: 48,
      first: M.key(nowK() + 1),
      day: 0,
      shift: 'none',
      feePct: 0,
      feeMin: 0,
      feeFin: true,
      payout: 'direct',
      extra: 0,
      extras: {},
      early1: 0,
      early2: 0,
    },
    fields: [
      { k: 'name', type: 'text', label: $t('Name'), ph: $t('Car loan, bank loan for dental work…') },
      {
        k: 'amount',
        type: 'money',
        label: $t('Amount you need'),
        half: true,
        hint: $t('For a loan you already have, enter the original amount and its real first payment month.'),
      },
      {
        k: 'rate',
        type: 'num',
        label: $t('Interest rate (% a year, nominal)'),
        half: true,
        min: 0,
        max: 100,
        step: 0.01,
      },
      { k: 'term', type: 'num', label: $t('Length (months)'), half: true, min: 1, max: 600, step: 1 },
      { k: 'first', type: 'month', label: $t('First payment month'), half: true },
      {
        k: 'payout',
        type: 'seg',
        label: $t('Where does the money go?'),
        options: [
          ['direct', $t('Straight to what it pays for')],
          ['cash', $t('Into my account')],
        ],
        hint: v =>
          v.payout === 'cash'
            ? $t('The amount is added to your cash the month before the first payment.')
            : $t('Your cash is not touched. Only the payments show up.'),
      },
      ...dayFields(false),
      { type: 'sec', label: $t('Fees and extra payments (optional)') },
      { k: 'feePct', type: 'num', label: $t('Opening fee (%)'), half: true, min: 0, max: 20, step: 0.01 },
      { k: 'feeMin', type: 'money', label: $t('Minimum opening fee'), half: true },
      { k: 'feeFin', type: 'toggle', label: $t('Opening fee'), text: $t('Added to the loan (not paid in cash)') },
      {
        k: 'extra',
        type: 'money',
        label: $t('Extra payment every month'),
        hint: $t('You can also set a different extra for single months in the loan’s schedule.'),
      },
      {
        k: 'early1',
        type: 'num',
        label: $t('Early repayment fee, over 12 months left (%)'),
        half: true,
        min: 0,
        max: 10,
        step: 0.01,
      },
      {
        k: 'early2',
        type: 'num',
        label: $t('Early repayment fee, 12 months or less (%)'),
        half: true,
        min: 0,
        max: 10,
        step: 0.01,
      },
      NOTE,
      { k: 'on', type: 'toggle', label: $t('Include in plan'), text: $t('Count this loan in my plan') },
    ],
    preview: v => {
      const c = loanCalc(normPlan({ settings: settings, loans: [v] }).loans[0]);
      return c
        ? $t(
            'Monthly payment {0} · you borrow {1}{2} · total interest {3} · paid off {4}',
            money(c.pay),
            money(c.P),
            c.fee > 0 ? $t(' (fee ') + money(c.fee) + ')' : '',
            money(c.int),
            M.label(c.end),
          )
        : $t('Enter an amount to see the monthly payment.');
    },
    onSave: v =>
      need(v) ||
      (!(v.amount > 0)
        ? $t('Enter the loan amount.')
        : !(v.term >= 1)
          ? $t('The length must be at least 1 month.')
          : !v.first
            ? $t('Pick the first payment month.')
            : (upsert('loans', v), '')),
    onDelete: current && (() => remove('loans', id)),
  });
}
