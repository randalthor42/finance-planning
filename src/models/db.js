/**
 * @file The stored database: all plans plus the browser preferences.
 */
import { APP } from '../config.js';
import { GRID_COLS, GRID_MAX_H } from '../core/grid.js';
import { ID_RE, clamp, isObj, uid } from '../core/util.js';
import { normCalendar } from './calendarPrefs.js';
import { normPlan } from './plan.js';
import { timestamp } from './records.js';

/** Names of pages and cards in a saved layout: short, plain identifiers. */
const LAYOUT_ID = /^[a-z][\w-]{0,39}$/i;
/** Limits of the saved Design mode layouts, so a damaged or hostile value cannot grow the storage. */
const MAX_LAYOUTS = 30;
const MAX_LAYOUT_CARDS = 200;
const MAX_LAYOUT_ROWS = 200;

/**
 * Design mode layouts, by page: { overview: { cardId: { x, y, w, h } } }. A browser preference, not plan data.
 * Only the shape is checked here; overlaps are settled when the page is drawn (core/grid.js arrange).
 */
export function normLayouts(raw) {
  const out = {};
  if (!isObj(raw)) {
    return out;
  }
  const int = (v, lo, hi) => clamp(Math.round(Number(v)) || 0, lo, hi);
  for (const [key, cards] of Object.entries(raw).slice(0, MAX_LAYOUTS)) {
    if (!LAYOUT_ID.test(key) || !isObj(cards)) {
      continue;
    }
    const clean = {};
    for (const [id, c] of Object.entries(cards).slice(0, MAX_LAYOUT_CARDS)) {
      if (LAYOUT_ID.test(id) && isObj(c)) {
        const w = int(c.w, 1, GRID_COLS);
        clean[id] = { x: int(c.x, 0, GRID_COLS - w), y: int(c.y, 0, MAX_LAYOUT_ROWS), w, h: int(c.h, 1, GRID_MAX_H) };
      }
    }
    if (Object.keys(clean).length) {
      out[key] = clean;
    }
  }
  return out;
}

/**
 * The database, cleaned. With keepRaw (a Set), plans other than the open one that look like what the store writes
 * (an object with a valid, unused id) are kept as they are and their ids added to keepRaw: the store cleans them
 * when they are first needed or when the browser is idle (PlanStore.cleanPlans), so opening the app cleans only the
 * plan it shows. Everything else is cleaned at once, as always.
 */
export function normDB(raw, keepRaw) {
  raw = isObj(raw) ? raw : {};
  const plans = {};
  if (isObj(raw.plans)) {
    for (const p of Object.values(raw.plans).slice(0, APP.maxPlans)) {
      if (keepRaw && isObj(p) && p.id !== raw.active && ID_RE.test(p.id) && !plans[p.id] && isObj(p.settings)) {
        plans[p.id] = p;
        keepRaw.add(p.id);
        continue;
      }
      const c = normPlan(p);
      while (plans[c.id]) {
        c.id = uid();
      }
      plans[c.id] = c;
    }
  }
  const idsL = Object.keys(plans);
  const active = plans[raw.active] ? raw.active : idsL[0] || null;
  // deleted plans: their id and dates (models/records.js), the newest 100, none that exists again
  const deletedPlans = {};
  const gone = isObj(raw.deletedPlans) ? Object.values(raw.deletedPlans) : [];
  for (const d of gone
    .filter(d => isObj(d) && typeof d.id === 'string' && ID_RE.test(d.id) && !plans[d.id] && timestamp(d.deletedAt))
    .sort((a, b) => a.deletedAt - b.deletedAt)
    .slice(-100)) {
    deletedPlans[d.id] = {
      id: d.id,
      createdAt: timestamp(d.createdAt),
      updatedAt: timestamp(d.updatedAt) ?? timestamp(d.deletedAt),
      deletedAt: timestamp(d.deletedAt),
    };
  }
  if (keepRaw && keepRaw.has(active)) {
    plans[active] = normPlan(plans[active]); // the open plan is always clean
    keepRaw.delete(active);
  }
  return {
    v: APP.schema,
    schemaVersion: APP.schema,
    active,
    plans,
    deletedPlans,
    ...normPrefs(raw),
  };
}

/**
 * The browser preferences and the activity log: everything in the database except the plans. Cheap, so a changed
 * preference cleans only these (PlanStore.setPref) and not every plan again.
 */
export function normPrefs(raw) {
  raw = isObj(raw) ? raw : {};
  const txt = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : '');
  return {
    theme: ['auto', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'auto',
    autosave: !!raw.autosave,
    toastPos: ['tr', 'br', 'tl', 'bl'].includes(raw.toastPos) ? raw.toastPos : 'tr',
    tripView: raw.tripView === 'list' ? 'list' : 'grid',
    wishView: raw.wishView === 'list' ? 'list' : 'grid',
    /** Show the "Design mode" switch on the pages whose cards can be arranged. Off until the person turns it on. */
    designMode: raw.designMode === true,
    /**
     * Keep the plans in a JSON file the person chooses (state/fileSync.js). Off until the person turns it on (or
     * chooses a file): like every way of moving data off the device, it is opt-in.
     */
    fileSync: raw.fileSync === true,
    /** Look for changes saved to that file by another device or browser, and load them. */
    fileWatch: raw.fileWatch !== false,
    layouts: normLayouts(raw.layouts),
    calendar: normCalendar(raw.calendar),
    log: Array.isArray(raw.log)
      ? raw.log
          .filter(isObj)
          .slice(-APP.maxLog)
          .map(e => ({ t: txt(e.t, 30), text: txt(e.text, 200) }))
          .filter(e => e.text)
      : [],
  };
}

/**
 * The database as JSON text, exactly as JSON.stringify(db) writes it, but each plan's text comes from planText. The
 * store passes its cache there, so a save does not serialise again the plans that did not change.
 */
export function dbText(db, planText = JSON.stringify) {
  const parts = [];
  for (const key of Object.keys(db)) {
    const value = db[key];
    if (key === 'plans') {
      const plans = Object.keys(value).map(id => JSON.stringify(id) + ':' + planText(value[id]));
      parts.push('"plans":{' + plans.join(',') + '}');
    } else {
      const text = JSON.stringify(value);
      if (text !== undefined) {
        parts.push(JSON.stringify(key) + ':' + text);
      }
    }
  }
  return '{' + parts.join(',') + '}';
}
