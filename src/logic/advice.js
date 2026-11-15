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

/**
 * Does a set of extra cash lines (a wish paid one way, say) break any month, worked out from the plan without it?
 * A month's status depends only on its closing balance against zero and the cushion, and extra cash lines lower every
 * later close by their running total, so this needs no new projection: one pass over the months.
 * Same answer as projecting the plan with the lines and comparing statuses (unit-tested); the caller still confirms
 * the month it picks with one full projection.
 * @param {{months: {k: number, close: number, status: string}[]}} base the projection without the lines
 * @param {{k: number, amount: number}[]} rows cash out by month (positive amounts)
 * @param {number} cushion
 * @returns {'good'|'warn'|'bad'} bad: a month newly below zero; warn: a month newly under the cushion; good: neither
 */
export function screenExtraCost(base, rows, cushion) {
  const byMonth = new Map();
  for (const row of rows) {
    byMonth.set(row.k, (byMonth.get(row.k) || 0) + row.amount);
  }
  let spent = 0;
  let tone = 'good';
  for (const month of base.months) {
    spent = r2(spent + (byMonth.get(month.k) || 0));
    const close = r2(month.close - spent);
    if (close < 0 && month.status !== 'neg') {
      return 'bad';
    }
    if (close >= 0 && close < cushion && month.status === 'ok') {
      tone = 'warn';
    }
  }
  return tone;
}
