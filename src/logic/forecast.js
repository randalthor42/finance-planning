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
 * @param {{months: import('../types.js').Month[]}} projection The plan as projected.
 * @param {number} currentPosition Position of the current month in projection.months.
 * @param {{type: 'pace'|'cautious', sampleMonths?: number, percent?: number}} scenario
 *   pace:     the next `sampleMonths` months are taken as they are planned. After them, no month is allowed to leave
 *             more than those months leave on average. A month the plan already makes worse than that stays worse.
 *   cautious: from the current month on, every cost is `percent` % higher than planned.
 * @returns {{rows: {k: number, key: string, planLeft: number, left: number, planClose: number, close: number}[], average: ?number}}
 */
export function forecastScenario(projection, currentPosition, scenario) {
  const months = projection.months;
  const rows = [];
  let average = null;

  if (scenario.type === 'pace') {
    const sampleSize = Math.max(1, Math.min(scenario.sampleMonths || 4, months.length - currentPosition));
    const sample = months.slice(currentPosition, currentPosition + sampleSize);
    average = r2(sample.reduce((sum, month) => sum + leftOver(month), 0) / sample.length);
  }

  let balance = months.length ? months[0].open : 0;
  months.forEach((month, position) => {
    const planLeft = leftOver(month);
    let left = planLeft;
    if (scenario.type === 'pace' && position >= currentPosition + (scenario.sampleMonths || 4)) {
      left = Math.min(planLeft, average);
    }
    if (scenario.type === 'cautious' && position >= currentPosition) {
      left = r2(planLeft - (month.out * (scenario.percent || 0)) / 100);
    }
    balance = r2(balance + left);
    rows.push({ k: month.k, key: month.key, planLeft, left: r2(left), planClose: month.close, close: balance });
  });
  return { rows, average };
}
