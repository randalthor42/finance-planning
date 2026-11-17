/**
 * @file The activity log's sentences for changes of My calendar's settings (state/actions.js). Here, not in logic/,
 * because the sentences need the names of layers, figures and categories (models/).
 */
import { $t } from '../core/i18n.js';
import { FIGURE_NAMES, LAYER_NAMES } from '../models/agenda.js';
import { CAT_NAME } from '../models/categories.js';

/**
 * What changed between two agendas, in sentences for the activity log: the name, own calendars (added, deleted,
 * renamed, recoloured), layers shown or hidden, spending categories, the number on each day, pinned records.
 * Appointments and drafts have actions of their own and are not described here. [] when nothing of these changed.
 * @returns {string[]} one sentence per change ([] when nothing changed)
 */
export function agendaChanges(before, after, plan) {
  const out = [];
  if (after.name !== before.name) {
    out.push(
      after.name ? $t('Renamed your calendar to “{0}”', after.name) : $t('Your calendar has its usual name again'),
    );
  }
  const oldCals = new Map(before.cals.map(c => [c.id, c]));
  const newIds = new Set(after.cals.map(c => c.id));
  for (const cal of after.cals) {
    const was = oldCals.get(cal.id);
    if (!was) {
      out.push($t('Added the calendar “{0}”', cal.name));
      continue;
    }
    if (was.name !== cal.name) {
      out.push($t('Renamed the calendar “{0}” to “{1}”', was.name, cal.name));
    }
    if (was.tone !== cal.tone) {
      out.push($t('Changed the colour of the calendar “{0}”', was.name));
    }
  }
  for (const cal of before.cals) {
    if (!newIds.has(cal.id)) {
      out.push($t('Deleted the calendar “{0}”', cal.name));
    }
  }
  const names = LAYER_NAMES();
  const shown = after.layers.filter(key => !before.layers.includes(key)).map(key => names[key]);
  const hidden = before.layers.filter(key => !after.layers.includes(key)).map(key => names[key]);
  if (shown.length) {
    out.push($t('Your calendar shows {0}', shown.join(', ')));
  }
  if (hidden.length) {
    out.push($t('Your calendar no longer shows {0}', hidden.join(', ')));
  }
  if (after.cats.join() !== before.cats.join()) {
    out.push(
      after.cats.length
        ? $t('Spending shown on your calendar: {0}', after.cats.map(key => CAT_NAME[key]).join(', '))
        : $t('Your calendar shows spending of every category'),
    );
  }
  if (after.figure !== before.figure) {
    out.push($t('Number on each day of your calendar: {0}', FIGURE_NAMES()[after.figure]));
  }
  const keyOf = pin => pin.list + ':' + pin.id;
  const nameOf = pin => ((plan[pin.list] || []).find(r => r.id === pin.id) || {}).name || '';
  const had = new Set(before.pins.map(keyOf));
  const has = new Set(after.pins.map(keyOf));
  for (const pin of after.pins) {
    if (!had.has(keyOf(pin))) {
      out.push($t('“{0}” is always on your calendar', nameOf(pin)));
    }
  }
  for (const pin of before.pins) {
    if (!has.has(keyOf(pin))) {
      out.push($t('“{0}” is no longer always on your calendar', nameOf(pin)));
    }
  }
  return out;
}
