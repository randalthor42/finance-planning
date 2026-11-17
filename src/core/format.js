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
  /** Amounts are hidden on screen (Settings › Lock and privacy, "Hide amounts until tapped"): money() shows MASK. */
  hidden: false,
  /** Finds a formatted amount inside a text (maskMoney), made by setFmt for the plan's currency and number format. */
  amountRe: null,
};
/** What a hidden amount shows instead. */
export const MASK = '•••';
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
  FMT.amountRe = amountPattern();
  FMT.nfn = new Intl.NumberFormat(FMT.nloc, { maximumFractionDigits: 2, useGrouping: true });
}
/** An amount as text, always: for what must keep it even while amounts are hidden (the activity log). */
export const plainMoney = n => {
  const v = FMT.cents ? r2(n) : Math.round(n);
  return FMT.nf.format(v || 0);
};
/** An amount to show: MASK while amounts are hidden. So are signed and compact amounts. Numbers in fields are not. */
export const money = n => (FMT.hidden ? MASK : plainMoney(n));
export const signed = n => {
  if (FMT.hidden) {
    return MASK;
  }
  const scale = FMT.cents ? 100 : 1;
  const sign = Math.round(n * scale) > 0 ? '+' : '';
  return sign + plainMoney(n);
};
export const compact = n => (FMT.hidden ? MASK : FMT.nfc.format(Math.round(n) || 0));
/**
 * The same text with every formatted amount in it masked, while amounts are hidden: for texts written before (a
 * notification, a line of the activity log). Only what looks like an amount of the plan's currency is masked; dates
 * and counts stay.
 */
export const maskMoney = text => (FMT.hidden && FMT.amountRe ? String(text).replace(FMT.amountRe, MASK) : String(text));

/** A pattern for an amount as FMT.nf writes it: the currency on either side of the number, a sign before either. */
function amountPattern() {
  const parts = FMT.nf.formatToParts(-1234.5);
  const currency = parts.find(p => p.type === 'currency').value;
  const esc = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sym = esc(currency);
  const num = `\\d[\\d${esc(FMT.grp)}]*(?:${esc(FMT.dec)}\\d+)?`;
  const sign = '[+\\-\u2212]?';
  const gap = '[\\s\u00a0\u202f]?';
  return new RegExp(`${sign}${sym}${gap}${sign}${num}|${sign}${num}${gap}${sym}`, 'g');
}
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
