/**
 * @file The arithmetic behind the calendar component (ui/components/calendar.js). Pure: no DOM, no state, no clock.
 *
 * A calendar shows "events": anything with a day and, usually, an amount. The component accepts them in this shape
 * (see CalendarEvent in types.js) and normEvents cleans whatever a page hands over:
 *   { id, title, date, end?, amount?, group?, tone?, color?, sub?, done?, data? }
 * `date` and `end` are day numbers (D.of) or 'YYYY-MM-DD'. No `date` means "no fixed day" in the period shown.
 * An `end` after `date` makes a span (a trip from Friday to Monday) that is drawn across the days.
 *
 * The adapters at the bottom (entryEvents, tripEvents, dayBalances) turn the plan and its projection into events,
 * so the month planner, the overview or any other page can show the same data on a calendar.
 */
import { D } from '../core/dates.js';
import { r2 } from '../core/util.js';

/** First and last day of calendar month k. */
export const monthRange = k => {
  const year = Math.floor(k / 12);
  const month = k % 12;
  return { start: D.of(year, month, 1), end: D.of(year, month + 1, 1) - 1 };
};

/** Position of day n in a week that starts on `weekStart` (0 Sunday … 6 Saturday): 0 … 6. */
export const weekPos = (n, weekStart) => (D.dow(n) - weekStart + 7) % 7;

/**
 * The weeks that cover start … end: an array of weeks, each an array of 7 day numbers.
 * `fixed` always returns 6 weeks, so a calendar keeps its height when you page through months.
 */
export function calendarWeeks(start, end, weekStart = 1, fixed = false) {
  const first = start - weekPos(start, weekStart);
  const last = end + 6 - weekPos(end, weekStart);
  const count = Math.max(fixed ? 6 : 0, (last - first + 1) / 7);
  return Array.from({ length: count }, (_, w) => Array.from({ length: 7 }, (_, d) => first + w * 7 + d));
}

const toDay = value => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  return typeof value === 'string' ? D.parse(value) : null;
};

/**
 * Cleans a list of events: day numbers for dates, numbers or null for amounts, text for titles.
 * An unreadable date counts as "no fixed day"; an `end` before `date` is dropped. The input is not changed.
 * @returns {import('../types.js').CalendarEvent[]}
 */
export function normEvents(list) {
  return (Array.isArray(list) ? list : [])
    .filter(ev => ev && typeof ev === 'object')
    .map((ev, i) => {
      const date = toDay(ev.date);
      const end = date === null ? null : toDay(ev.end);
      const amount = typeof ev.amount === 'number' && isFinite(ev.amount) ? ev.amount : null;
      return {
        ...ev,
        id: ev.id != null ? String(ev.id) : 'ev' + i,
        title: String(ev.title ?? ''),
        date,
        end: end !== null && end > date ? end : null,
        amount,
        group: ev.group != null ? String(ev.group) : '',
        done: !!ev.done,
      };
    });
}

/** The last day an event covers. */
export const lastDay = ev => (ev.end !== null && ev.end !== undefined ? ev.end : ev.date);

/**
 * Places events on the days from … to (the days drawn, usually whole weeks).
 * - `days`: Map day → { lanes, items }. `items` are one-day events in the order given.
 *   `lanes` holds the spans on that day: lanes[i] is { event, first, last, index, length } or null for a gap, so a span
 *   keeps the same row on every day it covers and spans never overlap.
 * - `undated`: events without a day, in the order given.
 * - `lanes`: how many span rows are needed at most.
 * Events that end before `from` or start after `to` are left out.
 */
export function layoutEvents(events, from, to) {
  const days = new Map();
  const undated = [];
  const spans = [];
  const slot = n => {
    if (!days.has(n)) {
      days.set(n, { lanes: [], items: [] });
    }
    return days.get(n);
  };
  for (const ev of events) {
    if (ev.date === null) {
      undated.push(ev);
      continue;
    }
    if (lastDay(ev) < from || ev.date > to) {
      continue;
    }
    if (lastDay(ev) > ev.date) {
      spans.push(ev);
    } else {
      slot(ev.date).items.push(ev);
    }
  }
  // earliest first, then longest first: the usual way a calendar stacks multi-day events
  spans.sort((a, b) => a.date - b.date || lastDay(b) - lastDay(a) || a.id.localeCompare(b.id));
  const laneEnds = [];
  for (const ev of spans) {
    let lane = laneEnds.findIndex(end => end < ev.date);
    if (lane < 0) {
      lane = laneEnds.length;
    }
    laneEnds[lane] = lastDay(ev);
    const length = lastDay(ev) - ev.date + 1;
    for (let n = Math.max(ev.date, from); n <= Math.min(lastDay(ev), to); n++) {
      slot(n).lanes[lane] = {
        event: ev,
        first: n === ev.date,
        last: n === lastDay(ev),
        index: n - ev.date + 1,
        length,
      };
    }
  }
  for (const day of days.values()) {
    day.lanes = Array.from(day.lanes, lane => lane || null);
  }
  return { days, undated, lanes: laneEnds.length };
}

/** Events on one day of a layout, spans first (in lane order), then the one-day events. */
export const eventsOn = (layout, n) => {
  const day = layout.days.get(n);
  return day ? [...day.lanes.filter(Boolean).map(lane => lane.event), ...day.items] : [];
};

/** Events that touch start … end, each once, plus the undated ones (they belong to the period shown). */
export function eventsIn(events, start, end) {
  return events.filter(ev => ev.date === null || (ev.date <= end && lastDay(ev) >= start));
}

/** Money in, money out (as a positive number), net, and how many events, over a list. Events without an amount only count. */
export function totals(events) {
  let inflow = 0;
  let outflow = 0;
  for (const ev of events) {
    if (ev.amount > 0) {
      inflow += ev.amount;
    } else if (ev.amount < 0) {
      outflow -= ev.amount;
    }
  }
  return { in: r2(inflow), out: r2(outflow), net: r2(inflow - outflow), count: events.length };
}

/* --- adapters: the plan and its projection as calendar events --- */

/** A tracked budget with nothing logged holds nothing back: the month planner leaves it out, and so does the calendar. */
export const quiet = e => !!e.budget && !e.budget.reserve && !e.budget.spent;
const inMonth = (e, month) => e.date !== null && e.date >= month.start && e.date <= month.end;

/**
 * The calendar group of a projected line: the ledger group, with budgets and spending told apart.
 *   inc, bill, budget, spend (one-off purchases and spends logged against a budget), trip, loan, goal, wish, transfer, adjust
 */
export function entryGroup(e) {
  if (e.budget) {
    return 'budget';
  }
  if (e.of || e.group === 'item') {
    return 'spend';
  }
  return e.group;
}

/**
 * One event per line of a projected month (logic/projection.js). A line dated outside the month has no fixed day,
 * as in the month planner. `data` keeps the line and its month, so a page can open the usual editing window.
 */
export function entryEvents(month) {
  return month.entries
    .filter(e => !quiet(e))
    .map(e => ({
      id: month.key + ':' + e.key,
      title: e.label,
      date: inMonth(e, month) ? e.date : null,
      amount: e.amount,
      group: entryGroup(e),
      sub: e.sub || '',
      done: !!e.paid,
      data: { entry: e, month },
    }));
}

/** Trips and events with dates, as spans from the first to the last day. Ideas and trips without dates are skipped. */
export function tripEvents(trips) {
  return (trips || [])
    .filter(t => t.on !== false && D.parse(t.from) !== null)
    .map(t => ({
      id: 'trip:' + t.id,
      title: t.name,
      date: D.parse(t.from),
      end: D.parse(t.to),
      amount: null, // its costs are already lines of their months: counting the trip too would count them twice
      group: 'trip',
      sub: '',
      data: { trip: t },
    }));
}

/**
 * End-of-day balance for every day of a projected month: Map day → balance. Lines without a day are counted on the
 * first day, to be safe; this is the same running balance as "Day by day" in the month planner.
 */
export function dayBalances(month) {
  const shown = month.entries.filter(e => !quiet(e));
  let balance = r2(month.open + shown.filter(e => !inMonth(e, month)).reduce((sum, e) => sum + e.amount, 0));
  const byDay = new Map();
  for (const e of shown) {
    if (inMonth(e, month)) {
      byDay.set(e.date, (byDay.get(e.date) || 0) + e.amount);
    }
  }
  const out = new Map();
  for (let n = month.start; n <= month.end; n++) {
    balance = r2(balance + (byDay.get(n) || 0));
    out.set(n, balance);
  }
  return out;
}

/**
 * The days ahead in one line (audit 6.6, under the Overview calendar): the payments still due from `today` for
 * `count` days, what they add up to, and the lowest end-of-day balance in that window. Balances come from dayBalances,
 * so they match the calendar and Day by day.
 * @param {import('../types.js').Month[]} months the projected months
 * @param {number} today day number
 * @param {number} [count] how many days, today included
 * @returns {{payments: number, out: number, lowest: ?{day: number, balance: number}}}
 */
export function nextDays(months, today, count = 7) {
  const last = today + count - 1;
  let payments = 0;
  let out = 0;
  let lowest = null;
  for (const month of months) {
    if (month.end < today || month.start > last) {
      continue;
    }
    for (const e of month.entries) {
      if (!quiet(e) && !e.paid && e.amount < 0 && inMonth(e, month) && e.date >= today && e.date <= last) {
        payments++;
        out += -e.amount;
      }
    }
    const balances = dayBalances(month);
    for (let n = Math.max(today, month.start); n <= Math.min(last, month.end); n++) {
      const balance = balances.get(n);
      if (lowest === null || balance < lowest.balance) {
        lowest = { day: n, balance };
      }
    }
  }
  return { payments, out: r2(out), lowest };
}
