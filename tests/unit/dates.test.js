/**
 * @file Unit tests for months, days and budget periods. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { M, D, Period } from '../../src/core/dates.js';

test('a month key becomes a month index and back', () => {
  const november = M.parse('2026-11');
  assert.equal(M.key(november), '2026-11');
  assert.equal(M.key(november + 2), '2027-01');
  assert.equal(M.parse('2026-13'), null);
  assert.equal(M.parse('nonsense'), null);
});

test('a day key becomes a day number and back', () => {
  const day = D.parse('2026-11-14');
  assert.equal(D.key(day), '2026-11-14');
  assert.equal(D.key(day + 20), '2026-12-04');
  assert.equal(D.parse('2026-02-31'), null);
});

test('without a payday a budget month is the calendar month', () => {
  const settings = { payDay: 0, payShift: 'none', payFor: 'same' };
  const november = M.parse('2026-11');
  assert.equal(D.key(Period.start(settings, november)), '2026-11-01');
  assert.equal(D.key(Period.end(settings, november)), '2026-11-30');
});

test('a salary on the 26th that pays for the next month: November runs 26 Oct to 25 Nov', () => {
  const settings = { payDay: 26, payShift: 'none', payFor: 'next' };
  const november = M.parse('2026-11');
  assert.equal(D.key(Period.start(settings, november)), '2026-10-26');
  assert.equal(D.key(Period.end(settings, november)), '2026-11-25');
  assert.equal(Period.of(settings, D.parse('2026-11-14')), november);
  assert.equal(Period.of(settings, D.parse('2026-11-26')), november + 1);
});

test('a payday on a weekend moves to the next working day when asked', () => {
  const settings = { payDay: 26, payShift: 'next', payFor: 'next' };
  // 26 Dec 2026 is a Saturday, so the salary (and the start of January's budget month) moves to Monday 28 Dec
  assert.equal(D.key(Period.start(settings, M.parse('2027-01'))), '2026-12-28');
});

/* Dates as text reuse their Intl formatters (a calendar writes a hundred dates per redraw). The text must stay
   exactly what toLocaleDateString gives, for every option the app uses, in any language. */
test('dates as text are exactly what toLocaleDateString gives', async () => {
  const { FMT } = await import('../../src/core/format.js');
  const before = FMT.dloc;
  const dayOptions = [
    undefined,
    { weekday: 'short' },
    { year: 'numeric' },
    { weekday: 'short', year: 'numeric' },
    { weekday: 'long', year: 'numeric' },
    { weekday: 'long', month: 'long' },
  ];
  const start = D.parse('2026-01-01');
  try {
    for (const locale of ['en-GB', 'en-US', 'de', 'es', 'fr', 'ja']) {
      FMT.dloc = locale;
      for (let n = start; n < start + 366; n += 5) {
        for (const o of dayOptions) {
          const expected = D.js(n).toLocaleDateString(locale, {
            timeZone: 'UTC',
            day: 'numeric',
            month: 'short',
            ...o,
          });
          assert.equal(D.label(n, o), expected, `${locale} ${D.key(n)} ${JSON.stringify(o)}`);
        }
        for (const width of ['long', 'short', 'narrow']) {
          assert.equal(
            D.fmt(n, { weekday: width }),
            D.js(n).toLocaleDateString(locale, { weekday: width, timeZone: 'UTC' }),
          );
        }
      }
      for (let k = M.parse('2026-01'); k < M.parse('2028-01'); k++) {
        assert.equal(M.label(k), M.date(k).toLocaleDateString(locale, { month: 'short', year: 'numeric' }));
        assert.equal(M.label(k, true), M.date(k).toLocaleDateString(locale, { month: 'long', year: 'numeric' }));
        assert.equal(M.short(k), M.date(k).toLocaleDateString(locale, { month: 'short' }));
      }
    }
  } finally {
    FMT.dloc = before;
  }
});

test('a change of language gives text in the new language at once', async () => {
  const { FMT } = await import('../../src/core/format.js');
  const before = FMT.dloc;
  const n = D.parse('2026-11-02');
  try {
    FMT.dloc = 'en-GB';
    assert.equal(D.fmt(n, { weekday: 'long' }), 'Monday');
    FMT.dloc = 'de';
    assert.equal(D.fmt(n, { weekday: 'long' }), 'Montag');
  } finally {
    FMT.dloc = before;
  }
});

/* The day helpers do calendar arithmetic without Date objects (they run tens of thousands of times per projection).
   These compare them with the Date-based way they replaced, on every day from 1900 to 2300. */
const ref = {
  of: (y, m, d) => Math.round(Date.UTC(y, m, d) / 864e5),
  key: n => new Date(n * 864e5).toISOString().slice(0, 10),
  dow: n => new Date(n * 864e5).getUTCDay(),
  month: n => {
    const d = new Date(n * 864e5);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  },
};

test('D.key, D.dow and D.month give exactly what Date gives, every day from 1900 to 2300', () => {
  for (let n = ref.of(1900, 0, 1); n <= ref.of(2300, 11, 31); n++) {
    if (D.key(n) !== ref.key(n) || D.dow(n) !== ref.dow(n) || D.month(n) !== ref.month(n)) {
      assert.fail(`day ${n}: ${D.key(n)} ${D.dow(n)} ${D.month(n)} vs ${ref.key(n)} ${ref.dow(n)} ${ref.month(n)}`);
    }
  }
});

test('D.of gives exactly what Date.UTC gives, overflowing days and months included', () => {
  for (let y = 1968; y <= 2203; y++) {
    for (let m = -13; m <= 25; m++) {
      for (const d of [-40, -1, 0, 1, 15, 28, 29, 30, 31, 32, 60, 400]) {
        if (D.of(y, m, d) !== ref.of(y, m, d)) {
          assert.fail(`D.of(${y}, ${m}, ${d}) = ${D.of(y, m, d)}, Date.UTC says ${ref.of(y, m, d)}`);
        }
      }
    }
  }
});

test('D.parse accepts real days only, as before', () => {
  for (let n = ref.of(1970, 0, 1); n <= ref.of(2200, 11, 31); n += 7) {
    assert.equal(D.parse(ref.key(n)), n);
  }
  for (const bad of [
    '2026-02-29',
    '2024-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '1969-12-31',
    '2201-01-01',
    '2026-1-01',
    'x',
    null,
    5,
  ]) {
    assert.equal(D.parse(bad), null, String(bad));
  }
  assert.equal(D.parse('2024-02-29'), ref.of(2024, 1, 29), 'leap day');
  assert.equal(D.parse('2100-02-29'), null, '2100 is not a leap year');
  assert.equal(D.parse('2000-02-29'), ref.of(2000, 1, 29), '2000 is');
});

test('D.inMonth: a day clamped to the month and moved off weekends, as before', () => {
  const refIn = (k, day, shift) => {
    const y = Math.floor(k / 12);
    const m = k % 12;
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    let n = ref.of(y, m, Math.min(Math.max(day, 1), dim));
    const weekend = x => [0, 6].includes(ref.dow(x));
    while (shift === 'next' && weekend(n)) {
      n++;
    }
    while (shift === 'prev' && weekend(n)) {
      n--;
    }
    return n;
  };
  for (let k = 2020 * 12; k < 2032 * 12; k++) {
    for (const day of [1, 15, 28, 29, 30, 31]) {
      for (const shift of ['none', 'next', 'prev']) {
        assert.equal(D.inMonth(k, day, shift), refIn(k, day, shift), `${M.key(k)} ${day} ${shift}`);
      }
    }
  }
});

test('impossible days still fail the way they did', () => {
  assert.throws(() => D.key(NaN));
  assert.ok(Number.isNaN(D.of(NaN, 0, 1)));
});
