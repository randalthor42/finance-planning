/**
 * @file Money and number formatting and parsing for the active plan.
 */
import { I18N } from './i18n.js';
import { clamp, r2 } from './util.js';

/* --- formatting: display only, never stored --- */
export const FMT = {
  nloc: 'en-GB',
  dloc: 'en-GB',
  dec: '.',
  grp: ',',
  cur: 'EUR',
  cents: false,
  nf: null,
  nfc: null,
  nfn: null,
};
export function setFmt(S) {
  FMT.nloc = S.numFmt === 'us' ? 'en-US' : 'de-DE';
  FMT.dloc = I18N.lang !== 'en' ? I18N.lang : S.dateFmt === 'mdy' ? 'en-US' : 'en-GB';
  FMT.dec = S.numFmt === 'us' ? '.' : ',';
  FMT.grp = S.numFmt === 'us' ? ',' : '.';
  FMT.cur = S.currency;
  FMT.cents = S.cents;
  const d = S.cents ? 2 : 0;
  const mk = current => {
    FMT.nf = new Intl.NumberFormat(FMT.nloc, {
      style: 'currency',
      currency: current,
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
    FMT.nfc = new Intl.NumberFormat(FMT.nloc, {
      style: 'currency',
      currency: current,
      notation: 'compact',
      maximumFractionDigits: 1,
    });
  };
  try {
    mk(FMT.cur);
  } catch (e) {
    mk('EUR');
  }
  FMT.nfn = new Intl.NumberFormat(FMT.nloc, { maximumFractionDigits: 2, useGrouping: true });
}
export const money = n => {
  const v = FMT.cents ? r2(n) : Math.round(n);
  return FMT.nf.format(v || 0);
};
export const signed = n => (Math.round(n * (FMT.cents ? 100 : 1)) > 0 ? '+' : '') + money(n);
export const compact = n => FMT.nfc.format(Math.round(n) || 0);
export const fmtNum = n => FMT.nfn.format(r2(n));
/** Free-text money parser for pasted text. Accepts "1.234,56", "1,234.56", "12,5" and sums like "120+35". Never NaN, never negative. */
export function parseMoney(s) {
  if (typeof s === 'number') {
    return isFinite(s) ? Math.max(0, r2(s)) : 0;
  }
  let total = 0;
  for (let part of String(s).split('+')) {
    part = part.replace(/[^\d.,]/g, '');
    const c = part.lastIndexOf(',');
    const d = part.lastIndexOf('.');
    if (c > -1 && d > -1) {
      part = c > d ? part.replace(/\./g, '').replace(',', '.') : part.replace(/,/g, '');
    } else if (c > -1) {
      part = /,\d{1,2}$/.test(part) ? part.replace(',', '.') : part.replace(/,/g, '');
    } else if ((part.match(/\./g) || []).length > 1) {
      part = part.replace(/\./g, '');
    }
    const v = parseFloat(part);
    if (isFinite(v)) {
      total += v;
    }
  }
  return clamp(r2(total), 0, 1e9);
}
