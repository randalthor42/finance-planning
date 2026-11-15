/**
 * @file Wishlist maths. Pure.
 */
import { M } from '../core/dates.js';
import { $t } from '../core/i18n.js';
import { pmt, r2 } from '../core/util.js';

/**
 * A wishlist item bought one of three ways. Pure. Returns the cash rows it causes plus what it costs in total.
 *   cash:    the whole price in the buy month
 *   finance: `months` instalments starting in the buy month (apr 0 = interest-free; otherwise a normal annuity)
 *   save:    set the price aside in equal parts over the `months` before the buy month, then buy from that pot
 */
export function wishCalc(W, s0, how) {
  how = how || W.how;
  const k = M.parse(W.month);
  const n = W.months;
  const key = 'wish:' + W.id;
  const rows = [];
  let total = W.price;
  let monthly = 0;
  let owed = () => 0;
  let pot = () => 0;
  if (how === 'finance') {
    const pay = r2(pmt(W.price, W.apr / 1200, n));
    monthly = pay;
    total = W.apr ? pay * n : W.price;
    for (let i = 0; i < n; i++) {
      rows.push({
        k: k + i,
        key,
        amount: i === n - 1 ? r2(total - pay * (n - 1)) : pay,
        sub: $t('Instalment {0} of {1}', i + 1, n),
      });
    }
    owed = kk => (kk < k ? 0 : Math.max(0, n - (kk - k + 1)) * pay);
  } else if (how === 'save' && k - Math.max(s0, k - n) > 0) {
    const first = Math.max(s0, k - n);
    const cnt = k - first;
    const per = r2(W.price / cnt);
    monthly = per;
    for (let i = 0; i < cnt; i++) {
      rows.push({
        k: first + i,
        key,
        amount: i === cnt - 1 ? r2(W.price - per * (cnt - 1)) : per,
        sub: $t('Saving up, {0} of {1}', i + 1, cnt),
      });
    }
    pot = kk => (kk < first || kk >= k ? 0 : (kk - first + 1) * per);
  } else {
    rows.push({ k, key, amount: W.price, sub: $t('Bought in one go') });
  }
  return { how, rows, total, monthly, extraCost: total - W.price, owed, pot, buyK: k };
}
