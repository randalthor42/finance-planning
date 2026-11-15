/**
 * @file Forecast scenarios: other ways to look ahead than "everything goes exactly to plan". Pure.
 *
 * Why this exists: a plan lists the costs you already know. Later months usually look better than they will be,
 * simply because their surprises are not in the plan yet. A scenario replaces what later months leave over with a
 * more careful assumption and carries the difference forward.
 */
import { r2 } from '../core/util.js';

/** What a month really leaves over in the plan: income minus costs, plus any correction from real money. */
const leftOver = month => r2(month.close - month.open);

/**
 * Simple exponential smoothing: an average in which each older month counts for less.
 *   level = alpha * value + (1 - alpha) * previous level
 * A high alpha follows the latest months closely; a low alpha is close to a plain average.
 * @param {number[]} series Oldest first.
 * @param {number} alpha Between 0 and 1.
 * @returns {number} The smoothed level after the last value.
 */
export function smoothedLevel(series, alpha) {
  let level = series[0];
  for (let position = 1; position < series.length; position++) {
    level = alpha * series[position] + (1 - alpha) * level;
  }
  return level;
}

/**
 * Damped trend (Holt's linear method with Gardner and McKenzie's damping). It follows a level and a slope, and
 * lets the slope fade out: the forecast h months ahead is
 *   level + (phi + phi^2 + ... + phi^h) * trend
 * Damping matters here: a plain straight line through three or four months would run away to absurd values.
 * The parameters are fixed, not fitted, because a handful of months is far too little data to fit them honestly.
 * @param {number[]} series Oldest first.
 * @returns {{level: number, trend: number, ahead: (months: number) => number}}
 */
export function dampedTrend(series, { alpha = 0.5, beta = 0.3, phi = 0.85 } = {}) {
  let level = series[0];
  let trend = series.length > 1 ? series[1] - series[0] : 0;
  for (let position = 1; position < series.length; position++) {
    const previousLevel = level;
    level = alpha * series[position] + (1 - alpha) * (previousLevel + phi * trend);
    trend = beta * (level - previousLevel) + (1 - beta) * phi * trend;
  }
  const ahead = months => {
    let damping = 0;
    for (let step = 1; step <= months; step++) {
      damping += Math.pow(phi, step);
    }
    return level + damping * trend;
  };
  return { level, trend, ahead };
}

/** A small repeatable random number generator (mulberry32), so the same plan always gives the same simulation. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** The value below which the given share of a sorted list falls (0.1 = the "1 in 10" low). */
const percentile = (sorted, share) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(share * sorted.length)))];

/**
 * Range of outcomes (Monte Carlo simulation with bootstrapped shocks).
 * The middle path is the "recent pace" scenario. Around it, every later month gets a random shock drawn from how
 * far the sample months themselves were from their average: months that swing a lot give a wide range, steady
 * months a narrow one. Many runs give, for every month, a low (1 in 10 worse), a middle and a high (1 in 10 better).
 * `chanceBelowZero` is the share of runs in which the balance goes below zero in any month after the sample months.
 * @returns {{rows: {k: number, key: string, planClose: number, low: number, middle: number, high: number}[], chanceBelowZero: number, average: number}}
 */
export function forecastRange(projection, currentPosition, { sampleMonths = 4, runs = 2000, seed = 20261114 } = {}) {
  const months = projection.months;
  const sampleSize = Math.max(1, Math.min(sampleMonths, months.length - currentPosition));
  const sample = months.slice(currentPosition, currentPosition + sampleSize).map(leftOver);
  const average = r2(sample.reduce((sum, value) => sum + value, 0) / sample.length);
  const shocks = sample.map(value => value - average);
  const random = seededRandom(seed);
  const firstRandomMonth = currentPosition + sampleSize;
  const startBalance = months.length ? months[0].open : 0;

  // balances[month position] collects the end balance of every run
  const balances = months.map(() => []);
  let runsBelowZero = 0;
  for (let run = 0; run < runs; run++) {
    let balance = startBalance;
    let wentBelowZero = false;
    months.forEach((month, position) => {
      let left = leftOver(month);
      if (position >= firstRandomMonth) {
        const shock = shocks[Math.floor(random() * shocks.length)];
        left = Math.min(left, average) + shock;
      }
      balance += left;
      // only the simulated months count: a sample month that the plan itself puts below zero is not a matter of chance
      if (position >= firstRandomMonth && balance < 0) {
        wentBelowZero = true;
      }
      balances[position].push(balance);
    });
    if (wentBelowZero) {
      runsBelowZero++;
    }
  }

  const rows = months.map((month, position) => {
    const sorted = balances[position].sort((a, b) => a - b);
    return {
      k: month.k,
      key: month.key,
      planClose: month.close,
      low: r2(percentile(sorted, 0.1)),
      middle: r2(percentile(sorted, 0.5)),
      high: r2(percentile(sorted, 0.9)),
    };
  });
  return { rows, chanceBelowZero: runs ? runsBelowZero / runs : 0, average };
}

/**
 * Cost overrun measured against reality (budget variance analysis; the same idea as the cost performance index in
 * earned value management). In every month you checked against real money, the correction is spending the plan did
 * not have. Divided by the planned costs that were paid by then, it says how much more you really spend per planned euro.
 * @returns {?number} For example 0.25 = you spend 25% more than the plan says. null when no month has been checked.
 */
export function overrunRate(projection) {
  let unplanned = 0;
  let plannedAndPaid = 0;
  for (const month of projection.months) {
    if (month.fix && month.fix.a < 0) {
      unplanned += -month.fix.a;
      plannedAndPaid += month.paidOut;
    }
  }
  return plannedAndPaid > 0 ? unplanned / plannedAndPaid : null;
}

/**
 * @param {{months: import('../types.js').Month[]}} projection The plan as projected.
 * @param {number} currentPosition Position of the current month in projection.months.
 * @param {{type: 'pace'|'smooth'|'trend'|'cautious'|'income'|'variance', sampleMonths?: number, percent?: number, alpha?: number}} scenario
 *   pace:     the next `sampleMonths` months are taken as they are planned. After them, no month is allowed to leave
 *             more than those months leave on average. A month the plan already makes worse than that stays worse.
 *   smooth:   like pace, but the average weights the latest sample months more (simple exponential smoothing).
 *   trend:    like pace, but follows where the sample months are heading, with the slope fading out (damped trend).
 *   cautious: from the current month on, every cost is `percent` % higher than planned.
 *   income:   from the current month on, income is `percent` % lower than planned (fewer hours, a gap between jobs).
 *   variance: every cost still to come is raised by the overrun measured so far (see overrunRate).
 * @returns {{rows: {k: number, key: string, planLeft: number, left: number, planClose: number, close: number}[], average: ?number}}
 */
export function forecastScenario(projection, currentPosition, scenario) {
  const months = projection.months;
  const rows = [];
  const usesSample = scenario.type === 'pace' || scenario.type === 'smooth' || scenario.type === 'trend';
  const sampleSize = Math.max(1, Math.min(scenario.sampleMonths || 4, months.length - currentPosition));
  const firstLaterMonth = currentPosition + sampleSize;
  let average = null;
  let trendModel = null;
  const overrun = scenario.type === 'variance' ? overrunRate(projection) : null;
  const unpaidCosts = month =>
    month.entries.reduce((sum, entry) => sum + (!entry.paid && entry.amount < 0 ? -entry.amount : 0), 0);

  if (usesSample) {
    const sample = months.slice(currentPosition, firstLaterMonth).map(leftOver);
    if (scenario.type === 'smooth') {
      average = r2(smoothedLevel(sample, scenario.alpha || 0.5));
    } else {
      average = r2(sample.reduce((sum, value) => sum + value, 0) / sample.length);
    }
    if (scenario.type === 'trend') {
      trendModel = dampedTrend(sample);
    }
  }

  let balance = months.length ? months[0].open : 0;
  months.forEach((month, position) => {
    const planLeft = leftOver(month);
    let left = planLeft;
    if (usesSample && position >= firstLaterMonth) {
      // the ceiling for this month: the average, or for the trend how many months it lies past the sample
      const ceiling = trendModel ? trendModel.ahead(position - firstLaterMonth + 1) : average;
      left = Math.min(planLeft, ceiling);
    }
    if (scenario.type === 'cautious' && position >= currentPosition) {
      left = r2(planLeft - (month.out * (scenario.percent || 0)) / 100);
    }
    if (scenario.type === 'income' && position >= currentPosition) {
      left = r2(planLeft - (month.inc * (scenario.percent || 0)) / 100);
    }
    if (scenario.type === 'variance' && overrun !== null && position >= currentPosition) {
      // in the current month only the costs that are not paid yet can still overrun
      const costsToCome = position === currentPosition ? unpaidCosts(month) : month.out;
      left = r2(planLeft - costsToCome * overrun);
    }
    balance = r2(balance + left);
    rows.push({ k: month.k, key: month.key, planLeft, left: r2(left), planClose: month.close, close: balance });
  });
  return { rows, average, overrun };
}
