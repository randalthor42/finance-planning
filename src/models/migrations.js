/**
 * @file Migrations of the stored database, and the runner that applies them. See docs/data.md.
 *
 * The database says which schema it follows: schemaVersion (and `v`, which earlier versions read). When the app
 * starts with older data, the store (state/store.js init) runs the missing migrations in order, on the data as read,
 * before it is cleaned (normDB). The text as it was is kept as a backup first (services/storage.js backup), and the
 * migrated data is written only once that copy is made.
 *
 * A migration only adds or reshapes; it never drops data. Each is idempotent: run again, it changes nothing. To add
 * one, append { to: N, name, up(db, ctx) } and raise APP.schema to N.
 */
import { APP } from '../config.js';
import { ID_RE, isObj, newId } from '../core/util.js';
import { DELETED_LISTS, PLAN_FIELDS, RECORD_LISTS, timestamp } from './records.js';

export const SCHEMA_VERSION = APP.schema;

/** The schema of stored data: schemaVersion, or `v` before schemaVersion existed. Nothing stored: the current one. */
export function versionOf(raw) {
  if (!isObj(raw)) {
    return SCHEMA_VERSION;
  }
  if (Number.isInteger(raw.schemaVersion)) {
    return raw.schemaVersion;
  }
  return Number.isInteger(raw.v) ? raw.v : 1;
}

/** Gives a record what is missing of id, createdAt, updatedAt, deletedAt (null); keeps what it has. */
function fill(r, now) {
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) {
    r.id = newId();
  }
  if (timestamp(r.createdAt) === null) {
    r.createdAt = now;
  }
  if (timestamp(r.updatedAt) === null) {
    r.updatedAt = now;
  }
  r.deletedAt = timestamp(r.deletedAt);
}

/**
 * 7: sync-ready records. Every plan and every record in it (accounts, incomes, bills, items, trips and their costs,
 * loans, goals, wishes) gets id (a UUID when missing), createdAt, updatedAt (now, when unknown) and deletedAt: null;
 * each plan gets its empty `deleted` lists and the database `deletedPlans`.
 */
function recordMetadata(db, { now }) {
  for (const plan of Object.values(isObj(db.plans) ? db.plans : {})) {
    if (!isObj(plan)) {
      continue;
    }
    fill(plan, now);
    for (const list of RECORD_LISTS) {
      for (const r of Array.isArray(plan[list]) ? plan[list] : []) {
        if (!isObj(r)) {
          continue;
        }
        fill(r, now);
        if (list === 'trips') {
          (Array.isArray(r.items) ? r.items : []).filter(isObj).forEach(i => fill(i, now));
        }
      }
    }
    const deleted = isObj(plan.deleted) ? plan.deleted : {};
    plan.deleted = Object.fromEntries(DELETED_LISTS.map(l => [l, Array.isArray(deleted[l]) ? deleted[l] : []]));
  }
  db.deletedPlans = isObj(db.deletedPlans) ? db.deletedPlans : {};
}

/**
 * 8: each plan's own fields (name, settings, fixes, overrides, reserveOver, paid, notes) get the time they last
 * changed, `fieldsUpdatedAt`, so that merging devices can take each field from the side that changed it last. Unknown
 * until now: the plan's updatedAt. Times already there are kept.
 */
function fieldTimes(db, { now }) {
  for (const plan of Object.values(isObj(db.plans) ? db.plans : {})) {
    if (!isObj(plan)) {
      continue;
    }
    const at = timestamp(plan.updatedAt) ?? now;
    const times = isObj(plan.fieldsUpdatedAt) ? plan.fieldsUpdatedAt : {};
    plan.fieldsUpdatedAt = Object.fromEntries(PLAN_FIELDS.map(f => [f, timestamp(times[f]) ?? at]));
  }
}

/** Every migration, by the schema it brings the data to. */
export const MIGRATIONS = [
  { to: 7, name: 'Sync-ready records: id, createdAt, updatedAt and deletedAt on every record', up: recordMetadata },
  { to: 8, name: 'The time each of a plan’s own fields last changed', up: fieldTimes },
];

/**
 * Runs the migrations the data needs, in order (raw is changed in place and returned as db). Data from a newer
 * version is left alone.
 * @param {Object|null} raw the database as stored (parsed JSON)
 * @param {Object} options now (epoch ms, required when anything is migrated), migrations and target (tests)
 * @returns {{db:Object|null, from:number, to:number, applied:string[]}}
 */
export function migrate(raw, { now, migrations = MIGRATIONS, target = SCHEMA_VERSION } = {}) {
  const from = versionOf(raw);
  const applied = [];
  if (!isObj(raw) || from >= target) {
    return { db: raw, from, to: from, applied };
  }
  if (!Number.isFinite(now)) {
    throw new Error('migrate needs the time to date records with (options.now)');
  }
  const steps = migrations.filter(m => m.to > from && m.to <= target).sort((a, b) => a.to - b.to);
  for (const m of steps) {
    m.up(raw, { now });
    raw.schemaVersion = m.to;
    raw.v = m.to;
    applied.push(m.name);
  }
  return { db: raw, from, to: raw.schemaVersion ?? from, applied };
}
