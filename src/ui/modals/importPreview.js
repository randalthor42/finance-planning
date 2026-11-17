/**
 * @file What an import would change, before it changes anything: a backup file or a QR transfer. Merge (record by
 * record, models/recordMerge.js, the same rules as Drive sync) or add the plans as separate copies, as imports always
 * did. Nothing happens on Cancel.
 */
import { APP } from '../../config.js';
import { $t, plural } from '../../core/i18n.js';
import { mergeData } from '../../models/recordMerge.js';
import { normDB } from '../../models/db.js';
import { normPlan } from '../../models/plan.js';
import { backup } from '../../services/storage.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { chip } from '../components/layout.js';
import { modal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';
import { UI } from '../state.js';

/** What one plan's line says: a chip and a detail. */
function describe(s) {
  if (s.status === 'new') {
    return [chip($t('New plan'), 'acc'), $t('Added to your plans')];
  }
  if (s.status === 'deleted') {
    return [chip($t('Deleted'), 'bad'), $t('Deleted on the other device after its last change here')];
  }
  if (s.status === 'same') {
    return [chip($t('No changes'), ''), $t('Everything in it is already here')];
  }
  const parts = [
    s.added ? $t('{0} added', s.added) : '',
    s.updated ? $t('{0} changed', s.updated) : '',
    s.deleted ? $t('{0} deleted', s.deleted) : '',
  ].filter(Boolean);
  return [chip($t('Updated'), 'good'), parts.join(' · ') || $t('Small changes (ticks, notes or settings)')];
}

/** Adds the plans as new plans next to the ones here (a copy of each; nothing here changes). */
export function addCopies(plans) {
  let first = null;
  let n = 0;
  for (const p of plans) {
    const c = Store.addPlan({ ...p, id: null }, false);
    if (c) {
      n++;
      first = first || c;
    }
  }
  if (first) {
    Store.switchTo(first.id);
    UI.month = null;
    toast($t('Imported {0}. Your other plans were not changed.', plural(n, 'plan')));
  } else {
    toast($t('Nothing imported: plan limit reached'), { kind: 'bad' });
  }
}

/**
 * Merges what was read into this device's plans: a backup of the data here is kept first (services/storage.js).
 * @returns {boolean} false when the result would have too many plans
 */
export function mergeImport(merged) {
  if (merged.plans.length > APP.maxPlans) {
    toast($t('Not merged: that would make more than {0} plans.', APP.maxPlans), { kind: 'bad' });
    return false;
  }
  backup(Store.dbText(), { from: APP.schema, to: APP.schema, reason: 'before merging an import' }).catch(() => {});
  const changed = merged.summary.filter(s => s.status !== 'same').length;
  Store.adoptMerged(merged.plans, merged.deletedPlans, $t('Merged an import into {0}', plural(changed, 'plan')));
  UI.month = null;
  toast($t('Merged. A copy of your data as it was is kept in this browser.'));
  return true;
}

/**
 * Shows what importing would do. read: what IO.read gave ({ plans, deletedPlans }); from: where it came from, for
 * the title ('file' | 'qr').
 */
export function importPreview(read, from = 'file') {
  const plans = read.plans.map(p => normPlan(p));
  // deleted plans are checked exactly as Drive sync checks them (ids, dates, how many): a damaged or made-up file
  // cannot delete a plan here with a stub that is not a real deletion
  const incoming = { plans, deletedPlans: normDB({ plans: {}, deletedPlans: read.deletedPlans }).deletedPlans };
  /** The merge with the plans here as they are at that moment (a sync may change them while the preview is open). */
  const mergeNow = () =>
    mergeData({ plans: Store.planList().map(p => p.plan), deletedPlans: Store.db.deletedPlans }, incoming);
  const merged = mergeNow();
  const lines = merged.summary.map(s => {
    const [badge, detail] = describe(s);
    return h(
      'div',
      { class: 'row', 'data-merge': s.status },
      h('div', { class: 'grow' }, h('div', { class: 't', text: s.name }), h('div', { class: 'd', text: detail })),
      badge,
    );
  });
  const d = modal({
    title: from === 'qr' ? $t('Received from the other device') : $t('Import this backup?'),
    body: [
      h('p', {
        class: 'muted',
        text: $t(
          'Merge keeps the newest version of every entry from both sides: entries only here stay, entries only there are added. Or add its plans as separate copies and change nothing here.',
        ),
      }),
      h('div', { class: 'rows', 'data-import-preview': '' }, lines),
      merged.localChanged
        ? null
        : h('p', {
            class: 'small muted',
            style: 'margin-top:10px',
            text: $t('Merging changes nothing: you have all of it.'),
          }),
    ],
    foot: [
      h('span', { class: 'sp' }),
      btn($t('Cancel'), () => d.close(), 'ghost'),
      btn(
        $t('Add as separate copies'),
        () => {
          d.close();
          addCopies(plans);
        },
        '',
      ),
      h('button', {
        type: 'button',
        class: 'btn primary',
        text: $t('Merge'),
        disabled: !merged.localChanged,
        onclick: () => {
          if (mergeImport(mergeNow())) {
            d.close();
          }
        },
      }),
    ],
  });
  return d;
}
