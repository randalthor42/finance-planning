/**
 * @file The Monte Carlo simulation: many possible futures of the balance, month by month. Pure and seeded: the same
 * plan, settings and seed always give the same result (tests rely on it).
 *
 * Each run, each month:
 *   balance += the plan's certain lines (logic/sim/baseline.js)
 *            + each income: as planned, or times a learned ratio (variable), late or changed by the person's risks
 *            − everyday spending: one past month is drawn for all categories at once (a joint bootstrap: a holiday
 *              month costs more in several categories together), each category taken from that month
 *            − large irregular expenses: a Poisson number of them, each as big as a past one
 *            ± what the scenario changes (what if)
 *   then each savings goal takes its monthly amount, only from money that is there (a month that runs short cannot
 *   save), and goals released this month come back to cash.
 * The current month only simulates the part still ahead (`frac`). The draws never depend on the scenario, so a
 * scenario run with the same seed differs from the baseline only by the scenario (common random numbers).
 *
 * Overrides (models/sim.js) move a category's middle and spread while keeping the shape of its real months:
 *   value = middle' + (past month − median) × spread' / MAD
 */
import { M } from '../../core/dates.js';
import { mulberry32, poisson } from '../../core/random.js';
import { r2 } from '../../core/util.js';
import { FALLBACK, INCOME_FALLBACK } from './fit.js';
import { mad, quantile } from './stats.js';

const FALLBACK_MAD = mad(FALLBACK);

/**
 * The category, event and income models with the person's overrides applied: what is really simulated.
 * @returns {{cats: object[], events: ?object, incomes: Map<string, object>, extra: ?object, months: number}}
 */
export function effectiveModel(model, settings) {
  const cats = [];
  for (const c of model.cats) {
    const o = settings.cats[c.cat] || {};
    if (o.off) {
      continue;
    }
    const history = c.basis === 'history';
    const center = o.median ?? c.center;
    // the spread the page shows: the MAD of the real months, or of the wide fallback around the guess
    const spread0 = history ? c.stats.mad : c.center * FALLBACK_MAD;
    const spread = o.spread ?? spread0;
    cats.push({
      cat: c.cat,
      history,
      values: c.values,
      offset: c.offset,
      median: history ? c.stats.median : c.center,
      center,
      scale: spread0 > 0 ? spread / spread0 : 1,
      // no spread in the past months, but one was asked for: the fallback shape gives it
      addSpread: spread0 > 0 ? 0 : spread,
      confidence: c.confidence,
    });
  }
  const e = settings.events;
  let events = null;
  if (!(e.off || !(e.perYear ?? model.events.perYear) || !(model.events.sizes.length || e.size))) {
    events = {
      perMonth: (e.perYear ?? model.events.perYear) / 12,
      sizes: model.events.sizes.length ? model.events.sizes : [e.size],
      scale: e.size && model.events.typical ? e.size / model.events.typical : 1,
      wide: model.events.confidence === 'low',
    };
  }
  const incomes = new Map(
    model.incomes.map(i => {
      const o = settings.incomes[i.id] || {};
      const mode = o.mode || i.mode;
      let ratios = [1];
      if (mode === 'variable') {
        ratios = i.mode === 'variable' ? i.ratios : INCOME_FALLBACK;
      }
      const spread0 = mad(ratios);
      return [
        i.id,
        {
          mode,
          ratios,
          scale: o.spread !== undefined && spread0 > 0 ? o.spread / spread0 : 1,
          delay: o.delay || 0,
          cut: { chance: o.cutChance || 0, pct: o.cutPct || 0 },
          raise: { chance: o.raiseChance || 0, pct: o.raisePct || 0 },
        },
      ];
    }),
  );
  const extra = model.extraIncome && !(settings.cats.side && settings.cats.side.off) ? model.extraIncome : null;
  return { cats, events, incomes, extra, months: model.window.months };
}

/** One month of one category, from past month `j` (or an own draw before its first month). Never below zero. */
function drawCat(c, j, random) {
  if (!c.history) {
    const ratio = FALLBACK[Math.floor(random() * FALLBACK.length)];
    return Math.max(0, c.center + c.center * (ratio - 1) * c.scale);
  }
  const index = j >= c.offset ? j - c.offset : Math.floor(random() * c.values.length);
  const past = c.values[index];
  const deviation = (past - c.median) * c.scale;
  const extra = c.addSpread ? (FALLBACK[Math.floor(random() * FALLBACK.length)] - 1) * (c.addSpread / FALLBACK_MAD) : 0;
  return Math.max(0, c.center + deviation + extra);
}

/**
 * Spending of one month: everyday spending of every category plus large irregular expenses, times `frac` (the part of
 * the month still ahead). `out`, when given, gets each source's share (for which sources drive the risk).
 * Shared with the backtest, so the backtest checks exactly what the simulation does.
 * @returns {{total: number, j: number}} the spending, and the past month `j` the categories were drawn from
 */
export function drawSpending(eff, random, frac, out) {
  let total = 0;
  const j = eff.months ? Math.floor(random() * eff.months) : 0;
  const cats = eff.cats;
  for (let i = 0; i < cats.length; i++) {
    const v = drawCat(cats[i], j, random) * frac;
    total += v;
    if (out) {
      out[i] += v;
    }
  }
  if (eff.events) {
    const count = poisson(random, eff.events.perMonth * frac);
    let sum = 0;
    for (let n = 0; n < count; n++) {
      let size = eff.events.sizes[Math.floor(random() * eff.events.sizes.length)] * eff.events.scale;
      if (eff.events.wide) {
        size *= FALLBACK[Math.floor(random() * FALLBACK.length)];
      }
      sum += size;
    }
    total += sum;
    if (out) {
      out[eff.cats.length] += sum;
    }
  }
  return { total, j };
}

/** What a scenario changes in month k: income factor, extra costs, extra saving (to a goal or set aside). */
function scenarioAt(scenario, k) {
  const at = { income: 1, cost: 0, saving: new Map() };
  for (const c of (scenario && scenario.changes) || []) {
    const from = M.parse(c.from);
    const active = from === null || k >= from;
    if (c.kind === 'income' && active) {
      at.income *= 1 + c.percent / 100;
    } else if (c.kind === 'cost' && active) {
      at.cost += c.amount;
    } else if (c.kind === 'oneoff' && (from === null ? false : k === from)) {
      at.cost += c.amount;
    } else if (c.kind === 'saving' && active) {
      at.saving.set(c.goal || '', (at.saving.get(c.goal || '') || 0) + c.amount);
    }
  }
  return at;
}

/** Everything one simulation needs before its runs: the effective model, the arrays, the months worked out once. */
function prepare({ base, model, settings, scenario = null, cushion = 0 }) {
  const eff = effectiveModel(model, settings);
  const runs = settings.runs;
  const H = base.months.length;
  const buffer = settings.buffer ?? cushion;
  const random = mulberry32(settings.seed);
  const balances = new Float64Array(H * runs);
  const goals = base.goals.filter(g => g.on || g.pot > 0);
  const G = goals.length;
  const reach = goals.map(() => new Float64Array(runs).fill(Infinity));
  // what each source adds over the horizon in each run (spending categories, rare events, each varying income)
  const incomeIds = [...eff.incomes.keys()];
  const incomeList = incomeIds.map(id => eff.incomes.get(id));
  const sourceKeys = [...eff.cats.map(c => 'cat:' + c.cat), 'events', ...incomeIds.map(id => 'inc:' + id)];
  if (eff.extra) {
    sourceKeys.push('extra');
  }
  const sources = sourceKeys.map(() => new Float64Array(runs));
  const extraSource = eff.extra ? sources[sources.length - 1] : null;
  const extraModel = eff.extra
    ? { ...eff.extra, history: eff.extra.basis === 'history', median: eff.extra.stats.median, scale: 1, addSpread: 0 }
    : null;

  // everything that does not depend on chance, worked out once instead of in every run: each month's scenario,
  // its income lines with their model, and what each goal wants to put aside
  const plan = base.months.map((m, t) => {
    const sc = scenarioAt(scenario, m.k);
    const lines = m.incomes.map(line => {
      const slot = incomeIds.indexOf(line.id);
      return { amount: line.amount, slot, inc: slot < 0 ? null : incomeList[slot] };
    });
    const wants = goals.map(g => {
      const inRange = (g.from === null || m.k >= g.from) && (g.to === null || m.k <= g.to);
      const released = g.release !== null && m.k > g.release;
      const planned = g.on && inRange && !released && !(t === 0 && g.skipFirst) ? g.monthly : 0;
      return planned + (sc.saving.get(g.id) || 0);
    });
    const releases = goals.map(g => g.release !== null && m.k === g.release);
    return { m, sc, lines, wants, releases, general: sc.saving.get('') || 0 };
  });
  const monthly = goals.map(g => (g.rate > 0 ? g.rate / 1200 : 0));

  const firstDips = new Map();
  const spendOut = new Float64Array(eff.cats.length + 1);
  const pots = new Float64Array(G);
  const levels = new Float64Array(incomeList.length);
  const incomeSource = incomeList.map((_, i) => sources[eff.cats.length + 1 + i]);

  const state = { base, eff, runs, balances, goals, reach, sourceKeys, sources, settings, buffer, firstDips };
  state.belowZero = 0;
  state.belowBuffer = 0;
  /** Runs `from` … `to` − 1, in order: the same random numbers whatever the chunks (see simulateInChunks). */
  state.run = (from, to) => {
    for (let r = from; r < to; r++) {
      let balance = base.start;
      for (let i = 0; i < G; i++) {
        pots[i] = goals[i].pot;
      }
      levels.fill(1);
      let late = 0; // income paid late, arriving next month
      let dipped = false;
      let under = balance < buffer;
      spendOut.fill(0);
      for (let t = 0; t < H; t++) {
        const { m, sc, lines, wants, releases, general } = plan[t];
        balance += m.det + late;
        late = 0;
        // incomes
        for (let l = 0; l < lines.length; l++) {
          const line = lines[l];
          const inc = line.inc;
          let amount = line.amount;
          if (inc) {
            // a lasting change of the income (a cut, a raise) may start this month
            if (inc.cut.chance > 0 && random() < inc.cut.chance / 12) {
              levels[line.slot] *= 1 - inc.cut.pct;
            }
            if (inc.raise.chance > 0 && random() < inc.raise.chance / 12) {
              levels[line.slot] *= 1 + inc.raise.pct;
            }
            if (inc.mode === 'variable') {
              const ratio = inc.ratios[Math.floor(random() * inc.ratios.length)];
              amount *= 1 + (ratio - 1) * inc.scale;
            }
            amount *= levels[line.slot];
            incomeSource[line.slot][r] += amount - line.amount;
            if (inc.delay > 0 && random() < inc.delay) {
              late += amount * sc.income;
              continue;
            }
          }
          balance += Math.max(0, amount) * sc.income;
        }
        // freelance income logged one by one
        if (extraModel) {
          const j = Math.floor(random() * Math.max(1, eff.months));
          const extra = drawCat(extraModel, j, random) * m.frac * sc.income;
          balance += extra;
          extraSource[r] += extra;
        }
        // everyday spending and large irregular expenses
        balance -= drawSpending(eff, random, m.frac, spendOut).total;
        balance -= sc.cost;
        // savings: interest, money released, then this month's amount from money that is there
        for (let i = 0; i < G; i++) {
          if (monthly[i] && pots[i] > 0) {
            pots[i] += pots[i] * monthly[i];
          }
          if (releases[i]) {
            balance += pots[i];
            pots[i] = 0;
            continue;
          }
          const g = goals[i];
          let want = wants[i];
          if (g.target > 0) {
            want = Math.min(want, Math.max(0, g.target - pots[i]));
          }
          const put = Math.min(Math.max(0, want), Math.max(0, balance));
          balance -= put;
          pots[i] += put;
          if (g.target > 0 && pots[i] >= g.target - 0.005 && reach[i][r] === Infinity) {
            reach[i][r] = t;
          }
        }
        if (general > 0) {
          balance -= Math.min(general, Math.max(0, balance));
        }
        balances[t * runs + r] = balance;
        if (balance < 0 && !dipped) {
          dipped = true;
          firstDips.set(t, (firstDips.get(t) || 0) + 1);
        }
        if (balance < buffer) {
          under = true;
        }
      }
      // everyday spending and events count against the balance: as negative amounts
      for (let i = 0; i <= eff.cats.length; i++) {
        sources[i][r] = -spendOut[i];
      }
      if (dipped) {
        state.belowZero++;
      }
      if (under) {
        state.belowBuffer++;
      }
    }
  };
  return state;
}

/**
 * Runs the simulation. See the top of this file.
 * @param {{base: object, model: object, settings: object, scenario?: object, cushion?: number}} input
 *   base: logic/sim/baseline.js baseFlows; model: logic/sim/fit.js fitModel; settings: models/sim.js normSim;
 *   scenario: { changes: [...] } or null; cushion: the plan's cushion (the buffer when settings.buffer is null)
 * @returns {object} the result: {runs, seed, horizon, clipped, start, buffer, months, pBelowZero, pBelowBuffer, firstDip, zeroAtP10, end, goals, sources, lowConfidence}
 */
export function simulate(input) {
  const state = prepare(input);
  state.run(0, state.runs);
  return summarise(state);
}

/**
 * The same simulation, in chunks of `chunk` runs with a pause for the page in between (`pause` returns a promise),
 * so 10 000 runs never freeze the screen. The result is exactly the one simulate gives.
 * @returns {Promise<object>} the same result as simulate
 */
export async function simulateInChunks(
  input,
  { chunk = 1000, pause = () => new Promise(resolve => setTimeout(resolve, 0)) } = {},
) {
  const state = prepare(input);
  for (let from = 0; from < state.runs; from += chunk) {
    state.run(from, Math.min(state.runs, from + chunk));
    if (from + chunk < state.runs) {
      await pause();
    }
  }
  return summarise(state);
}

/** Percentiles and probabilities from the runs: what the page shows. */
function summarise({
  base,
  eff,
  runs,
  balances,
  goals,
  reach,
  sourceKeys,
  sources,
  belowZero,
  belowBuffer,
  firstDips,
  settings,
  buffer,
}) {
  const H = base.months.length;
  const months = base.months.map((m, t) => {
    const sorted = balances
      .subarray(t * runs, (t + 1) * runs)
      .slice()
      .sort();
    const q = p => r2(quantile(sorted, p));
    return {
      k: m.k,
      plan: m.plan,
      p5: q(0.05),
      p10: q(0.1),
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p90: q(0.9),
      p95: q(0.95),
    };
  });
  const zeroAt = months.findIndex(m => m.p10 < 0);
  let firstDip = null;
  let most = 0;
  for (const [t, count] of firstDips) {
    if (count > most) {
      most = count;
      firstDip = base.months[t].k;
    }
  }
  const last = base.months.length ? base.months[H - 1].k : null;
  const first = base.months.length ? base.months[0].k : null;
  const goalResults = goals.map((g, i) => {
    const sorted = reach[i].slice().sort();
    // the first month by which a share of runs has reached it (nearest rank), or null when not within the months
    const by = share => {
      const t = sorted[Math.max(0, Math.ceil(share * runs) - 1)];
      return Number.isFinite(t) ? base.months[t].k : null;
    };
    const reached = t => sorted.filter(x => x <= t).length / runs;
    const already = g.target > 0 && g.pot >= g.target;
    // with every planned payment made (no month short of money): when the plan itself reaches it
    let pot = g.pot;
    let planReach = already ? first : null;
    for (let t = 0; t < H && planReach === null && g.target > 0; t++) {
      const k = base.months[t].k;
      if (g.rate > 0) {
        pot += (pot * g.rate) / 1200;
      }
      const inRange = (g.from === null || k >= g.from) && (g.to === null || k <= g.to);
      if (g.on && inRange && (g.release === null || k < g.release) && !(t === 0 && g.skipFirst)) {
        pot += Math.min(g.monthly, Math.max(0, g.target - pot));
      }
      if (pot >= g.target - 0.005) {
        planReach = k;
      }
    }
    let pByDate = null;
    let pWithin = null;
    let reach50 = null;
    let reach90 = null;
    if (g.target > 0) {
      // by its date, when that date is within the months simulated
      if (g.by !== null && first !== null && g.by >= first && g.by <= last) {
        pByDate = already ? 1 : reached(g.by - first);
      }
      if (already) {
        pWithin = 1;
        reach50 = first;
        reach90 = first;
      } else {
        pWithin = reached(H - 1);
        reach50 = by(0.5);
        reach90 = by(0.9);
      }
    }
    return {
      id: g.id,
      name: g.name,
      target: g.target,
      by: g.by,
      pByDate,
      pWithin,
      reach50,
      reach90,
      byBeyond: g.by !== null && last !== null && g.by > last,
      planReach,
    };
  });
  // which sources make the outcome uncertain: how far apart their middle half of runs lies
  const sourceResults = sourceKeys
    .map((key, i) => {
      const sorted = sources[i].slice().sort();
      return { key, iqr: r2(quantile(sorted, 0.75) - quantile(sorted, 0.25)), median: r2(quantile(sorted, 0.5)) };
    })
    .filter(s => s.iqr > 0.005)
    .sort((a, b) => b.iqr - a.iqr);
  return {
    runs,
    seed: settings.seed,
    horizon: H,
    clipped: base.clipped,
    start: r2(base.start),
    buffer,
    months,
    pBelowZero: runs ? belowZero / runs : 0,
    pBelowBuffer: runs ? belowBuffer / runs : 0,
    firstDip,
    zeroAtP10: zeroAt < 0 ? null : zeroAt,
    end: months.length ? { p10: months[H - 1].p10, p50: months[H - 1].p50, p90: months[H - 1].p90 } : null,
    goals: goalResults,
    sources: sourceResults,
    lowConfidence: [...eff.cats.filter(c => c.confidence === 'low').map(c => c.cat)],
  };
}
