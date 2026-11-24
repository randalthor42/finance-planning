/**
 * @file The main risks of a simulation, most serious first, as ids with numbers: the page (ui/views/simulation.js)
 * words them. Pure. Thresholds are deliberately round: a risk under a few percent is not worth a sentence.
 */

/**
 * @param {object} result logic/sim/engine.js simulate
 * @param {object} model logic/sim/fit.js fitModel
 * @param {?object} check logic/sim/backtest.js backtest, or null
 * @returns {{id: string}[]}
 */
export function risksOf(result, model, check = null) {
  const out = [];
  if (!result.months.length) {
    return [{ id: 'noMonths' }];
  }
  if (result.pBelowZero >= 0.02) {
    out.push({ id: 'belowZero', p: result.pBelowZero, k: result.firstDip });
  }
  if (result.zeroAtP10 !== null) {
    out.push({ id: 'zeroAtP10', months: result.zeroAtP10, k: result.months[result.zeroAtP10].k });
  }
  if (result.buffer > 0 && result.pBelowBuffer >= 0.1 && result.pBelowBuffer >= result.pBelowZero + 0.05) {
    out.push({ id: 'belowBuffer', p: result.pBelowBuffer, buffer: result.buffer });
  }
  for (const g of result.goals) {
    const p = g.pByDate ?? g.pWithin;
    if (g.pByDate !== null && (g.planReach === null || g.planReach > g.by)) {
      // not a matter of chance: even with every payment made, the plan gets there too late
      out.push({ id: 'goalPlan', name: g.name, by: g.by, planReach: g.planReach });
    } else if (p !== null && p < 0.5 && (g.pByDate !== null || g.planReach !== null)) {
      // without a date, only when the plan would get there within these months and chance stops it (a goal that
      // simply takes longer is long-term, not at risk)
      out.push({ id: 'goal', name: g.name, p, byDate: g.pByDate !== null, by: g.by });
    }
  }
  // the plan expects clearly more than its history suggests (often: spending that has no budget in the plan)
  const last = result.months[result.months.length - 1];
  const gap = last.plan - last.p50;
  if (gap > Math.max(100, Math.abs(last.plan) * 0.1)) {
    out.push({ id: 'planGap', amount: gap, k: last.k });
  }
  // what drives the uncertainty: the sources whose middle half of runs lies furthest apart
  const drivers = result.sources.slice(0, 2).filter(s => s.iqr > 0);
  if (drivers.length) {
    out.push({ id: 'drivers', sources: drivers });
  }
  if (model.events.perYear >= 0.5) {
    out.push({ id: 'events', perYear: model.events.perYear, typical: model.events.typical });
  }
  if (!model.window.months) {
    out.push({ id: 'noHistory' });
  } else if (model.window.months < 3) {
    out.push({ id: 'shortHistory', months: model.window.months });
  }
  if (result.lowConfidence.length) {
    out.push({ id: 'lowConfidence', cats: result.lowConfidence });
  }
  if (check && check.status === 'ok' && check.verdict === 'poor') {
    out.push({ id: 'untrusted' });
  }
  if (result.clipped) {
    out.push({ id: 'clipped', months: result.months.length });
  }
  if (!out.some(r => ['belowZero', 'zeroAtP10', 'belowBuffer', 'goal', 'goalPlan', 'planGap'].includes(r.id))) {
    out.unshift({ id: 'calm' });
  }
  return out;
}
