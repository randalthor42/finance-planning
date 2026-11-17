/**
 * @file The data file: the one JSON file, chosen by the person, where their plans are kept (state/fileSync.js).
 *
 *   { "app": "runway", "kind": "data", "v": 8, "saved": "2026-11-16T10:00:00.000Z", "by": "k3j4h5g6",
 *     "deletedPlans": { "planId": { id, createdAt, updatedAt, deletedAt } }, "plans": [ {plan}, {plan} ] }
 *
 * "by" is a random name of the browser that saved it (so a device can tell its own saves from another's); it says
 * nothing about the person. Every record carries its dates, and "deletedPlans" the plans deleted: with them, devices
 * merge their changes record by record (models/recordMerge.js), like Drive sync. The shape is a backup's with another
 * kind, so "Import backup" opens it too, and an
 * exported backup can be chosen as the data file. Browser preferences (theme, layouts, calendar) and the activity log
 * stay in each browser: they are not plan data.
 */
import { APP } from '../config.js';
import { $t } from '../core/i18n.js';
import { isObj, uid } from '../core/util.js';
import { normDB } from './db.js';
import { normPlan } from './plan.js';

/**
 * The file's text from the plans' JSON texts. The texts are joined as they are (the store keeps each plan's text), so
 * saving does not serialise plans that did not change. One plan per line keeps the file readable and easy to diff.
 */
export function encodeDataFile(texts, meta = {}) {
  const head = JSON.stringify({
    app: 'runway',
    kind: 'data',
    v: APP.schema,
    saved: meta.saved || new Date().toISOString(),
    by: meta.by || '',
    deletedPlans: meta.deletedPlans || {},
  });
  return head.slice(0, -1) + ',"plans":[' + (texts.length ? '\n' + texts.join(',\n') + '\n' : '') + ']}\n';
}

/**
 * Reads a data file (or a plain backup). Every plan passes through normPlan; each comes back with its clean text.
 * Throws an Error with a readable message when the text is not Runway data.
 * @returns {{kind:string, saved:string, by:string, list:{id:string, plan:Object, text:string}[], deletedPlans:Object}}
 *   deletedPlans: cleaned like the database's (normDB)
 */
export function decodeDataFile(text) {
  let file;
  try {
    file = JSON.parse(text);
  } catch (e) {
    throw new Error($t('This file is not a Runway data file (it is not JSON).'));
  }
  if (!isObj(file) || file.app !== 'runway') {
    throw new Error($t('This file was not made by ') + APP.name + '.');
  }
  if (file.kind === 'encrypted') {
    throw new Error(
      $t('This backup is encrypted, so it cannot be the data file. Import it in Settings › Backup instead.'),
    );
  }
  if ((file.kind !== 'data' && file.kind !== 'backup') || !Array.isArray(file.plans)) {
    throw new Error($t('This file has no plans in it.'));
  }
  if (+file.v > APP.schema) {
    throw new Error($t('This file was saved by a newer version of ') + APP.name + '.');
  }
  const seen = new Set();
  const list = [];
  for (const raw of file.plans.filter(isObj).slice(0, APP.maxPlans)) {
    const plan = normPlan(raw);
    while (seen.has(plan.id)) {
      plan.id = uid();
    }
    seen.add(plan.id);
    list.push({ id: plan.id, plan, text: JSON.stringify(plan) });
  }
  const str = v => (typeof v === 'string' ? v.slice(0, 40) : '');
  const deletedPlans = normDB({ plans: {}, deletedPlans: file.deletedPlans }).deletedPlans;
  return { kind: file.kind, saved: str(file.saved), by: str(file.by), list, deletedPlans };
}
