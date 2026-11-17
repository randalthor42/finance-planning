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
/*
 * Calendar arithmetic without Date objects (Howard Hinnant's civil-date algorithms). A projection asks for tens of
 * thousands of days, and a Date per call was a large part of its time. The results are exactly Date's
 * (tests/unit/dates.test.js compares them on every day from 1900 to 2300); outside the years 100 to 9999 the Date
 * way is used, so even odd input behaves as before.
 */
const MIN_DAY = -681907; // 0100-01-01
const MAX_DAY = 2932896; // 9999-12-31
/** Day number of year y, month m (1-12), day d (1 on). */
function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
/** [year, month 1-12, day] of day number n. */
function civilFromDays(n) {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - Math.floor((153 * mp + 2) / 5) + 1];
}
const plain = n => Number.isInteger(n) && n >= MIN_DAY && n <= MAX_DAY;
const two = n => (n < 10 ? '0' : '') + n;
const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Days are integers (days since 1970-01-01, UTC so there are no timezone or DST surprises) and 'YYYY-MM-DD' in stored data. */
export const D = {
  /** Like Date.UTC: a day or month out of range runs into the next or previous one. */
  of: (y, m, d) => {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d) || y < 200 || y > 9000) {
      return Math.round(Date.UTC(y, m, d) / 864e5);
    }
    const year = y + Math.floor(m / 12);
    return daysFromCivil(year, m - Math.floor(m / 12) * 12 + 1, 1) + d - 1;
  },
  js: n => new Date(n * 864e5),
  parse: s => {
    const x = typeof s === 'string' && /^(\d{4})-(\d\d)-(\d\d)$/.exec(s);
    if (!x) {
      return null;
    }
    const y = +x[1];
    const m = +x[2];
    const d = +x[3];
    const valid =
      y >= 1970 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= (m === 2 && leap(y) ? 29 : DAYS_IN[m - 1]);
    return valid ? daysFromCivil(y, m, d) : null;
  },
  key: n => {
    if (!plain(n)) {
      return D.js(n).toISOString().slice(0, 10);
    }
    const [y, m, d] = civilFromDays(n);
    return (y < 1000 ? String(y).padStart(4, '0') : y) + '-' + two(m) + '-' + two(d);
  },
  dow: n => (plain(n) ? (((n + 4) % 7) + 7) % 7 : D.js(n).getUTCDay()),
  weekend: n => {
    const w = D.dow(n);
    return w === 0 || w === 6;
  },
  today: () => {
    const d = new Date();
    return D.of(d.getFullYear(), d.getMonth(), d.getDate());
  },
  month: n => {
    if (!plain(n)) {
      const d = D.js(n);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    const [y, m] = civilFromDays(n);
    return y * 12 + m - 1;
  },
  /** Day `day` of month k (clamped to the month's length), moved off a weekend if asked. */
  inMonth: (k, day, shift) => {
    const y = Math.floor(k / 12);
    const m = k % 12;
    const dim = D.of(y, m + 1, 1) - D.of(y, m, 1);
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
