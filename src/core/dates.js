/**
 * @file Months as integers (year * 12 + month), days as UTC day numbers, and budget periods that follow a payday.
 */
import { FMT } from './format.js';
import { clamp } from './util.js';

/**
 * Dates as text. toLocaleDateString builds a new Intl.DateTimeFormat on every call, which is slow (a calendar writes
 * a hundred dates per redraw): keep one formatter per language and set of options. The text is exactly the same.
 */
const formats = new Map();
function dateText(date, locale, options) {
  const key = locale + '|' + JSON.stringify(options);
  let format = formats.get(key);
  if (!format) {
    if (formats.size > 200) {
      formats.clear(); // a handful are in use; this only guards against unbounded growth
    }
    format = new Intl.DateTimeFormat(locale, options);
    formats.set(key, format);
  }
  return format.format(date);
}

/** Months are integers (year*12 + monthIndex) internally and 'YYYY-MM' strings in stored data. */
export const M = {
  parse: s => {
    const x = typeof s === 'string' && /^(\d{4})-(0[1-9]|1[0-2])$/.exec(s);
    if (!x) {
      return null;
    }
    const y = +x[1];
    return y < 1970 || y > 2200 ? null : y * 12 + +x[2] - 1;
  },
  key: i => Math.floor(i / 12) + '-' + String((i % 12) + 1).padStart(2, '0'),
  now: () => {
    const d = new Date();
    return d.getFullYear() * 12 + d.getMonth();
  },
  date: i => new Date(Math.floor(i / 12), i % 12, 1),
  label: (i, long) => dateText(M.date(i), FMT.dloc, { month: long ? 'long' : 'short', year: 'numeric' }),
  short: i => dateText(M.date(i), FMT.dloc, { month: 'short' }),
};
/** Days are integers (days since 1970-01-01, UTC so there are no timezone or DST surprises) and 'YYYY-MM-DD' in stored data. */
export const D = {
  of: (y, m, d) => Math.round(Date.UTC(y, m, d) / 864e5),
  js: n => new Date(n * 864e5),
  parse: s => {
    const x = typeof s === 'string' && /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
    if (!x) {
      return null;
    }
    const y = +x[1];
    const n = D.of(y, +x[2] - 1, +x[3]);
    return y < 1970 || y > 2200 || D.key(n) !== s ? null : n;
  },
  key: n => D.js(n).toISOString().slice(0, 10),
  dow: n => D.js(n).getUTCDay(),
  weekend: n => {
    const w = D.dow(n);
    return w === 0 || w === 6;
  },
  today: () => {
    const d = new Date();
    return D.of(d.getFullYear(), d.getMonth(), d.getDate());
  },
  month: n => {
    const d = D.js(n);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  },
  /** Day `day` of month k (clamped to the month's length), moved off a weekend if asked. */
  inMonth: (k, day, shift) => {
    const y = Math.floor(k / 12);
    const m = k % 12;
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let n = D.of(y, m, clamp(day, 1, dim));
    if (shift === 'next') {
      while (D.weekend(n)) {
        n++;
      }
    } else if (shift === 'prev') {
      while (D.weekend(n)) {
        n--;
      }
    }
    return n;
  },
  label: (n, o) => D.fmt(n, Object.assign({ day: 'numeric', month: 'short' }, o)),
  /** Day n as text with exactly these Intl options (for example { weekday: 'long' }), in the app's language. */
  fmt: (n, o) => dateText(D.js(n), FMT.dloc, Object.assign({ timeZone: 'UTC' }, o)),
};
/**
 * BUDGET PERIODS ("months" in the UI). A period always ends the day before the next salary.
 * payDay 0: periods are calendar months.
 * payDay 26, payFor 'next': "November" runs from the October payday to the day before the November payday
 *   (the salary that lands late in October is the money you live on in November).
 * payDay 26, payFor 'same': "November" starts on the November payday instead.
 */
export const Period = {
  /** 1 when a salary pays for the FOLLOWING month (typical for a late-month payday): "November" then runs from the October payday to the day before the November one. */
  off: S => (S.payDay && S.payFor === 'next' ? 1 : 0),
  start: (S, k) =>
    S.payDay ? D.inMonth(k - Period.off(S), S.payDay, S.payShift) : D.of(Math.floor(k / 12), k % 12, 1),
  end: (S, k) => Period.start(S, k + 1) - 1,
  of: (S, n) => {
    let k = D.month(n);
    while (Period.start(S, k) > n) {
      k--;
    }
    while (Period.start(S, k + 1) <= n) {
      k++;
    }
    return k;
  },
  now: S => Period.of(S, D.today()),
  /** Date of a "day N of the month" charge inside period k (null when it has no fixed day). */
  dayIn: (S, k, day, shift) => {
    if (!day) {
      return null;
    }
    const b = k - Period.off(S);
    const n = D.inMonth(S.payDay && day < S.payDay ? b + 1 : b, day, shift);
    return clamp(n, Period.start(S, k), Period.end(S, k));
  },
};
