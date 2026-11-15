/**
 * @file Editing window for the purchase log: purchases, planned one-offs, money in, spends logged against a budget.
 */
import { D, M, Period } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { clamp, uid } from '../../core/util.js';
import { CATS, INCATS } from '../../models/categories.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { find, need, remove, upsert } from '../helpers.js';
import { selK } from '../state.js';

export function itemModal(id, preset, title) {
  const current = id && find('items', id);
  const plan = Store.plan;
  const budgets = plan.bills.filter(b => b.budget);
  const names = () => [...new Set(plan.items.map(i => i.name).filter(Boolean))].slice(-60);
  formModal({
    preview: v => {
      const d = D.parse(v.date);
      if (d === null || !plan.settings.payDay) {
        return '';
      }
      const k = Period.of(plan.settings, d);
      return $t(
        '{0} belongs to {1}: that budget month runs from {2} to {3}, on the salary that arrives on {2}.',
        D.label(d),
        M.label(k, true),
        D.label(Period.start(plan.settings, k)),
        D.label(Period.end(plan.settings, k)),
      );
    },
    auto: true,
    title:
      title ||
      (current
        ? current.budget
          ? $t('Edit spend')
          : $t('Edit purchase')
        : preset && preset.budget
          ? $t('Log a spend')
          : $t('Add to the purchase log')),
    values: current || {
      id: uid(),
      name: '',
      amount: 0,
      kind: 'out',
      month: M.key(selK()),
      date: null,
      cat: 'other',
      budget: null,
      note: '',
      ...preset,
    },
    fields: [
      {
        k: 'kind',
        type: 'seg',
        label: $t('Type'),
        options: [
          ['out', $t('Cost')],
          ['in', $t('Money in')],
        ],
      },
      ...(budgets.length
        ? [
            {
              k: 'budget',
              type: 'select',
              live: true,
              show: v => v.kind === 'out',
              label: $t('Taken from a budget?'),
              options: [['', $t('No, it is an extra cost')], ...budgets.map(b => [b.id, b.name])],
              info: $t(
                'A spend from a budget uses up that budget instead of adding to the month. Use the name to say what exactly it was (water, cat food), so the review can show how much goes on each.',
              ),
            },
          ]
        : []),
      { k: 'name', type: 'text', label: $t('What is it?'), ph: $t('Water, trousers, concert tickets…'), list: names() },
      { k: 'amount', type: 'money', label: $t('Amount'), half: true },
      { k: 'date', type: 'date', label: $t('Day'), empty: $t('No exact day'), half: true, live: true },
      { k: 'month', type: 'month', label: $t('Month it belongs to'), show: v => !v.date },
      ...(plan.accounts.some(a => a.type === 'credit')
        ? [
            {
              k: 'account',
              type: 'select',
              show: v => v.kind === 'out',
              label: $t('Paid with'),
              options: [
                ['', $t('My own money')],
                ...plan.accounts.filter(a => a.type === 'credit').map(a => [a.id, a.name]),
              ],
              info: $t('Paid with a credit card, it takes no cash: it is added to what you owe on the card.'),
            },
          ]
        : []),
      { k: 'cat', type: 'select', label: $t('Category'), options: CATS, show: v => v.kind === 'out' && !v.budget },
      { k: 'cat', type: 'select', label: $t('Category'), options: INCATS, show: v => v.kind === 'in' },
      NOTE,
    ],
    onSave: v => {
      const b = v.kind === 'out' && v.budget ? find('bills', v.budget) : null;
      if (b && !String(v.name).trim()) {
        v.name = b.name;
      }
      return (
        need(v) ||
        (!(v.amount > 0)
          ? $t('Enter an amount above zero.')
          : !v.date && !v.month
            ? $t('Pick a day or a month.')
            : (upsert('items', {
                ...v,
                budget: b ? b.id : null,
                cat: b ? b.cat : v.cat,
                account: v.kind === 'out' && v.account ? v.account : null,
              }),
              ''))
      );
    },
    onDelete: current && (() => remove('items', id)),
  });
}
export const logSpend = (billId, m) =>
  itemModal(null, { budget: billId, date: D.key(clamp(Store.day, m.start, m.end)) });
/** Something you bought that was not planned (trousers, a repair, extra cat supplies): a dated one-off, optionally taken from a budget. */
export const logPurchase = m =>
  itemModal(null, { date: D.key(clamp(Store.day, m.start, m.end)), cat: 'shopping' }, $t('Log a purchase'));
