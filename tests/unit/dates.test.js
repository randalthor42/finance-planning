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
