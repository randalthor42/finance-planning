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
/**
 * Number formats, one per locale and set of options: building an Intl.NumberFormat is slow (the first one also loads
 * the locale's data), and setFmt runs on every recalculation, so each is made once and kept.
 */
const numberFormats = new Map();
function numberFormat(locale, options) {
  const key =
    locale +
    '|' +
    options.style +
    '|' +
    options.currency +
    '|' +
    options.notation +
    '|' +
    options.minimumFractionDigits +
    '|' +
    options.maximumFractionDigits +
    '|' +
    options.useGrouping;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}
export function setFmt(S) {
  FMT.nloc = S.numFmt === 'us' ? 'en-US' : 'de-DE';
  FMT.dloc = I18N.lang !== 'en' ? I18N.lang : S.dateFmt === 'mdy' ? 'en-US' : 'en-GB';
  FMT.dec = S.numFmt === 'us' ? '.' : ',';
  FMT.grp = S.numFmt === 'us' ? ',' : '.';
  FMT.cur = S.currency;
  FMT.cents = S.cents;
  const d = S.cents ? 2 : 0;
  const money = currency =>
    numberFormat(FMT.nloc, { style: 'currency', currency, minimumFractionDigits: d, maximumFractionDigits: d });
  try {
    FMT.nf = money(FMT.cur);
  } catch (e) {
    FMT.nf = money('EUR'); // a currency this browser does not know: amounts in euros, the code as typed elsewhere
  }
  FMT.nfc = null; // compact amounts (chart axes): made when first used
  FMT.nfn = numberFormat(FMT.nloc, { maximumFractionDigits: 2, useGrouping: true });
}
export const money = n => {
  const v = FMT.cents ? r2(n) : Math.round(n);
  return FMT.nf.format(v || 0);
};
export const signed = n => (Math.round(n * (FMT.cents ? 100 : 1)) > 0 ? '+' : '') + money(n);
/**
 * An amount in short form, for chart axes: rounded to whole units, then written in the plan's currency and number
 * locale with compact notation (for example "€1.2K"). Never NaN: a missing amount is 0.
 * @param {number} n the amount
 * @returns {string}
 */
export const compact = n => {
  if (!FMT.nfc) {
    const currency = FMT.nf.resolvedOptions().currency;
    FMT.nfc = numberFormat(FMT.nloc, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  }
  return FMT.nfc.format(Math.round(n) || 0);
};
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
