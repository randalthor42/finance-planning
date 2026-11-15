/**
 * @file Small helpers shared by views and modals: save or delete a record with the standard confirmation, look up accounts.
 */
import { $t } from '../core/i18n.js';
import { SHIFTS } from '../models/categories.js';
import { Actions } from '../state/actions.js';
import { Store } from '../state/store.js';

/* --- 6.7 the page changes data only through Actions (section 4) --- */
export const upsert = (list, obj) => Actions.save(list, obj);
export const remove = (list, id) => Actions.remove(list, id);
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
