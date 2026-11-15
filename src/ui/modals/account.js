/**
 * @file Editing window for an account (debit, cash, savings, credit card), and spendable(), the money you can spend now.
 */
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { find, need, remove, upsert } from '../helpers.js';

export const ACC_TYPES = [
  ['debit', $t('Bank account')],
  ['cash', $t('Cash')],
  ['savings', $t('Savings account')],
  ['credit', $t('Credit card')],
];
export const spendable = accounts =>
  accounts.filter(a => a.type === 'debit' || a.type === 'cash').reduce((s, a) => s + a.balance, 0);
export function accountModal(id) {
  const current = id && find('accounts', id);
  formModal({
    title: current ? $t('Edit account') : $t('Add an account'),
    values: current
      ? { ...current, avail: Math.max(0, current.limit - current.owed) }
      : {
          id: uid(),
          name: '',
          type: 'debit',
          balance: 0,
          limit: 0,
          owed: 0,
          avail: 0,
          apr: 0,
          main: !Store.plan.accounts.length,
          note: '',
        },
    preview: v =>
      v.type === 'credit' && v.limit > 0
        ? $t('You owe {0} on this card.', money(Math.max(0, v.limit - (v.avail || 0))))
        : '',
    fields: [
      { k: 'name', type: 'text', max: 40, label: $t('Name'), ph: $t('Main account, wallet, credit card…') },
      {
        k: 'type',
        type: 'seg',
        label: $t('Type'),
        options: ACC_TYPES,
        hint: v =>
          v.type === 'credit'
            ? $t(
                'Money you can borrow and pay back. What is still available counts as emergency money, not as money to spend.',
              )
            : v.type === 'savings'
              ? $t('Counts as emergency money, not as money to spend.')
              : $t('Counts as money you can spend.'),
      },
      {
        k: 'balance',
        type: 'money',
        neg: true,
        blank: true,
        label: $t('In it right now'),
        show: v => v.type !== 'credit',
      },
      { k: 'limit', type: 'money', half: true, label: $t('Card limit'), show: v => v.type === 'credit' },
      {
        k: 'avail',
        type: 'money',
        half: true,
        label: $t('Still available'),
        show: v => v.type === 'credit',
        info: $t(
          'What you could still spend on the card today. What you owe is worked out for you: the limit minus what is still available.',
        ),
      },
      {
        k: 'apr',
        type: 'num',
        min: 0,
        max: 100,
        step: 0.01,
        label: $t('Interest (% a year)'),
        show: v => v.type === 'credit',
        info: $t(
          'Optional. With a rate set, what you owe grows by one twelfth of it every month. To pay the card off, add a bill and set “Pays off” to this card: each payment lowers what you owe and frees the same amount again.',
        ),
      },
      {
        k: 'main',
        type: 'toggle',
        label: $t('Main account'),
        text: $t('Use as my main account'),
        show: v => v.type === 'debit' || v.type === 'cash',
        hint: $t('Chosen automatically wherever you pick an account, and used when you tick something as paid.'),
      },
      NOTE,
    ],
    onSave: v =>
      need(v) ||
      (v.type === 'credit' && (v.avail || 0) > v.limit
        ? $t('What is still available cannot be more than the limit.')
        : ((Store.tag = 'acc' + v.id),
          upsert('accounts', {
            ...v,
            balance: v.balance || 0,
            owed: v.type === 'credit' ? Math.max(0, v.limit - (v.avail || 0)) : 0,
          }),
          v.main && Actions.setMain(v.id),
          (Store.tag = null),
          '')),
    onDelete: current && (() => remove('accounts', id)),
  });
}
