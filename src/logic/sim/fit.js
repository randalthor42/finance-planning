/**
 * @file Learning from history for the simulation: what a month of everyday spending looks like per category, how often
 * large irregular expenses happen and how big they are, and how each income varies. Pure: plan in, numbers out (no
 * text, no formatting; the page words it). Loaded only with the simulation (services/lazySim.js).
 *
 * History is what the plan keeps of the past: logged purchases and spends (plan.items, kept when the plan is rolled
 * forward), amounts changed for one month (plan.overrides: an income that came in lower), and the months they fall in.
 * The window is the complete budget months before `now`, from the first one with data, at most WINDOW_MAX of them.
 *
 * Robust on purpose: the middle is the median and the spread the median absolute deviation (one wild month barely
 * moves them), and the simulation resamples the real months (an empirical bootstrap), not a bell curve: spending is
 * skewed. Large single purchases are taken out of everyday spending and modelled as rare events. Fewer than
 * MIN_MONTHS months of data is not enough to learn from: a wide fallback is used instead and flagged "low".
 */
import { M } from '../../core/dates.js';
import { r2 } from '../../core/util.js';
import { recurs } from '../recurs.js';
import { describe, mad, median } from './stats.js';

/** At most this many months of history are used: older habits say less about the months ahead. */
export const WINDOW_MAX = 24;
/** Fewer months than this is too little to learn a category from (the fallback is used, flagged "low"). */
export const MIN_MONTHS = 3;
/** The shape scaled so that its average is 1: months add up, so over a year the plan's own amount is the middle. */
const meanOne = shape => {
  const mean = shape.reduce((sum, x) => sum + x, 0) / shape.length;
  return shape.map(x => x / mean);
};
/**
 * The shape of a month of spending when there is too little history: multiples of the best guess, skewed to the
 * expensive side (a month can cost twice the usual, hardly ever nothing). Drawn with equal chance. Average 1 (a
 * median of 1 would let a run of months drift ~8% a month away from the plan with no history to say so).
 */
export const FALLBACK = meanOne([0.45, 0.6, 0.7, 0.8, 0.9, 1, 1, 1.1, 1.25, 1.45, 1.7, 2]);
/** The same for a freelance income that has no history to learn its ups and downs from. Average 1. */
export const INCOME_FALLBACK = meanOne([0.5, 0.7, 0.85, 0.95, 1, 1, 1.05, 1.15, 1.3]);
/**
 * Spending as the plan's cash sees it: money out, not money drawn from savings or a card (cover), and not a purchase
 * on a credit card, which costs no cash that month (logic/projection.js); the card's repayment is a bill of the plan.
 * @returns {boolean}
 */
export function isCashSpend(item, creditIds) {
  return item.kind === 'out' && !item.cover && !(item.account && creditIds.has(item.account));
}
/**
 * The ids of the plan's credit cards.
 * @returns {Set<string>}
 */
export const creditIdsOf = plan => new Set(plan.accounts.filter(a => a.type === 'credit').map(a => a.id));
/** A purchase is a large irregular expense from this many times the median purchase… */
const LARGE_ITEM = 4;
/** …and from this share of a median month of everyday spending (the higher of the two), with at least: */
const LARGE_MONTH = 0.5;
const LARGE_MIN_ITEMS = 6;
/** Rare events need half a year of history to say how often they happen; until then the rate assumes at least this. */
const EVENT_MIN_MONTHS = 6;

/**
 * Everything the simulation needs from the plan's history, as of month `now` (M.parse): the window, the categories of
 * everyday spending, the large irregular expenses, each recurring income and any freelance income logged one by one.
 * @param {import('../../types.js').Plan} plan
 * @param {{now: number, window?: number}} o
 * @returns {object} the model: {now, window, cats, events, incomes, extraIncome, history}
 */
export function fitModel(plan, { now, window = WINDOW_MAX }) {
  const to = now - 1;
  const monthOf = item => M.parse(item.month);
  const credit = creditIdsOf(plan);
  const spendsAll = plan.items.filter(i => isCashSpend(i, credit) && monthOf(i) <= to);
  const sideAll = plan.items.filter(i => i.kind === 'in' && i.cat === 'side' && monthOf(i) <= to);
  const overrideMonths = Object.keys(plan.overrides)
    .filter(key => Object.keys(plan.overrides[key]).some(e => e.startsWith('inc:')))
    .map(M.parse)
    .filter(k => k <= to);
  const starts = [...spendsAll.map(monthOf), ...sideAll.map(monthOf), ...overrideMonths];
  if (!starts.length) {
    return emptyModel(plan);
  }
  const from = Math.max(Math.min(...starts), to - window + 1);
  const n = to - from + 1;
  const inWindow = item => monthOf(item) >= from;
  const spends = spendsAll.filter(inWindow);
  const side = sideAll.filter(inWindow);

  // large irregular expenses: far bigger than a usual purchase and than a good part of a usual month
  const totals = new Array(n).fill(0);
  for (const i of spends) {
    totals[monthOf(i) - from] += i.amount;
  }
  const threshold =
    spends.length >= LARGE_MIN_ITEMS
      ? Math.max(LARGE_ITEM * median(spends.map(i => i.amount)), LARGE_MONTH * median(totals), 1)
      : Infinity;
  const large = spends.filter(i => i.amount >= threshold);
  const everyday = spends.filter(i => i.amount < threshold);

  // everyday spending by category (a spend from a budget counts in the budget's category)
  const budgetCat = new Map(plan.bills.filter(b => b.budget).map(b => [b.id, b.cat]));
  const catOf = i => (i.budget && budgetCat.get(i.budget)) || i.cat;
  const byCat = new Map();
  const monthly = cat => {
    if (!byCat.has(cat)) {
      byCat.set(cat, new Array(n).fill(0));
    }
    return byCat.get(cat);
  };
  for (const i of everyday) {
    monthly(catOf(i))[monthOf(i) - from] += i.amount;
  }
  // what the plan's budgets allow per month, by category (a budget every 3 months counts a third)
  const budgets = new Map();
  for (const b of plan.bills) {
    if (b.budget && b.amount > 0) {
      budgets.set(b.cat, r2((budgets.get(b.cat) || 0) + b.amount / b.every));
      monthly(b.cat);
    }
  }
  const cats = [...byCat.entries()]
    .map(([cat, values]) => learn(cat, values.map(r2), budgets.get(cat) ?? null, n))
    .filter(Boolean)
    .sort((a, b) => b.center - a.center);

  const sizes = large.map(i => i.amount).sort((a, b) => a - b);
  const events = {
    threshold: Number.isFinite(threshold) ? r2(threshold) : null,
    count: large.length,
    perYear: large.length ? r2((large.length / Math.max(n, EVENT_MIN_MONTHS)) * 12) : 0,
    sizes,
    typical: r2(median(sizes)),
    confidence: n >= EVENT_MIN_MONTHS && large.length >= MIN_MONTHS ? 'ok' : 'low',
  };

  const hasSideLine = plan.incomes.some(r => r.cat === 'side');
  let extraIncome = null;
  if (side.length && !hasSideLine) {
    const values = new Array(n).fill(0);
    for (const i of side) {
      values[monthOf(i) - from] += i.amount;
    }
    extraIncome = learn('side', values.map(r2), null, n);
  }

  return {
    now,
    window: { from, to, months: n },
    cats,
    events,
    incomes: plan.incomes.map(r => incomeModel(plan, r, from, to)),
    extraIncome,
    history: { spends: spends.length, large: large.length, side: side.length, overrideMonths: overrideMonths.length },
  };
}

/** A model with nothing learned: budgets become wide guesses, incomes are as planned. */
function emptyModel(plan) {
  const budgets = new Map();
  for (const b of plan.bills) {
    if (b.budget && b.amount > 0) {
      budgets.set(b.cat, r2((budgets.get(b.cat) || 0) + b.amount / b.every));
    }
  }
  return {
    now: null,
    window: { from: null, to: null, months: 0 },
    cats: [...budgets.entries()].map(([cat, budget]) => learn(cat, [], budget, 0)).sort((a, b) => b.center - a.center),
    events: { threshold: null, count: 0, perYear: 0, sizes: [], typical: 0, confidence: 'low' },
    incomes: plan.incomes.map(r => incomeModel(plan, r, null, null)),
    extraIncome: null,
    history: { spends: 0, large: 0, side: 0, overrideMonths: 0 },
  };
}

/**
 * One category: its months from the first one with spending (the months before say nothing about it), what a month
 * usually costs and how much that varies. `n` is the length of the window.
 * - history: enough months (MIN_MONTHS): the real months are resampled; the middle is their median.
 * - few: some months, too few: the best guess (the budget, else their mean) with the wide FALLBACK shape.
 * - budget: no spending logged at all, but a budget: the budget with the wide shape. With months of history and
 *   nothing logged (`zeroHistory`) that is not taken as "spends nothing": the person may simply not log it.
 */
function learn(cat, values, budget, n) {
  const first = values.findIndex(v => v > 0);
  const observed = first < 0 ? [] : values.slice(first);
  if (observed.length >= MIN_MONTHS) {
    const stats = describe(observed);
    return {
      cat,
      basis: 'history',
      confidence: 'ok',
      months: observed.length,
      offset: first,
      values: observed,
      stats,
      center: stats.median,
      budget,
      zeroHistory: false,
    };
  }
  if (!observed.length && budget === null) {
    return null;
  }
  const guess = budget ?? r2(observed.reduce((s, v) => s + v, 0) / observed.length);
  return {
    cat,
    basis: observed.length ? 'few' : 'budget',
    confidence: 'low',
    months: observed.length,
    offset: observed.length ? first : n,
    values: observed,
    stats: describe(observed),
    center: guess,
    budget,
    zeroHistory: !observed.length && n >= MIN_MONTHS,
  };
}

/**
 * One recurring income: what came in each month it was due in the window (an amount changed for that month, else the
 * planned amount). It varies when at least MIN_MONTHS months differ by more than 2% (median absolute deviation against
 * the median): each later payment is then the planned amount times one of those months against the median.
 * A freelance income (category "side") that cannot be learned gets the wide INCOME_FALLBACK, flagged "low".
 * Anything else is fixed; its risks (a late payment, a cut, a raise) are the person's to set (models/sim.js).
 */
function incomeModel(plan, r, from, to) {
  const observed = [];
  if (from !== null) {
    const anchor = M.parse(plan.settings.startMonth);
    for (let k = from; k <= to; k++) {
      if (recurs(r, k, anchor)) {
        const o = (plan.overrides[M.key(k)] || {})['inc:' + r.id];
        const amount = o === undefined ? r.amount : o;
        if (amount > 0) {
          observed.push(amount);
        }
      }
    }
  }
  const middle = median(observed);
  const spread = middle ? mad(observed) / middle : 0;
  const base = { id: r.id, name: r.name, cat: r.cat, amount: r.amount, observed: observed.length };
  if (observed.length >= MIN_MONTHS && spread > 0.02) {
    return {
      ...base,
      mode: 'variable',
      confidence: 'ok',
      ratios: observed.map(x => r2(x / middle)),
      spread: r2(spread),
    };
  }
  if (r.cat === 'side') {
    return { ...base, mode: 'variable', confidence: 'low', ratios: INCOME_FALLBACK, spread: r2(mad(INCOME_FALLBACK)) };
  }
  return { ...base, mode: 'fixed', confidence: 'ok', ratios: [1], spread: 0 };
}
