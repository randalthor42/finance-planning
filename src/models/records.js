/**
 * @file Records and their sync metadata.
 *
 * A record is one thing a person adds to a plan, with an id: an account, income, bill, item (transaction), trip, trip
 * cost, loan, goal or wish. The plan itself is a record too. Every record carries:
 *   id          its id (the app's short ids, or a UUID for a record that arrived without one: core/util.js newId)
 *   createdAt   when it was first saved (epoch ms)
 *   updatedAt   when it was last saved with a change (epoch ms)
 *   deletedAt   when it was deleted (epoch ms), or null
 * A deleted record is not removed: it moves to the plan's `deleted` lists (trip costs with their tripId), so lists,
 * totals, charts and the projection, which read the live lists, never see it, and a future sync can still pass the
 * deletion on. The rest of a plan (settings, ticks, corrections, notes, overrides) is part of the plan record.
 *
 * These dates are set in one place: stampPlan, called by the store (state/store.js) on every save. No component sets
 * them, so none can forget them.
 */

/** The plan's lists of records. Trip costs are records inside their trip (`trips[].items`). */
export const RECORD_LISTS = ['accounts', 'incomes', 'bills', 'items', 'trips', 'loans', 'goals', 'wishes'];
/** The lists of deleted records (`plan.deleted`): one per list, and trip costs. */
export const DELETED_LISTS = [...RECORD_LISTS, 'tripItems'];
/** The type of each list's records, as the IndexedDB record index names them. */
export const RECORD_TYPE = {
  accounts: 'account',
  incomes: 'income',
  bills: 'bill',
  items: 'item',
  trips: 'trip',
  loans: 'loan',
  goals: 'goal',
  wishes: 'wish',
  tripItems: 'tripItem',
};
export const META = ['createdAt', 'updatedAt', 'deletedAt'];
/**
 * Deleted records kept per kind, the most recently deleted: the newest DELETED_FULL in full, the older ones, up to
 * DELETED_MAX, as small markers (id and dates only: deletedRef). A marker is enough to keep a deletion from being
 * undone by a device that still has the record; without it, a record whose deletion fell off the list would come back
 * from such a device. The limit is the size of the purchase log (APP.maxItems), the longest list.
 */
export const DELETED_FULL = 500;
export const DELETED_MAX = 5000;
/** The marker of a deleted record: its id and dates (and the trip of a trip cost). */
export const deletedRef = r => {
  const out = { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, deletedAt: r.deletedAt };
  if (r.tripId !== undefined) {
    out.tripId = r.tripId;
  }
  return out;
};
/** Order of deleted records: by deletion time, then by id (the same on every device). */
export function byDeletion(a, b) {
  if (a.deletedAt !== b.deletedAt) {
    return a.deletedAt - b.deletedAt;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? -1 : 1;
}
/** Whether a deleted record is only a marker (deletedRef). */
export const isDeletedRef = r =>
  Object.keys(r).every(
    k => k === 'id' || k === 'tripId' || k === 'createdAt' || k === 'updatedAt' || k === 'deletedAt',
  );
/**
 * The deleted records to keep, oldest first: the newest DELETED_MAX, of which the older ones become markers. Ordered
 * by deletion time, then id, so that every device cuts the list at the same place.
 */
export function keepDeleted(list) {
  const sorted = list.slice().sort(byDeletion).slice(-DELETED_MAX);
  const firstFull = sorted.length - DELETED_FULL;
  return sorted.map((r, i) => (i < firstFull && !isDeletedRef(r) ? deletedRef(r) : r));
}
/**
 * The plan's own fields that are not records: a change there is a change of the plan record. Each has the time it
 * last changed (plan.fieldsUpdatedAt), so merging two devices keeps a tick made on one and a note made on the other.
 */
export const PLAN_FIELDS = ['name', 'settings', 'fixes', 'overrides', 'reserveOver', 'paid', 'notes'];

/**
 * The plan fields that are maps by budget month, and how deep each goes: 1 = one value per month (a correction, a
 * note), 2 = one value per month and line key (a tick, an override, a reserve choice). Two devices can change
 * different months or lines of one of them, so each month or line has its own change time (plan.keysUpdatedAt):
 * a tick made on one device and a tick made on the other are both kept.
 */
export const MAP_FIELDS = { fixes: 1, notes: 1, overrides: 2, reserveOver: 2, paid: 2 };
/** Between the month and the line key in a path ("2026-01 bill:ab12"): neither ever contains a space. */
const PATH_SEP = ' ';

/**
 * A month map as one flat map: path → value. Depth 1: "2026-01" → value; depth 2: "2026-01 bill:ab12" → value.
 * @param {Object} map @param {number} depth @returns {Object<string,*>}
 */
export function flatPaths(map, depth) {
  const out = {};
  for (const [month, value] of Object.entries(isObject(map) ? map : {})) {
    if (depth === 1) {
      out[month] = value;
      continue;
    }
    for (const [key, inner] of Object.entries(isObject(value) ? value : {})) {
      out[month + PATH_SEP + key] = inner;
    }
  }
  return out;
}
/** The month map back from flatPaths (paths in sorted order, as normPlan sorts its keys). */
export function unflatPaths(flat, depth) {
  const out = {};
  for (const path of Object.keys(flat).sort()) {
    if (depth === 1) {
      out[path] = flat[path];
      continue;
    }
    const [month, key] = path.split(PATH_SEP);
    out[month] = out[month] || {};
    out[month][key] = flat[path];
  }
  return out;
}
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
/**
 * The change times of the month-map fields, cleaned: field → { base, at }. `at` holds the time a path last changed
 * (set, changed or removed); `base` is the time of every path not in `at` (the field's time when this tracking began).
 * @param {*} raw @returns {Object<string,{base:number, at:Object<string,number>}>}
 */
export function normKeyTimes(raw) {
  const out = {};
  for (const f of Object.keys(MAP_FIELDS)) {
    const entry = isObject(raw) ? raw[f] : null;
    const base = isObject(entry) ? timestamp(entry.base) : null;
    if (base === null) {
      continue;
    }
    const at = {};
    for (const [path, time] of Object.entries(isObject(entry.at) ? entry.at : {})) {
      if (path.length <= 100 && timestamp(time) !== null) {
        at[path] = timestamp(time);
      }
    }
    out[f] = { base, at };
  }
  return out;
}
/**
 * The change times of one month-map field after a save: the paths whose value differs from before get `now`; the
 * others keep their time. Before this tracking existed, the whole field had one time: it becomes the base.
 */
function stampKeys(prev, next, f, now) {
  const before = prev.keysUpdatedAt && prev.keysUpdatedAt[f];
  const base = before ? before.base : (timestamp(prev.fieldsUpdatedAt && prev.fieldsUpdatedAt[f]) ?? now);
  const at = before ? { ...before.at } : {};
  if (JSON.stringify(prev[f]) !== JSON.stringify(next[f])) {
    const depth = MAP_FIELDS[f];
    const old = flatPaths(prev[f], depth);
    const after = flatPaths(next[f], depth);
    for (const path of new Set([...Object.keys(old), ...Object.keys(after)])) {
      if (JSON.stringify(old[path]) !== JSON.stringify(after[path])) {
        at[path] = now;
      }
    }
  }
  return { base, at };
}

/** A date as stored: epoch ms (a whole number from 1970 to the year 5138), or null. */
export const timestamp = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e14 ? Math.round(v) : null);

/** The same data, whatever the dates: deep equality that skips createdAt, updatedAt and deletedAt at every level. */
export function sameRecord(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!sameRecord(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(b)) {
    return false;
  }
  let n = 0;
  for (const k in a) {
    if (META.includes(k)) {
      continue;
    }
    n++;
    if (!Object.prototype.hasOwnProperty.call(b, k) || !sameRecord(a[k], b[k])) {
      return false;
    }
  }
  for (const k in b) {
    if (!META.includes(k)) {
      n--;
    }
  }
  return n === 0;
}

/**
 * Sets the dates of a plan being saved. prev: the plan as saved before (null for a new or imported plan); next: the
 * plan to save, cleaned by normPlan (it is changed in place and returned). now: epoch ms.
 * - a record like before (dates aside) keeps its dates;
 * - a changed record gets updatedAt = now;
 * - a new record gets createdAt = updatedAt = now (a new or imported plan keeps the dates its records have);
 * - a record that is no longer there is kept in `deleted` with deletedAt = updatedAt = now;
 * - a deleted record that is back (undo) is live again with updatedAt = now;
 * - the plan gets updatedAt = now when anything in it changed.
 * @returns {{plan:Object, changed:boolean, touched:[string, Object][]}} changed: anything at all changed;
 *   touched: the records saved with new dates, as [list, record] (the IndexedDB record index follows them)
 */
export function stampPlan(prev, next, now) {
  let changed = !prev;
  const touched = [];
  const fresh = (r, kept) => {
    if (prev) {
      r.createdAt = now;
      r.updatedAt = now;
    } else {
      r.createdAt = timestamp(kept.createdAt) ?? now;
      r.updatedAt = timestamp(kept.updatedAt) ?? now;
    }
    r.deletedAt = null;
  };
  /** One record of the list: like before, changed, back from the deleted ones, or new. */
  const stamp = (list, r, before, deletedBefore) => {
    if (before && sameRecord(r, before)) {
      r.createdAt = before.createdAt;
      r.updatedAt = before.updatedAt;
      r.deletedAt = null;
      return;
    }
    changed = true;
    touched.push([list, r]);
    const was = before || deletedBefore;
    if (was) {
      r.createdAt = was.createdAt ?? now;
      r.updatedAt = now;
      r.deletedAt = null;
    } else {
      fresh(r, r);
    }
  };
  const byId = list => new Map((list || []).map(r => [r.id, r]));
  // trip costs, deleted with their trip id
  const tripItemsDeleted = byId(prev && prev.deleted.tripItems);
  const tripItemsDead = byId(next.deleted.tripItems);
  for (const [id, r] of tripItemsDeleted) {
    if (!tripItemsDead.has(id)) {
      tripItemsDead.set(id, r);
    }
  }
  for (const list of RECORD_LISTS) {
    const before = byId(prev && prev[list]);
    const deletedBefore = byId(prev && prev.deleted[list]);
    const dead = byId(next.deleted[list]);
    for (const [id, r] of deletedBefore) {
      if (!dead.has(id)) {
        dead.set(id, r); // a deletion is never forgotten (an older snapshot, as undo restores, may not have it)
      }
    }
    const live = new Set();
    for (const r of next[list]) {
      live.add(r.id);
      const old = before.get(r.id);
      if (list === 'trips') {
        const oldItems = byId(old && old.items);
        const liveItems = new Set();
        for (const i of r.items) {
          liveItems.add(i.id);
          const was = oldItems.get(i.id);
          if (was && sameRecord(i, was)) {
            i.createdAt = was.createdAt;
            i.updatedAt = was.updatedAt;
            i.deletedAt = null;
          } else {
            changed = true;
            touched.push(['tripItems', { ...i, tripId: r.id }]);
            const back = was || tripItemsDead.get(i.id);
            if (back) {
              i.createdAt = back.createdAt ?? now;
              i.updatedAt = now;
              i.deletedAt = null;
            } else {
              fresh(i, i);
            }
          }
          tripItemsDead.delete(i.id);
        }
        if (old) {
          for (const i of old.items) {
            if (!liveItems.has(i.id)) {
              const gone = { ...i, createdAt: i.createdAt ?? now, updatedAt: now, deletedAt: now, tripId: r.id };
              tripItemsDead.set(i.id, gone);
              touched.push(['tripItems', gone]);
              changed = true;
            }
          }
        }
      }
      stamp(list, r, old, deletedBefore.get(r.id) || dead.get(r.id));
      dead.delete(r.id);
    }
    for (const old of before.values()) {
      if (!live.has(old.id)) {
        const gone = { ...old, createdAt: old.createdAt ?? now, updatedAt: now, deletedAt: now };
        dead.set(old.id, gone);
        touched.push([list, gone]);
        changed = true;
      }
    }
    next.deleted[list] = keepDeleted([...dead.values()]);
  }
  next.deleted.tripItems = keepDeleted([...tripItemsDead.values()]);
  // the plan's own fields, each with the time it last changed
  const times = {};
  for (const f of PLAN_FIELDS) {
    const kept = next.fieldsUpdatedAt && timestamp(next.fieldsUpdatedAt[f]);
    if (!prev) {
      times[f] = kept ?? now;
    } else if (JSON.stringify(next[f]) !== JSON.stringify(prev[f])) {
      times[f] = now;
      changed = true;
    } else {
      times[f] = (prev.fieldsUpdatedAt && prev.fieldsUpdatedAt[f]) ?? now;
    }
  }
  next.fieldsUpdatedAt = times;
  // the month-map fields: the time of each month or line (see MAP_FIELDS)
  const keyTimes = {};
  for (const f of Object.keys(MAP_FIELDS)) {
    if (prev) {
      keyTimes[f] = stampKeys(prev, next, f, now);
    } else {
      const kept = normKeyTimes(next.keysUpdatedAt)[f];
      keyTimes[f] = kept || { base: times[f], at: {} };
    }
  }
  next.keysUpdatedAt = keyTimes;
  next.createdAt = prev ? (prev.createdAt ?? now) : (timestamp(next.createdAt) ?? now);
  next.updatedAt = !prev ? (timestamp(next.updatedAt) ?? now) : changed ? now : prev.updatedAt;
  next.deletedAt = null;
  return { plan: next, changed, touched };
}

/* --- the record index (services/storage.js records): one entry per record --- */

/** One record as the IndexedDB record index keeps it: keyed "<planId>/<type>/<id>", its dates at the top. */
export const recordEntry = (planId, type, record) => ({
  key: `${planId}/${type}/${record.id}`,
  planId,
  type,
  id: record.id,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  deletedAt: record.deletedAt ?? null,
  data: record,
});
/** The plan record itself: the plan without its lists of records (those are records of their own). */
export function planRecord(plan) {
  const out = {};
  for (const k of Object.keys(plan)) {
    if (!RECORD_LISTS.includes(k) && k !== 'deleted') {
      out[k] = plan[k];
    }
  }
  return out;
}
/**
 * Every record of a plan, live and deleted, and the plan: what the index holds for it, made one at a time (a long
 * plan is indexed in small parts, see services/storage.js records.rebuild).
 */
export function* planEntriesOf(plan) {
  yield recordEntry(plan.id, 'plan', planRecord(plan));
  for (const list of RECORD_LISTS) {
    for (const r of plan[list]) {
      yield recordEntry(plan.id, RECORD_TYPE[list], r);
      if (list === 'trips') {
        for (const i of r.items) {
          yield recordEntry(plan.id, 'tripItem', { ...i, tripId: r.id });
        }
      }
    }
  }
  for (const list of DELETED_LISTS) {
    for (const r of (plan.deleted && plan.deleted[list]) || []) {
      yield recordEntry(plan.id, RECORD_TYPE[list], r);
    }
  }
}
/** The same, as a list. */
export const planEntries = plan => [...planEntriesOf(plan)];
