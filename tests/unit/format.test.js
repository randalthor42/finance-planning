/**
 * @file Unit tests for reading amounts typed by the user. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney } from '../../src/core/format.js';
import { r2, pmt } from '../../src/core/util.js';

test('parseMoney reads plain numbers', () => {
  assert.equal(parseMoney('1234'), 1234);
  assert.equal(parseMoney('12.5'), 12.5);
});

test('parseMoney reads both European and US notation', () => {
  assert.equal(parseMoney('1.234,56'), 1234.56);
  assert.equal(parseMoney('12,5'), 12.5);
});

test('parseMoney gives 0 for empty or unreadable text, so a form never stores NaN', () => {
  assert.equal(parseMoney(''), 0);
  assert.equal(parseMoney('abc'), 0);
});

test('r2 rounds to cents without floating point surprises', () => {
  assert.equal(r2(0.1 + 0.2), 0.3);
  assert.equal(r2(1.005), 1.01);
});

test('pmt is the standard loan payment formula', () => {
  assert.equal(r2(pmt(1200, 0, 12)), 100); // no interest: the amount divided by the months
  assert.equal(r2(pmt(10000, 0.06 / 12, 12)), 860.66);
});

test('formatters are made once per set of settings, and the compact one only when it is used', async () => {
  const { FMT, compact, money, setFmt } = await import('../../src/core/format.js');
  const settings = { currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy', cents: true };
  setFmt(settings);
  const nf = FMT.nf;
  const nfn = FMT.nfn;
  setFmt({ ...settings });
  assert.ok(FMT.nf === nf && FMT.nfn === nfn, 'the same objects');
  assert.equal(
    money(1234.5),
    new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.5),
  );
  assert.equal(
    compact(25400),
    new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(25400),
  );
  setFmt({ ...settings, numFmt: 'us', currency: 'USD', cents: false });
  assert.notEqual(FMT.nf, nf);
  assert.equal(money(1234.5), '$1,235');
  assert.equal(compact(25400), '$25.4K');
  setFmt({ ...settings, currency: 'NOPE' });
  const euros = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  assert.equal(money(1), euros.format(1), 'an unknown currency falls back to euros');
  assert.equal(FMT.cur, 'NOPE', 'the code stays as typed');
});
