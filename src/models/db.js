/**
 * @file The stored database: all plans plus the browser preferences.
 */
import { APP } from '../config.js';
import { GRID_COLS, GRID_MAX_H } from '../core/grid.js';
import { clamp, isObj, uid } from '../core/util.js';
import { REMINDER_DAYS } from '../logic/reminders.js';
import { normCalendar } from './calendarPrefs.js';
import { normPlan } from './plan.js';

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
 * Bill reminders, a browser preference like the theme: on or off, how many days ahead (logic/reminders.js
 * REMINDER_DAYS), which kinds of payment, and whether the system shows notifications too. Off until turned on.
 */
export function normReminders(raw) {
  const r = isObj(raw) ? raw : {};
  const yes = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
  return {
    on: r.on === true,
    days: REMINDER_DAYS.includes(r.days) ? r.days : 2,
    bill: yes(r.bill, true),
    loan: yes(r.loan, true),
    oneoff: yes(r.oneoff, true),
    notify: r.notify === true,
  };
}

export function normDB(raw) {
  raw = isObj(raw) ? raw : {};
  const plans = {};
  if (isObj(raw.plans)) {
    for (const p of Object.values(raw.plans).slice(0, APP.maxPlans)) {
      const c = normPlan(p);
      while (plans[c.id]) {
        c.id = uid();
      }
      plans[c.id] = c;
    }
  }
  const idsL = Object.keys(plans);
  const txt = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : '');
  return {
    v: APP.schema,
    active: plans[raw.active] ? raw.active : idsL[0] || null,
    plans,
    theme: ['auto', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'auto',
    autosave: !!raw.autosave,
    toastPos: ['tr', 'br', 'tl', 'bl'].includes(raw.toastPos) ? raw.toastPos : 'tr',
    tripView: raw.tripView === 'list' ? 'list' : 'grid',
    wishView: raw.wishView === 'list' ? 'list' : 'grid',
    /** Show the "Design mode" switch on the pages whose cards can be arranged. Off until the person turns it on. */
    designMode: raw.designMode === true,
    layouts: normLayouts(raw.layouts),
    calendar: normCalendar(raw.calendar),
    reminders: normReminders(raw.reminders),
    /** Amounts are hidden on screen until tapped (Settings › Lock and privacy). Off until the person turns it on. */
    hideAmounts: raw.hideAmounts === true,
    log: Array.isArray(raw.log)
      ? raw.log
          .filter(isObj)
          .slice(-APP.maxLog)
          .map(e => ({ t: txt(e.t, 30), text: txt(e.text, 200) }))
          .filter(e => e.text)
      : [],
  };
}
