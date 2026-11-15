/**
 * @file Questions asked of a projection: room to spend, first month a cost fits, budget trends. Pure.
 */
import { M } from '../core/dates.js';
import { r2 } from '../core/util.js';

/** Spare money from each month on: the lowest month-end balance from that month to the end of the plan, minus the cushion. */
export function roomSeries(proj, cushion) {
  const out = [];
  let lo = Infinity;
  for (let i = proj.months.length - 1; i >= 0; i--) {
    lo = Math.min(lo, proj.months[i].close);
    out[i] = r2(lo - cushion);
  }
  return out;
}
/** Earliest month (from fromK) in which a one-off cost fits without any later month dropping under the cushion. null = not within the plan. */
export function firstFit(proj, cushion, cost, fromK) {
  const room = roomSeries(proj, cushion);
  const s0 = proj.summary.s0;
  for (let i = Math.max(0, fromK - s0); i < room.length; i++) {
    if (room[i] >= cost) {
      return s0 + i;
    }
  }
  return null;
}
/** Budgets whose real spending over the last finished months differs clearly from the budget. Needs at least 2 months with logged spends. */
export function budgetTrend(plan, nowK) {
  const out = [];
  for (const b of plan.bills) {
    if (!b.budget || !b.amount) {
      continue;
    }
    const sums = [];
    for (let k = nowK - 3; k < nowK; k++) {
      const v = plan.items.reduce(
        (a, item) => a + (item.budget === b.id && item.month === M.key(k) ? item.amount : 0),
        0,
      );
      if (v > 0) {
        sums.push(v);
      }
    }
    if (sums.length < 2) {
      continue;
    }
    const avg = r2(sums.reduce((a, v) => a + v, 0) / sums.length);
    if (Math.abs(avg - b.amount) / b.amount >= 0.1) {
      out.push({ id: b.id, name: b.name, amount: b.amount, avg, months: sums.length });
    }
  }
  return out;
}
