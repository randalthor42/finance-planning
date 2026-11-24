/**
 * @file What the simulation starts from: the plan's own months (the projection), split into what is certain and what
 * the simulation replaces. Pure.
 *
 * Certain (taken as planned): bills and subscriptions, loans, planned one-offs, trips, wishes, counted appointments,
 * money brought in to cover a month. These are "recurring items" and known plans: the plan already knows them.
 * Replaced by the simulation:
 * - budget lines: the plan sets an amount aside; the simulation uses the learned everyday spending of the category;
 * - spends logged ahead against a budget (they belong to the same spending);
 * - recurring income lines: as planned, or varying as learned (logic/sim/fit.js), with the person's risks;
 * - savings goals: a month that runs short cannot put money aside, so goals are worked out in each run;
 * - freelance income logged one by one (category "side"), when it is learned as such.
 *
 * The current month starts from what you have now (its paid lines are in it) and only its unpaid lines and the part
 * of the month still ahead are simulated.
 */
import { M, Period } from '../../core/dates.js';
import { r2 } from '../../core/util.js';

/**
 * The pot a savings goal starts the simulation with: after this month's payment when it is already paid, else what
 * it held at the end of last month, or what is saved today when the plan starts this month.
 */
function startPot(paidNow, series, i0, saved) {
  if (paidNow) {
    return series[i0];
  }
  if (i0 > 0) {
    return series[i0 - 1];
  }
  return saved;
}

/**
 * @param {import('../../types.js').Plan} plan
 * @param {{months: object[], summary: object, goals: object}} projection project(plan)
 * @param {{today: number, horizon: number, extraIncome?: boolean}} o `extraIncome`: freelance items are simulated
 * @returns {{start: number, clipped: boolean, months: {k: number, frac: number, det: number, incomes: {id: string, amount: number}[], plan: number}[], goals: object[]}}
 */
export function baseFlows(plan, projection, { today, horizon, extraIncome = false }) {
  const settings = plan.settings;
  const { s0 } = projection.summary;
  const all = projection.months;
  const i0 = Math.max(0, Period.of(settings, today) - s0);
  const count = Math.max(0, Math.min(horizon, all.length - i0));
  const first = all[i0];
  if (!first) {
    const last = all[all.length - 1];
    return { start: last ? last.close : settings.opening, clipped: true, months: [], goals: [] };
  }
  const started = today >= first.start;
  const modelled = e =>
    !!e.budget ||
    !!e.of ||
    e.key.startsWith('inc:') ||
    e.key.startsWith('goal:') ||
    (extraIncome && e.key.startsWith('item:') && e.amount > 0 && e.cat === 'side');
  const months = [];
  for (let t = 0; t < count; t++) {
    const m = all[i0 + t];
    const current = t === 0 && started;
    // this month: only what is not paid yet (the rest is in what you have now)
    const lines = current ? m.entries.filter(e => !e.paid) : m.entries;
    let det = 0;
    const incomes = [];
    for (const e of lines) {
      if (e.key.startsWith('inc:') && e.amount > 0) {
        incomes.push({ id: e.id, amount: e.amount });
      } else if (!modelled(e)) {
        det += e.amount;
      }
    }
    months.push({
      k: m.k,
      frac: current ? (m.end - today + 1) / (m.end - m.start + 1) : 1,
      det: r2(det),
      incomes,
      plan: m.close,
    });
  }
  // each savings goal as the simulation needs it: the pot it starts with and when it saves
  const goals = plan.goals.map(G => {
    const series = projection.goals[G.id] ? projection.goals[G.id].series : [];
    const paidNow = started && first.entries.some(e => e.key === 'goal:' + G.id && e.paid);
    return {
      id: G.id,
      name: G.name,
      on: G.on,
      target: G.target,
      monthly: G.monthly,
      rate: G.rate,
      from: M.parse(G.from),
      to: M.parse(G.to),
      by: M.parse(G.by),
      release: M.parse(G.release),
      pot: startPot(paidNow, series, i0, G.saved),
      skipFirst: paidNow,
    };
  });
  return {
    start: started ? first.now : first.open,
    clipped: count < horizon,
    months,
    goals,
  };
}
