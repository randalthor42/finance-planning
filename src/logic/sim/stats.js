/**
 * @file Robust statistics for the simulation. Spending is skewed and has outliers, so the middle is the median and
 * the spread the median absolute deviation (MAD) and percentiles, never a mean and a standard deviation. Pure.
 */
import { r2 } from '../../core/util.js';

const sortedCopy = values => Float64Array.from(values).sort();

/**
 * The value `q` (0…1) of the way through sorted values, between neighbours (type 7, as spreadsheets do). 0 when empty.
 * @returns {number}
 */
export function quantile(sorted, q) {
  const n = sorted.length;
  if (!n) {
    return 0;
  }
  const at = (n - 1) * Math.min(1, Math.max(0, q));
  const low = Math.floor(at);
  const high = Math.min(n - 1, low + 1);
  return sorted[low] + (at - low) * (sorted[high] - sorted[low]);
}

/**
 * The middle value. 0 when empty.
 * @returns {number}
 */
export const median = values => quantile(sortedCopy(values), 0.5);

/**
 * Median absolute deviation: the median distance from the median. One wild month barely moves it.
 * @returns {number}
 */
export function mad(values) {
  if (values.length < 2) {
    return 0;
  }
  const middle = median(values);
  return median(values.map(v => Math.abs(v - middle)));
}

/**
 * Everything shown about a list of monthly amounts: count, median, MAD, 10th to 90th percentile, mean (for reference).
 * @returns {{n: number, median: number, mad: number, p10: number, p25: number, p75: number, p90: number, mean: number}}
 */
export function describe(values) {
  const sorted = sortedCopy(values);
  const n = sorted.length;
  return {
    n,
    median: r2(quantile(sorted, 0.5)),
    mad: r2(mad(values)),
    p10: r2(quantile(sorted, 0.1)),
    p25: r2(quantile(sorted, 0.25)),
    p75: r2(quantile(sorted, 0.75)),
    p90: r2(quantile(sorted, 0.9)),
    mean: n ? r2(values.reduce((s, v) => s + v, 0) / n) : 0,
  };
}
