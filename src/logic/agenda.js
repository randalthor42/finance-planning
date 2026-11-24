/**
 * @file My calendar, the arithmetic (models/agenda.js has the shape). Pure: no DOM, no state, no clock.
 *
 * - Appointments and their repeats become calendar events (agendaEvents), one per occurrence.
 * - Drafts (one-offs, trips and events made on the calendar) become tentative events with their money (draftEvents).
 * - withDrafts / moveDrafts put chosen drafts into the plan: the first on a copy, to see what they would do
 *   (draftImpact), the second on the draft of a commit, which makes them real in one step.
 */
import { D, M, Period } from '../core/dates.js';
import { $t } from '../core/i18n.js';
import { r2 } from '../core/util.js';
import { DRAFT_LISTS } from '../config.js';
import { occurrences, prepareEntries } from './occurrences.js';
import { project } from './projection.js';

export { occurrences, prepareEntries };

/**
 * The money of an appointment, signed like a ledger line, or null when it has none.
 * @returns {?number} positive for money in, negative for money out, null without money
 */
export const moneyOf = entry => {
  if (!(entry.amount > 0)) {
    return null;
  }
  if (entry.kind === 'in') {
    return entry.amount;
  }
  return -entry.amount;
};
/**
 * An appointment whose money is not counted yet: it is listed with the drafts, and applying it switches it on.
 * @returns {boolean}
 */
export const draftMoney = entry => entry.amount > 0 && !entry.on;

/** -1, 0 or 1: the order of two texts, for sort. */
function compareText(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

/** "09:30", or "09:30–10:15" with an end time. */
const timeText = entry => (entry.time && entry.endTime ? entry.time + '–' + entry.endTime : entry.time);
const REPEAT_TEXT = {
  day: () => $t('Every day'),
  week: () => $t('Every week'),
  month: () => $t('Every month'),
  year: () => $t('Every year'),
};

/**
 * The appointments that touch from … to as calendar events (types.js CalendarEvent), one per occurrence, ordered by
 * day, then the ones without a time, then by time. Each keeps its entry and the day of its occurrence in `data`.
 * `prepared` (prepareEntries) can be passed when the same agenda is asked for several months.
 * @returns {import('../types.js').CalendarEvent[]} sorted by day, untimed first, then by time
 */
export function agendaEvents(agenda, from, to, prepared = prepareEntries(agenda.entries)) {
  const out = [];
  for (const p of prepared) {
    for (const n of occurrences(p, from, to)) {
      const entry = p.entry;
      out.push({
        id: 'agenda:' + entry.id + ':' + n,
        title: entry.title,
        date: n,
        end: p.len > 1 ? n + p.len - 1 : null,
        amount: moneyOf(entry),
        // money not counted yet is a draft: drawn dashed and not added up (components/calendar.js)
        tentative: entry.amount > 0 && !entry.on,
        group: 'cal:' + entry.cal,
        time: entry.time,
        timeText: timeText(entry),
        sub: entry.repeat !== 'none' ? REPEAT_TEXT[entry.repeat]() : '',
        note: entry.note,
        data: { agenda: entry, day: n },
      });
    }
  }
  return out.sort((a, b) => a.date - b.date || (a.time ? 1 : 0) - (b.time ? 1 : 0) || compareText(a.time, b.time));
}

/** What a trip would cost in its plan: its costs, or its whole budget when the unplanned part is reserved. */
const tripCost = t => {
  const costs = t.items.reduce((sum, i) => sum + i.amount, 0);
  return r2(t.reserve && t.budget > costs ? t.budget : costs);
};

/**
 * Drafts as tentative calendar events, with their money (signed like a ledger line). Dated ones are all returned (the
 * calendar keeps the days it draws); the ones without a day only in their month k. `data.draft` says where each is.
 * @returns {import('../types.js').CalendarEvent[]} tentative events
 */
export function draftEvents(drafts, k) {
  const out = [];
  const sub = $t('Draft, not in your plan yet');
  for (const item of drafts.items) {
    const date = D.parse(item.date);
    if (date === null && M.parse(item.month) !== k) {
      continue;
    }
    out.push({
      id: 'draft:items:' + item.id,
      title: item.name,
      date,
      amount: item.kind === 'in' ? item.amount : -item.amount,
      group: 'draft',
      tentative: true,
      sub,
      note: item.note,
      data: { draft: { list: 'items', id: item.id }, record: item },
    });
  }
  for (const trip of drafts.trips) {
    const date = D.parse(trip.from);
    if (date === null && M.parse(trip.month) !== k) {
      continue;
    }
    const cost = tripCost(trip);
    out.push({
      id: 'draft:trips:' + trip.id,
      title: trip.name,
      date,
      end: D.parse(trip.to),
      amount: cost ? -cost : null,
      group: 'draft',
      tentative: true,
      sub,
      note: trip.note,
      data: { draft: { list: 'trips', id: trip.id }, record: trip },
    });
  }
  return out;
}

/**
 * How many drafts there are, over every list, and (with `agenda`) appointments whose money is not counted yet.
 * @returns {number}
 */
export const draftCount = (drafts, agenda = null) =>
  DRAFT_LISTS.reduce((sum, list) => sum + drafts[list].length, 0) +
  (agenda ? agenda.entries.filter(draftMoney).length : 0);
/**
 * The ids of every draft, and (with `agenda`) of appointments whose money is not counted yet.
 * @returns {string[]}
 */
export const draftIds = (drafts, agenda = null) => [
  ...DRAFT_LISTS.flatMap(list => drafts[list].map(x => x.id)),
  ...(agenda ? agenda.entries.filter(draftMoney).map(e => e.id) : []),
];

/** The list a ledger line comes from, by the start of its key ("bill:<id>", "trip:<id>:<cost>", "loan:<id>:fee"…). */
const LIST_OF = {
  inc: 'incomes',
  bill: 'bills',
  item: 'items',
  trip: 'trips',
  loan: 'loans',
  goal: 'goals',
  wish: 'wishes',
};
/**
 * The record a plan event comes from, as 'list:id' (the key of a pin), or null for a line of no record (a balance
 * correction, a what-if). Works for ledger lines (data.entry) and trip bars (data.trip).
 * @returns {?string} 'list:id', or null
 */
export function pinKey(ev) {
  const data = ev.data || {};
  if (data.trip) {
    return 'trips:' + data.trip.id;
  }
  const entry = data.entry;
  const list = entry && entry.id ? LIST_OF[entry.key.split(':')[0]] : null;
  return list ? list + ':' + entry.id : null;
}

/** Groups that are spending, the ones a category filter applies to. */
const SPENT = new Set(['bill', 'budget', 'spend']);
/**
 * Keeps the spending of the chosen categories (bills, budgets, one-offs and spends) and everything that is not
 * spending: income, trips, loans, savings… have layers of their own. null when every category is shown.
 * A spend logged against a budget counts in the budget's category (`budgets`: Map budget id → category): "Supermarket,
 * from Groceries" is food, whatever category the spend itself was logged with.
 * @returns {?(ev: import('../types.js').CalendarEvent) => boolean} the filter, or null when every category is shown
 */
export function categoryFilter(cats, budgets = new Map()) {
  if (!cats.length) {
    return null;
  }
  const chosen = new Set(cats);
  return ev => {
    const entry = ev.data && ev.data.entry;
    if (!SPENT.has(ev.group) || !entry) {
      return true;
    }
    return chosen.has((entry.of && budgets.get(entry.of)) || entry.cat);
  };
}

/**
 * A copy of the plan with the chosen drafts in its lists (and no longer drafts). The plan itself is not changed.
 * @returns {import('../types.js').Plan} the copy
 */
export function withDrafts(plan, ids) {
  const chosen = new Set(ids);
  const drafts = {};
  const copy = {
    ...plan,
    agenda: {
      ...plan.agenda,
      drafts,
      entries: plan.agenda.entries.map(e => (chosen.has(e.id) && draftMoney(e) ? { ...e, on: true } : e)),
    },
  };
  for (const list of DRAFT_LISTS) {
    const all = plan.agenda.drafts[list];
    copy[list] = [...plan[list], ...all.filter(x => chosen.has(x.id))];
    drafts[list] = all.filter(x => !chosen.has(x.id));
  }
  return copy;
}

/**
 * Moves the chosen drafts into the plan's lists, on the draft plan of a commit, and pins them: they stay on the
 * calendar as the real records they now are, whatever it shows of the plan. Chosen appointments with money not
 * counted yet are switched on. Returns how many were applied.
 * @returns {number} how many drafts and appointments were applied
 */
export function moveDrafts(p, ids) {
  const chosen = new Set(ids);
  let moved = 0;
  for (const list of DRAFT_LISTS) {
    const keep = [];
    for (const x of p.agenda.drafts[list]) {
      if (chosen.has(x.id)) {
        p[list].push(x);
        p.agenda.pins.push({ list, id: x.id });
        moved++;
      } else {
        keep.push(x);
      }
    }
    p.agenda.drafts[list] = keep;
  }
  for (const e of p.agenda.entries) {
    if (chosen.has(e.id) && draftMoney(e)) {
      e.on = true; // the appointment itself is already on the calendar: its money now counts
      moved++;
    }
  }
  return moved;
}

const outline = summary => ({
  lowest: summary.min,
  lowestK: summary.minK,
  negative: summary.negN,
  firstNeg: summary.firstNeg,
  end: summary.end,
});
/**
 * What applying the chosen drafts would do, from the projection `base` of the plan as it is: money in and out they
 * add over the plan, and before / after figures of the months (lowest month end and its month, months below zero and
 * the first one, the end of the plan). One projection of the plan with them; none when nothing is chosen.
 * @returns {{in: number, out: number, before: object, after: object}} before / after: {lowest, lowestK, negative, firstNeg, end}
 */
export function draftImpact(plan, base, ids, today) {
  const before = outline(base.summary);
  if (!ids.length) {
    return { in: 0, out: 0, before, after: { ...before } };
  }
  const after = project(withDrafts(plan, ids), { today });
  return {
    in: r2(after.summary.inc - base.summary.inc),
    out: r2(after.summary.out - base.summary.out),
    before,
    after: outline(after.summary),
  };
}

/* --- one day of a repeating appointment (the window asks: this day, this and following, every day) --- */

/** Fields that, changed on one day, are given to the other days of the repeat in the scope chosen. */
const SHARED = ['title', 'cal', 'time', 'endTime', 'note', 'amount', 'kind', 'cat', 'on'];
const shift = (key, by) => (key && by ? D.key(D.parse(key) + by) : key);
/** Moves an appointment by `by` days: its days, its last repeat and the days it leaves out. */
function move(e, by) {
  if (by) {
    e.date = shift(e.date, by);
    e.end = shift(e.end, by);
    e.until = shift(e.until, by);
    e.skip = e.skip.map(s => shift(s, by));
  }
}
/** The appointment `id` with the others of its repeat (a day changed on its own, a part split off): the family. */
function familyOf(agenda, id) {
  const piece = agenda.entries.find(e => e.id === id);
  if (!piece) {
    return null;
  }
  const root = piece.series || piece.id;
  const others = agenda.entries.filter(e => e !== piece && (e.id === root || e.series === root));
  return { piece, root, others, start: D.parse(piece.date) };
}

/**
 * Saves `values` (what the window shows: the appointment as it is on `day`) for one day of appointment `id`, for that
 * day and the following ones, or for every day. On the draft agenda of a commit. `newId()` makes ids.
 * - 'one': the day leaves the repeat (a skipped day) and becomes an appointment of its own, linked to it.
 * - 'following': the repeat ends the day before; a new one, linked, starts on the day with the new values and keeps
 *   the end and the skipped days that come after. From its first day, it is the whole appointment.
 * - 'all': the appointment changes; a new day moves every day by as much.
 * With 'following' and 'all', the fields that were changed (SHARED) also reach the other days of the family in the
 * scope (days changed on their own, parts split off before), and so does a move; the rest of what they changed stays.
 * A one-day appointment is simply saved.
 * @returns {void} nothing: `agenda` is changed in place
 */
export function editOccurrence(agenda, id, day, values, scope, newId) {
  const fam = familyOf(agenda, id);
  if (!fam) {
    return;
  }
  const { piece, root, others, start } = fam;
  const len = piece.end ? D.parse(piece.end) - start + 1 : 1;
  const was = { ...piece, date: D.key(day), end: len > 1 ? D.key(day + len - 1) : null };
  const changed = SHARED.filter(k => values[k] !== was[k]);
  const by = D.parse(values.date) - day;
  const newLen = values.end ? D.parse(values.end) - D.parse(values.date) + 1 : 1;
  const until = values.until === was.until ? shift(piece.until, by) : values.until;
  const spread = members => {
    for (const m of members) {
      for (const k of changed) {
        m[k] = values[k];
      }
      move(m, by);
    }
  };
  if (piece.repeat !== 'none' && scope === 'one') {
    piece.skip = [...piece.skip, D.key(day)];
    agenda.entries.push({ ...values, id: newId(), series: root, repeat: 'none', until: null, skip: [] });
    return;
  }
  if (piece.repeat !== 'none' && scope === 'following' && day > start) {
    const next = {
      ...values,
      id: newId(),
      series: root,
      end: newLen > 1 ? D.key(D.parse(values.date) + newLen - 1) : null,
      until,
      skip: piece.skip.filter(s => D.parse(s) >= day).map(s => shift(s, by)),
    };
    piece.until = D.key(day - 1);
    piece.skip = piece.skip.filter(s => D.parse(s) < day);
    agenda.entries.push(next);
    spread(others.filter(m => D.parse(m.date) >= day));
    return;
  }
  // the whole of this appointment: 'all', 'following' from its first day, or one that does not repeat
  const first = start + by;
  Object.assign(piece, values, {
    id: piece.id,
    series: piece.series,
    date: D.key(first),
    end: newLen > 1 ? D.key(first + newLen - 1) : null,
    until: piece.repeat === 'none' && values.repeat === 'none' ? null : until,
    skip: piece.skip.map(s => shift(s, by)),
  });
  if (piece.repeat !== 'none' || scope !== 'one') {
    spread(scope === 'all' ? others : others.filter(m => D.parse(m.date) >= day));
  }
}

/** A tick of a counted appointment day: "appt:<id>:<day number>" (logic/projection.js). */
const APPT_TICK = /^appt:([^:]+):(\d+)$/;
/**
 * The ticks of counted appointment days follow their days when an edit gives a day a new id or a new date (a day
 * changed on its own, a repeat split or moved): a tick must not be lost, or the line would show as unpaid again and
 * the month's "now" would change. `map(id, day)` gives the new [id, day] of a day, or null when it stays. A tick moves
 * to the budget month of its new day. On the draft plan of a commit.
 * @param {import('../types.js').Plan} plan
 * @param {(id: string, day: number) => ?[string, number]} map
 * @returns {void} nothing: `plan` is changed in place
 */
export function moveTicks(plan, map) {
  const moves = [];
  for (const [month, lines] of Object.entries(plan.paid)) {
    for (const key of Object.keys(lines)) {
      const found = APPT_TICK.exec(key);
      if (!found) {
        continue;
      }
      const to = map(found[1], Number(found[2]));
      if (to && (to[0] !== found[1] || to[1] !== Number(found[2]))) {
        moves.push({ month, key, id: to[0], day: to[1] });
      }
    }
  }
  for (const m of moves) {
    const tick = plan.paid[m.month][m.key];
    delete plan.paid[m.month][m.key];
    const target = M.key(Period.of(plan.settings, m.day));
    plan.paid[target] = { ...(plan.paid[target] || {}), [`appt:${m.id}:${m.day}`]: tick };
  }
}

/**
 * Deletes one day of appointment `id`, that day and the following ones, or every day of it (every part of its
 * family). On the draft agenda of a commit. A one-day appointment is simply deleted with 'one'.
 * @returns {void} nothing: `agenda` is changed in place
 */
export function deleteOccurrence(agenda, id, day, scope) {
  const fam = familyOf(agenda, id);
  if (!fam) {
    return;
  }
  const { piece, start } = fam;
  if (scope === 'one') {
    if (piece.repeat === 'none') {
      agenda.entries = agenda.entries.filter(e => e !== piece);
    } else {
      piece.skip = [...piece.skip, D.key(day)];
    }
    return;
  }
  const members = new Set([piece, ...fam.others]);
  if (scope === 'all') {
    agenda.entries = agenda.entries.filter(e => !members.has(e));
    return;
  }
  // from `day` on: what starts then goes, what repeats from before stops the day before
  const gone = new Set();
  for (const m of members) {
    const s = m === piece ? start : D.parse(m.date);
    if (s >= day) {
      gone.add(m);
    } else if (m.repeat !== 'none') {
      m.until = m.until && D.parse(m.until) < day ? m.until : D.key(day - 1);
      m.skip = m.skip.filter(x => D.parse(x) < day);
    }
  }
  agenda.entries = agenda.entries.filter(e => !gone.has(e));
}
