/**
 * @file Merging two copies of the data record by record: this device's ("local") and another's ("remote": the Drive
 * file, a QR transfer, an imported backup). Pure. Used by Drive sync (state/driveSync.js) and the import preview.
 *
 * Rules (see docs/sync.md):
 * - Per record id, the version with the newer updatedAt wins. A deleted record (deletedAt) is a version like any
 *   other, so a deletion made after an edit wins, and an edit made after a deletion brings the record back.
 * - The same updatedAt with different content (an old backup's undated records): a deletion wins, then the version
 *   whose JSON sorts last, so that every device makes the same choice.
 * - A plan's own fields (name, settings) merge one by one, each by the time it last changed (plan.fieldsUpdatedAt).
 *   The month maps (ticks, corrections, overrides, reserve choices, notes) merge month by month and line by line, by
 *   plan.keysUpdatedAt: a tick made on one device and a tick made on the other are both kept.
 * - A trip's own fields come from its winning version; its costs merge one by one, like any record.
 * - A deleted plan (db.deletedPlans) wins over the plan if it is at least as new as the plan's last change.
 * - A record without dates (an old backup) counts as the oldest: a dated version always wins over it.
 * - Order: the remote copy's order first, then what only this device has, so both devices end with the same data.
 */
import {
  DELETED_LISTS,
  MAP_FIELDS,
  PLAN_FIELDS,
  RECORD_LISTS,
  flatPaths,
  keepDeleted,
  timestamp,
  unflatPaths,
} from './records.js';

/** The date of a record or plan without one (an old backup): older than anything dated. */
const LEGACY = 1;
const when = r => timestamp(r.updatedAt) ?? 0;
const dead = r => r.deletedAt !== null && r.deletedAt !== undefined;
/** Same version: same date, same state and same content. */
const same = (a, b) =>
  !!a && !!b && when(a) === when(b) && dead(a) === dead(b) && JSON.stringify(a) === JSON.stringify(b);
/** 'local' or 'remote': which version of one record wins. */
function winner(l, r) {
  if (!l) {
    return 'remote';
  }
  if (!r) {
    return 'local';
  }
  if (when(l) !== when(r)) {
    return when(l) > when(r) ? 'local' : 'remote';
  }
  if (dead(l) !== dead(r)) {
    return dead(l) ? 'local' : 'remote';
  }
  // same time, same state: if the content still differs (an old backup's undated records, two clocks agreeing to the
  // millisecond), both devices must pick the same one, so the content itself decides
  return tieBreak(l, r);
}
/** Of two versions with the same time, the same pick on every device: the one whose JSON sorts last. */
function tieBreak(l, r) {
  const lt = JSON.stringify(l);
  const rt = JSON.stringify(r);
  return lt >= rt ? 'local' : 'remote';
}
/** A record without dates gets the oldest date, so it is dated from now on. */
const dated = r =>
  timestamp(r.createdAt) === null || timestamp(r.updatedAt) === null
    ? { ...r, createdAt: timestamp(r.createdAt) ?? LEGACY, updatedAt: timestamp(r.updatedAt) ?? LEGACY }
    : r;

/** One kind of records: live and deleted versions of both sides. */
function mergeList(liveL, deadL, liveR, deadR, count) {
  const byId = list => new Map((list || []).map(r => [r.id, r]));
  const l = byId(liveL);
  const ld = byId(deadL);
  const r = byId(liveR);
  const rd = byId(deadR);
  const ids = new Set([...r.keys(), ...l.keys(), ...rd.keys(), ...ld.keys()]);
  const live = [];
  const gone = [];
  let local = false;
  let remote = false;
  for (const id of ids) {
    const a = l.get(id) || ld.get(id);
    const b = r.get(id) || rd.get(id);
    const side = winner(a, b);
    let w = side === 'local' ? a : b;
    if (!same(a, b)) {
      if (side === 'remote') {
        local = true;
        if (count) {
          if (!a || (dead(a) && !dead(b))) {
            count.added += dead(b) ? 0 : 1;
          } else if (!dead(a) && dead(b)) {
            count.deleted++;
          } else if (!dead(b)) {
            count.updated++;
          }
        }
      } else {
        remote = true;
      }
    }
    const withDates = dated(w);
    if (withDates !== w) {
      local = local || side === 'local';
      remote = remote || side === 'remote';
      w = withDates;
    }
    (dead(w) ? gone : live).push(w);
  }
  return { live, gone: keepDeleted(gone), local, remote };
}

/**
 * One side of a month-map field: its values by path, the time of each path it tracks, and the time of the others.
 * A side without per-path times (data from before them, an old backup) gives every path the field's time; so does a
 * side whose field changed after its last tracked change (written by a version that knows only field times).
 */
function mapSide(plan, f) {
  const tracked = plan.keysUpdatedAt && plan.keysUpdatedAt[f];
  const fieldTime = timestamp(plan.fieldsUpdatedAt && plan.fieldsUpdatedAt[f]) ?? LEGACY;
  const values = flatPaths(plan[f], MAP_FIELDS[f]);
  if (tracked) {
    const base = timestamp(tracked.base) ?? LEGACY;
    const lastTracked = Math.max(base, ...Object.values(tracked.at));
    if (fieldTime <= lastTracked) {
      return { values, at: tracked.at, base };
    }
  }
  return { values, at: {}, base: fieldTime };
}
/**
 * A month-map field, path by path (a month, or a month and line): the side that changed a path last wins it, a path
 * removed later than it was set stays removed. The same on both devices: equal times are settled by the content.
 * @returns {{value:Object, times:{base:number, at:Object<string,number>}}}
 */
function mergeMap(L, R, f) {
  const l = mapSide(L, f);
  const r = mapSide(R, f);
  const base = Math.min(l.base, r.base);
  const values = {};
  const at = {};
  const paths = new Set([
    ...Object.keys(l.values),
    ...Object.keys(r.values),
    ...Object.keys(l.at),
    ...Object.keys(r.at),
  ]);
  for (const path of [...paths].sort()) {
    const tl = l.at[path] ?? l.base;
    const tr = r.at[path] ?? r.base;
    const lv = l.values[path];
    const rv = r.values[path];
    let take = tl > tr ? lv : rv;
    if (tl === tr) {
      take = tieBreak(lv === undefined ? null : lv, rv === undefined ? null : rv) === 'local' ? lv : rv;
    }
    if (take !== undefined) {
      values[path] = take;
    }
    const time = Math.max(tl, tr);
    if (time > base) {
      at[path] = time;
    }
  }
  return { value: unflatPaths(values, MAP_FIELDS[f]), times: { base, at } };
}

/**
 * The costs of each trip that both sides have, merged cost by cost (newer updatedAt wins, deletions travel). The
 * order is the winning trip's, then costs it lacks by id: the same on every device.
 * @returns {{trips: object[], local: boolean, remote: boolean}}
 */
function mergeTripCosts(L, R, trips) {
  const left = new Map(L.trips.map(t => [t.id, t]));
  const right = new Map(R.trips.map(t => [t.id, t]));
  const of = (list, tripId) => (list || []).filter(i => i.tripId === tripId);
  let local = false;
  let remote = false;
  const out = trips.map(trip => {
    const lt = left.get(trip.id);
    const rt = right.get(trip.id);
    if (!lt || !rt) {
      return trip;
    }
    const m = mergeList(lt.items, of(L.deleted.tripItems, trip.id), rt.items, of(R.deleted.tripItems, trip.id), null);
    const live = new Map(m.live.map(i => [i.id, i]));
    const order = trip.items.map(i => i.id).filter(id => live.has(id));
    const rest = [...live.keys()].filter(id => !order.includes(id)).sort();
    const items = [...order, ...rest].map(id => live.get(id));
    const text = JSON.stringify(items);
    local = local || text !== JSON.stringify(lt.items);
    remote = remote || text !== JSON.stringify(rt.items);
    return { ...trip, items };
  });
  return { trips: out, local, remote };
}

/** Both sides have the plan: records, deleted records, own fields. */
function mergePlan(L, R) {
  const count = { added: 0, updated: 0, deleted: 0 };
  const out = { ...L };
  out.deleted = {};
  let local = false;
  let remote = false;
  for (const list of RECORD_LISTS) {
    const m = mergeList(L[list], L.deleted[list], R[list], R.deleted[list], count);
    out[list] = m.live;
    out.deleted[list] = m.gone;
    local = local || m.local;
    remote = remote || m.remote;
  }
  // a trip on both sides: its costs merge one by one like any record (an edit of the trip on one device does not
  // bring back a cost deleted on the other)
  const tripCosts = mergeTripCosts(L, R, out.trips);
  out.trips = tripCosts.trips;
  local = local || tripCosts.local;
  remote = remote || tripCosts.remote;
  // deleted trip costs: a cost live in its (winning) trip is not deleted
  const liveCosts = new Set(out.trips.flatMap(t => t.items.map(i => i.id)));
  const costs = mergeList([], L.deleted.tripItems, [], R.deleted.tripItems, null);
  out.deleted.tripItems = costs.gone.filter(i => !liveCosts.has(i.id));
  const keptCosts = (list = []) => list.filter(i => !liveCosts.has(i.id)).length;
  if (out.deleted.tripItems.length !== keptCosts(L.deleted.tripItems) || costs.local) {
    local = true;
  }
  if (out.deleted.tripItems.length !== keptCosts(R.deleted.tripItems) || costs.remote) {
    remote = true;
  }
  out.deleted = Object.fromEntries(DELETED_LISTS.map(k => [k, out.deleted[k]]));
  // the plan's own fields, one by one; the month maps (ticks, corrections, overrides, notes) month by month
  const times = {};
  const keyTimes = {};
  for (const f of PLAN_FIELDS) {
    const tl = timestamp(L.fieldsUpdatedAt && L.fieldsUpdatedAt[f]) ?? 0;
    const tr = timestamp(R.fieldsUpdatedAt && R.fieldsUpdatedAt[f]) ?? 0;
    if (MAP_FIELDS[f]) {
      const m = mergeMap(L, R, f);
      out[f] = m.value;
      keyTimes[f] = m.times;
      times[f] = Math.max(tl, tr) || LEGACY;
      const changedHere = JSON.stringify(m.value) !== JSON.stringify(L[f]);
      local = local || changedHere || JSON.stringify(m.times) !== JSON.stringify(L.keysUpdatedAt && L.keysUpdatedAt[f]);
      remote =
        remote ||
        JSON.stringify(m.value) !== JSON.stringify(R[f]) ||
        JSON.stringify(m.times) !== JSON.stringify(R.keysUpdatedAt && R.keysUpdatedAt[f]);
      continue;
    }
    const tie = tl === tr && JSON.stringify(L[f]) !== JSON.stringify(R[f]);
    if (tr > tl || (tie && tieBreak(L[f], R[f]) === 'remote')) {
      out[f] = R[f];
      times[f] = tr;
      local = true;
      if (JSON.stringify(L[f]) !== JSON.stringify(R[f])) {
        count.updated += f === 'name' || f === 'settings' ? 1 : 0;
      }
    } else {
      times[f] = tl || LEGACY;
      remote = remote || tl > tr || tie;
    }
  }
  out.fieldsUpdatedAt = times;
  out.keysUpdatedAt = Object.fromEntries(Object.keys(MAP_FIELDS).map(f => [f, keyTimes[f]]));
  out.createdAt = Math.min(timestamp(L.createdAt) ?? Infinity, timestamp(R.createdAt) ?? Infinity);
  if (out.createdAt === Infinity) {
    out.createdAt = LEGACY;
  }
  out.updatedAt = Math.max(when(L), when(R)) || LEGACY;
  out.deletedAt = null;
  return { plan: local ? out : L, local, remote, count };
}

/**
 * Merges two copies. local and remote: { plans: {id: plan} or [plan], deletedPlans: {id: stub} }, plans cleaned by
 * normPlan.
 * @returns {{plans:Object[], deletedPlans:Object, localChanged:boolean, remoteChanged:boolean,
 *   summary:{id:string, name:string, status:'same'|'merged'|'new'|'deleted', added:number, updated:number,
 *   deleted:number}[]}} plans: the merged plans (a plan unchanged here is this device's own object);
 *   localChanged/remoteChanged: this device / the other copy lacks something of the result (the order aside);
 *   summary: what the merge changes here, plan by plan (the import preview shows it).
 */
export function mergeData(local, remote) {
  const toMap = x => (Array.isArray(x) ? Object.fromEntries(x.map(p => [p.id, p])) : x || {});
  const lp = toMap(local.plans);
  const rp = toMap(remote.plans);
  const ld = local.deletedPlans || {};
  const rd = remote.deletedPlans || {};
  const ids = new Set([...Object.keys(rp), ...Object.keys(lp), ...Object.keys(rd), ...Object.keys(ld)]);
  const plans = [];
  const deletedPlans = {};
  const summary = [];
  let localChanged = false;
  let remoteChanged = false;
  for (const id of ids) {
    const L = lp[id];
    const R = rp[id];
    const stub = [ld[id], rd[id]].filter(Boolean).sort((a, b) => b.deletedAt - a.deletedAt)[0];
    let m;
    if (L && R) {
      m = mergePlan(L, R);
    } else if (L || R) {
      const only = L || R;
      const plan = dated(only);
      m = { plan, local: !L || plan !== only, remote: !R, count: null };
    }
    if (m && stub && stub.deletedAt >= when(m.plan)) {
      // the plan was deleted after its last change: it goes
      deletedPlans[id] = stub;
      localChanged = localChanged || !!L || !ld[id];
      remoteChanged = remoteChanged || !!R || !rd[id];
      if (L) {
        summary.push({ id, name: L.name, status: 'deleted', added: 0, updated: 0, deleted: 0 });
      }
      continue;
    }
    if (!m) {
      deletedPlans[id] = stub; // deleted everywhere
      localChanged = localChanged || !ld[id] || ld[id].deletedAt !== stub.deletedAt;
      remoteChanged = remoteChanged || !rd[id] || rd[id].deletedAt !== stub.deletedAt;
      continue;
    }
    // the plan lives (a deletion older than its last change is dropped)
    localChanged = localChanged || m.local || !!ld[id];
    remoteChanged = remoteChanged || m.remote || !!rd[id];
    plans.push(m.plan);
    const c = m.count || { added: 0, updated: 0, deleted: 0 };
    summary.push({
      id,
      name: m.plan.name,
      status: !L ? 'new' : m.local ? 'merged' : 'same',
      ...c,
    });
  }
  return { plans, deletedPlans, localChanged, remoteChanged, summary };
}
