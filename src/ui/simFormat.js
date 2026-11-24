/**
 * @file Numbers of the simulation without false precision (Forecast › Simulation): chances rounded, amounts of the
 * future to two significant figures, in the plan's currency and number format.
 */
import { money } from '../core/format.js';
import { $t } from '../core/i18n.js';

/**
 * A chance: "under 1%", "7%", "35%" (to 5% from one in ten up), "over 99%"; never "0%" or "100%".
 * @returns {string}
 */
export function chance(p) {
  if (p < 0.01) {
    return $t('under 1%');
  }
  if (p > 0.99) {
    return $t('over 99%');
  }
  if (p < 0.1) {
    return Math.round(p * 100) + '%';
  }
  return Math.round(p * 20) * 5 + '%';
}
/**
 * A chance inside a sentence: "about 35%", but "under 1%" and "over 99%" as they are (never "about under 1%").
 * @returns {string}
 */
export function chanceAbout(p) {
  return p < 0.01 || p > 0.99 ? chance(p) : $t('about {0}', chance(p));
}
/**
 * An amount of the future: two significant figures (4 321 → 4 300), in the plan's currency and number format.
 * @returns {string}
 */
export function rough(v) {
  const a = Math.abs(v);
  if (a < 10) {
    return money(Math.round(v));
  }
  const step = 10 ** Math.max(0, Math.floor(Math.log10(a)) - 1);
  return money(Math.round(v / step) * step);
}
