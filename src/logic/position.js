/**
 * @file Where a month stands: the one decomposition of a month that every screen shows (Overview, Month planner,
 * Accounts). Pure. Before this, each view split the month its own way and the same quantity showed different values.
 */
import { r2 } from '../core/util.js';

/**
 * Splits a month into the equation shown on screen:
 *   now + comingIn − toPay − budgetsLeft = close
 * It holds exactly because the engine sets close = now + Σ still (`still` is what each unpaid line has left):
 * positive leftovers are money still coming in, negative ones are still to pay, and a budget's leftover is what it
 * still holds back. Amounts are positive; the signs are in the equation.
 * @param {import('../types.js').Month} month
 * @param {number} today day number
 * @returns {{now: number, comingIn: number, toPay: number, budgetsLeft: number, close: number,
 *   daysLeft: number, perDay: number, inside: boolean}}
 *   daysLeft counts today; perDay is budgetsLeft spread over the days left (0 when the month is over).
 */
export function monthPosition(month, today) {
  let comingIn = 0;
  let toPay = 0;
  let budgetsLeft = 0;
  for (const entry of month.entries) {
    const still = entry.still || 0;
    if (!still) {
      continue;
    }
    if (entry.budget) {
      budgetsLeft -= still;
    } else if (still > 0) {
      comingIn += still;
    } else {
      toPay -= still;
    }
  }
  const length = month.end - month.start + 1;
  const inside = today >= month.start && today <= month.end;
  let daysLeft = 0;
  if (inside) {
    daysLeft = month.end - today + 1;
  } else if (today < month.start) {
    daysLeft = length;
  }
  budgetsLeft = r2(budgetsLeft);
  return {
    now: month.now,
    comingIn: r2(comingIn),
    toPay: r2(toPay),
    budgetsLeft,
    close: month.close,
    daysLeft,
    perDay: daysLeft > 0 ? r2(budgetsLeft / daysLeft) : 0,
    inside,
  };
}
