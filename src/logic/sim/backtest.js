/**
 * @file Backtest: would the simulation have seen the last months coming? Pure and seeded.
 *
 * The latest `hold` (3) complete months are hidden; the model is learned from the months before them only (fitModel
 * with an earlier `now`), their spending is simulated (everyday spending and large irregular expenses: the part the
 * model learns; the plan's certain lines are known anyway), and what really happened is compared with the bands:
 * cumulative spending after 1, 2 and 3 months against the 50% band (25th–75th percentile) and the 90% band (5th–95th).
 *
 * One window of 3 months says little, so the same is done from every earlier starting point that has enough
 * history before it (at most ORIGINS of them, rolling origin): how often reality fell inside the 50% and 90% bands
 * is the calibration. About half and nine in ten is trustworthy; far fewer means the bands are too narrow for this
 * person's data (or their habits changed). Overrides are not used: this checks what was learned, not the person's
 * own values.
 */
import { M } from '../../core/dates.js';
import { mulberry32 } from '../../core/random.js';
import { r2 } from '../../core/util.js';
import { MIN_MONTHS, creditIdsOf, fitModel, isCashSpend } from './fit.js';
import { drawSpending, effectiveModel } from './engine.js';
import { quantile } from './stats.js';

/** Starting points checked at most (the latest ones). */
const ORIGINS = 12;
/** Fewer checks than this: not enough to call the model trustworthy or not. */
const MIN_CHECKS = 5;

/** What was really spent in month k: every purchase and spend, as the model counts it (cash, not card purchases). */
function spentIn(plan, k) {
  const key = M.key(k);
  const credit = creditIdsOf(plan);
  let sum = 0;
  for (const i of plan.items) {
    if (i.month === key && isCashSpend(i, credit)) {
      sum += i.amount;
    }
  }
  return r2(sum);
}

/** The simulated cumulative spending bands for `hold` months after month `cutoff`, from a model learned up to it. */
function bandsAfter(plan, cutoff, hold, runs, seed) {
  const model = fitModel(plan, { now: cutoff + 1 });
  if (model.window.months < MIN_MONTHS) {
    return null;
  }
  // what was learned, without the person's own values: this checks the learning
  const eff = effectiveModel(model, { cats: {}, events: {}, incomes: {} });
  const random = mulberry32(seed);
  const cumulative = Array.from({ length: hold }, () => new Float64Array(runs));
  for (let r = 0; r < runs; r++) {
    let sum = 0;
    for (let h = 0; h < hold; h++) {
      sum += drawSpending(eff, random, 1).total;
      cumulative[h][r] = sum;
    }
  }
  return cumulative.map(values => {
    const sorted = values.sort();
    const q = p => r2(quantile(sorted, p));
    return { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
  });
}

/**
 * @param {import('../../types.js').Plan} plan
 * @param {{now: number, hold?: number, runs?: number, seed?: number}} o
 * @returns {{status: 'ok'|'notEnough', months?: object[], latest?: string, calibration?: string, verdict?: string, coverage50?: ?number, coverage90?: ?number, checks?: number}}
 *   months: for each hidden month, the bands and what really happened (`inside50`, `inside90`); latest: 'good' (all
 *   inside the 90% band), 'fair' (one outside), 'poor'; calibration over every starting point: 'good', 'fair',
 *   'poor' or 'unknown' (too few checks); verdict: what the page says about trusting it (verdictOf).
 */
export function backtest(plan, { now, hold = 3, runs = 1000, seed = 1 }) {
  const last = now - 1;
  const cutoff = last - hold;
  const latestBands = bandsAfter(plan, cutoff, hold, runs, seed);
  if (!latestBands) {
    return { status: 'notEnough', hold };
  }
  const compare = (bands, from) => {
    let actual = 0;
    return bands.map((b, h) => {
      actual = r2(actual + spentIn(plan, from + h + 1));
      return {
        k: from + h + 1,
        ...b,
        actual,
        inside50: actual >= b.p25 && actual <= b.p75,
        inside90: actual >= b.p5 && actual <= b.p95,
      };
    });
  };
  const months = compare(latestBands, cutoff);
  const outside = months.filter(m => !m.inside90).length;

  // every starting point with enough history before it: how often reality fell inside the bands
  let inside50 = 0;
  let inside90 = 0;
  let checks = 0;
  for (let c = cutoff; c > cutoff - ORIGINS; c--) {
    const ahead = Math.min(hold, last - c);
    const bands = c === cutoff ? latestBands : bandsAfter(plan, c, ahead, runs, seed);
    if (!bands) {
      break;
    }
    for (const m of compare(bands, c)) {
      checks++;
      inside50 += m.inside50 ? 1 : 0;
      inside90 += m.inside90 ? 1 : 0;
    }
  }
  const coverage50 = checks ? inside50 / checks : null;
  const coverage90 = checks ? inside90 / checks : null;
  let calibration = 'unknown';
  if (checks >= MIN_CHECKS) {
    if (coverage90 >= 0.8 && coverage50 >= 0.3 && coverage50 <= 0.8) {
      calibration = 'good';
    } else if (coverage90 >= 0.6) {
      calibration = 'fair';
    } else {
      calibration = 'poor';
    }
  }
  let latest = 'poor';
  if (outside === 0) {
    latest = 'good';
  } else if (outside === 1) {
    latest = 'fair';
  }
  return {
    status: 'ok',
    hold,
    months,
    latest,
    calibration,
    verdict: verdictOf(latest, calibration),
    coverage50,
    coverage90,
    checks,
  };
}

const RANK = { good: 2, fair: 1, poor: 0 };
/**
 * Whether to trust the simulation now: the worse of the latest months and every earlier check. A model that fitted
 * well for a year but missed the last months (habits changed) is not trustworthy now. With too few checks for a
 * calibration, only a clear miss is said ('poor'); otherwise 'unknown'.
 * @returns {'good'|'fair'|'poor'|'unknown'} the verdict
 */
export function verdictOf(latest, calibration) {
  if (calibration === 'unknown') {
    return latest === 'poor' ? 'poor' : 'unknown';
  }
  return RANK[latest] <= RANK[calibration] ? latest : calibration;
}
