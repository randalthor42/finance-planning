/**
 * @file Small pure helpers. No DOM, no state.
 */
export const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
export const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100 || 0;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export const uid = () => {
  const a = crypto.getRandomValues(new Uint32Array(2));
  return (a[0].toString(36) + a[1].toString(36)).padEnd(8, '0').slice(0, 10);
};
/**
 * A random UUID, for a record saved without an id (models/plan.js). crypto.randomUUID needs a secure context (https,
 * localhost, a file); elsewhere the same version 4 format is built from crypto.getRandomValues.
 */
export const newId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map(n => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
/** A record or plan id: the short ids the app makes (uid), or a UUID (newId). */
export const ID_RE = /^(?:[a-z0-9]{4,16}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const pmt = (P, r, n) => (r ? (P * r) / (1 - Math.pow(1 + r, -n)) : P / n);

/*i18n:off*/
/* --- translations ---------------------------------------------------------------------------------------
   Every piece of text shown to the user goes through $t('English text', value0, value1…).
   The English text IS the key, so the code stays readable and a missing translation falls back to English.
   Values are written {0}, {1}… in the text; a translation may move them around.
   Counted words use plural(n, 'month'): keys '#month:one', '#month:other' (and '#month:few', '#month:many'
   for languages that need them; the category comes from Intl.PluralRules for that language).
   Language packs are plain JSON, kept apart from the plan data under their own storage key.
   The language is read once, here, before anything else is defined; changing it reloads the page.           */
