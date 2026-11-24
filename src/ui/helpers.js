/**
 * @file Small helpers shared by views and modals: save or delete a record with the standard confirmation, look up accounts.
 */
import { $t } from '../core/i18n.js';
import { SHIFTS } from '../models/categories.js';
import { Actions } from '../state/actions.js';
import { Store } from '../state/store.js';
import { confirmModal } from './components/modal.js';
import { UI } from './state.js';

/* --- 6.7 the page changes data only through Actions (section 4) --- */
export const upsert = (list, obj) => Actions.save(list, obj);
/** Records with things that depend on them (costs, payments, a pot, bills paid from an account): ask before deleting. */
const ASK_BEFORE_DELETE = new Set(['accounts', 'trips', 'loans', 'goals']);
/** Deletes a record. Simple lines go at once (Undo is in the notification); records with dependants ask first. */
export function remove(list, id) {
  const record = ASK_BEFORE_DELETE.has(list) ? find(list, id) : null;
  if (!record) {
    return Actions.remove(list, id);
  }
  confirmModal(
    $t('Delete “{0}”?', record.name),
    $t('It goes with everything it adds to your months. You can undo this afterwards.'),
    $t('Delete'),
    () => Actions.remove(list, id),
  );
}
/** What Actions.setPaid needs to tick off (or untick) a line of a projected month. A budget ticks nothing: it closes. */
export const tickOf = e => ({
  key: e.key,
  label: e.label,
  amount: e.budget ? 0 : e.onCard ? -e.charged : e.amount,
  payTo: e.payTo || e.cover || null,
  account: e.account || null,
});
export const accName = id => (Store.plan.accounts.find(a => a.id === id) || {}).name || '';
export const mainAcc = () => (Store.plan.accounts.find(a => a.main) || {}).id || null;
export const find = (list, id) => Store.plan[list].find(x => x.id === id);
export const need = v => (!String(v.name || '').trim() ? $t('Give it a name.') : '');
export const dayFields = inc => [
  {
    k: 'day',
    type: 'num',
    blank: true,
    half: true,
    min: 1,
    max: 31,
    step: 1,
    ph: inc ? $t('Payday') : $t('No fixed day'),
    label: inc ? $t('Day of the month it arrives') : $t('Day of the month it is paid'),
    hint: inc ? $t('Leave empty if it arrives on your payday.') : $t('Leave empty if there is no fixed day.'),
  },
  { k: 'shift', type: 'select', half: true, label: $t('If that day is a weekend'), options: SHIFTS },
];
/**
 * Where an editing window saves its record: the plan (inPlan, the default) or the drafts of My calendar (inDrafts),
 * which count for nothing until they are applied. The windows of one-offs and trips take one (itemModal, tripModal),
 * so a draft is made in the same window, with the same checks, as the record it will become.
 */
export const inPlan = {
  draft: false,
  find: (list, id) => find(list, id),
  save: (list, obj) => upsert(list, obj),
  remove: (list, id) => remove(list, id),
};
export const inDrafts = {
  draft: true,
  find: (list, id) => Store.plan.agenda.drafts[list].find(x => x.id === id),
  save: (list, obj) => {
    UI.agendaTouched.add(obj.id); // leaving My calendar asks whether to apply it (views/agenda.js)
    return Actions.saveDraft(list, obj);
  },
  remove: (list, id) => Actions.removeDraft(list, id),
};
