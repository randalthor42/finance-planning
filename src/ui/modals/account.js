/**
 * @file Editing window for an account (debit, cash, savings, credit card), and spendable(), the money you can spend now.
 */
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { confirmModal } from '../components/modal.js';
import { curK, monthAt } from '../state.js';
import { find, need, remove, upsert } from '../helpers.js';

export const ACC_TYPES = [
  ['debit', $t('Bank account')],
  ['cash', $t('Cash')],
  ['savings', $t('Savings account')],
  ['credit', $t('Credit card')],
];
export const spendable = accounts =>
  accounts.filter(a => a.type === 'debit' || a.type === 'cash').reduce((s, a) => s + a.balance, 0);
/**
 * Account balances and the month planner are two views of the same money. When the money you can spend changes
 * while today is inside the current month, offer to work the month out from the new balance (the difference becomes
 * a balance correction, exactly as in "Update balances"), so "You have now" and the accounts agree.
 */
function offerMonthUpdate(before, after) {
  const spends = type => type === 'debit' || type === 'cash';
  const oldValue = before && spends(before.type) ? before.balance : 0;
  const newValue = spends(after.type) ? after.balance || 0 : 0;
  const month = monthAt(curK());
  const today = Store.day;
  if (Math.abs(newValue - oldValue) < 0.005 || !month || today < month.start || today > month.end) {
    return;
  }
  // after the edit window has closed
  setTimeout(() => {
    const accounts = Store.plan.accounts;
    confirmModal(
      $t('Update this month too?'),
      $t(
        '“You have now” becomes {0}, the money in your bank accounts and cash. The difference is saved as a balance correction.',
        money(spendable(accounts)),
      ),
      $t('Update the month'),
      () => Actions.reconcile(accounts, month.key, spendable(accounts), [], {}),
      'primary',
    );
  }, 0);
}
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
                'Money you can borrow and pay back. Unused credit counts as available if needed, not as money to spend.',
              )
            : v.type === 'savings'
              ? $t('Counts as available if needed, not as money to spend.')
              : $t('Counts as money you can spend.'),
      },
      {
        k: 'balance',
        type: 'money',
        neg: true,
        blank: true,
        label: $t('Balance today'),
        show: v => v.type !== 'credit',
      },
      { k: 'limit', type: 'money', half: true, label: $t('Card limit'), show: v => v.type === 'credit' },
      {
        k: 'avail',
        type: 'money',
        half: true,
        label: $t('Still available'),
        show: v => v.type === 'credit',
        info: $t('As shown in your bank app. We work out what you owe.'),
      },
      {
        k: 'apr',
        type: 'num',
        min: 0,
        max: 100,
        step: 0.01,
        label: $t('Interest (% a year)'),
        show: v => v.type === 'credit',
        info: $t('Optional. Interest is added monthly.'),
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
          offerMonthUpdate(current, v),
          '')),
    onDelete: current && (() => remove('accounts', id)),
  });
}
