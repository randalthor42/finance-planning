/**
 * @file When an appointment of My calendar happens: its occurrences between two days. Pure. Used by the calendar
 * (logic/agenda.js agendaEvents) and by the projection, which counts the money of counted appointments.
 */
import { D } from '../core/dates.js';

const STEP = { day: 1, week: 7 };

/**
 * Works out once what every occurrence needs: first day, length, last possible start, skipped days. A calendar asks for
 * a few months in a visit; the dates are parsed here, not once per month.
 * @returns {object[]} one prepared entry per appointment: {entry, start, len, repeat, until, skip, dom, k0, …}
 */
export function prepareEntries(entries) {
  return entries.map(entry => {
    const start = D.parse(entry.date);
    const end = D.parse(entry.end);
    const until = D.parse(entry.until);
    return {
      entry,
      start,
      len: end !== null ? end - start + 1 : 1,
      repeat: entry.repeat,
      until: until === null ? Infinity : until,
      skip: entry.skip.length ? new Set(entry.skip.map(D.parse)) : null,
      dom: D.js(start).getUTCDate(),
      k0: D.month(start),
    };
  });
}

/**
 * The first days of the occurrences of a prepared entry that touch from … to (an occurrence that started earlier and
 * is still going counts). Worked out, not walked: an appointment repeated daily for years costs the same as a new one.
 * A monthly or yearly repeat on a day a month does not have falls on its last day (D.inMonth), like a bill.
 * @returns {number[]} the first day (day number) of each occurrence, in order
 */
export function occurrences(p, from, to) {
  const out = [];
  const lo = Math.max(p.start, from - p.len + 1); // the earliest start that still reaches `from`
  const hi = Math.min(to, p.until);
  const keep = n => {
    if (n >= lo && n <= hi && !(p.skip && p.skip.has(n))) {
      out.push(n);
    }
  };
  if (lo > hi) {
    return out;
  }
  if (p.repeat === 'none') {
    keep(p.start);
  } else if (STEP[p.repeat]) {
    const step = STEP[p.repeat];
    for (let n = p.start + Math.ceil((lo - p.start) / step) * step; n <= hi; n += step) {
      keep(n);
    }
  } else {
    const step = p.repeat === 'year' ? 12 : 1;
    const k1 = D.month(lo);
    // the month index of the first candidate: p.k0 plus whole steps, not before the month of `lo`
    let k = p.k0 + Math.max(0, Math.ceil((k1 - p.k0) / step)) * step;
    // a day clamped to the end of a short month can be before `lo` in the month of `lo`: the next step is checked too
    for (; k <= D.month(hi); k += step) {
      keep(D.inMonth(k, p.dom, 'none'));
    }
  }
  return out;
}
