/**
 * @file Editing window for a salary or bill change from a given month onward.
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { Actions } from '../../state/actions.js';
import { formModal } from '../components/form.js';
import { find } from '../helpers.js';
import { curK } from '../state.js';

/** A raise, a rent increase: the amount changes from a month on and every later month, the year totals and the forecast follow. */
export function changeModal(list, id) {
  const current = find(list, id);
  formModal({
    title: $t('“{0}” changes', current.name),
    saveLabel: $t('Apply'),
    values: { amount: current.amount, month: M.key(curK() + 1) },
    fields: [
      { k: 'amount', type: 'money', label: $t('New amount'), half: true },
      { k: 'month', type: 'month', label: $t('From this month on'), half: true },
    ],
    preview: v =>
      v.month
        ? $t(
            'Until {0} it stays {1}. From {2} it is {3}. You will see two lines in the list, one ending and one starting.',
            M.label(M.parse(v.month) - 1),
            money(current.amount),
            M.label(M.parse(v.month)),
            money(v.amount || 0),
          )
        : '',
    onSave: v => {
      const k = M.parse(v.month);
      const f = M.parse(current.from);
      const t = M.parse(current.to);
      if (k === null) {
        return $t('Pick a month.');
      }
      if (f !== null && k <= f) {
        return $t('Pick a month after it starts, or just edit the amount.');
      }
      if (t !== null && k > t) {
        return $t('That is after this line ends.');
      }
      Actions.changeFrom(list, id, v.month, v.amount || 0);
      return '';
    },
  });
}
