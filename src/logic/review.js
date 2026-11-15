/**
 * @file Review of a period (one month or one year): the totals, where the money went, how the budgets did,
 * and two lists a person can act on: what went well and what to watch. Pure.
 *
 * The lists are returned as ids with numbers, not as sentences, so this file stays free of wording
 * and the view (ui/views/review.js) decides how to say it.
 */
import { r2 } from '../core/util.js';

const sum = (list, pick) => r2(list.reduce((total, item) => total + pick(item), 0));

/**
 * @param {import('../types.js').Plan} plan
 * @param {{months: import('../types.js').Month[]}} projection
 * @param {import('../types.js').Month[]} months The months under review, in order (one for a month, up to twelve for a year).
 * @param {?number} today Day number of today. A budget only counts as "kept" once the period is over; without it every period counts as over.
 */
export function reviewPeriod(plan, projection, months, today = null) {
  const first = months[0];
  const last = months[months.length - 1];
  const before = projection.months[projection.months.indexOf(first) - 1] || null;
  const entries = months.flatMap(month => month.entries.map(entry => ({ entry, month })));
  const costs = entries.filter(({ entry }) => entry.amount < 0 && entry.group !== 'adjust');

  const moneyIn = sum(months, month => month.inc);
  const moneyOut = sum(months, month => month.out);
  const leftOver = r2(last.close - first.open);
  // money moved into savings goals is not spent: it is still yours
  const saved = sum(months, month => Math.max(0, -month.g.goal));
  // a negative correction is spending that was never in the plan
  const unplanned = sum(months, month => (month.fix && month.fix.a < 0 ? -month.fix.a : 0));
  const debtStart = before ? before.debt : first.debt;
  const debtChange = r2(last.debt - debtStart);
  const cardStart = before ? before.cardDebt : first.cardDebt;
  const cardChange = r2(last.cardDebt - cardStart);

  // where it went, by category, biggest first
  const byCategory = new Map();
  for (const { entry } of costs) {
    byCategory.set(entry.cat, r2((byCategory.get(entry.cat) || 0) - entry.amount));
  }
  const categories = [...byCategory]
    .map(([cat, amount]) => ({ cat, amount, share: moneyOut ? amount / moneyOut : 0 }))
    .sort((a, b) => b.amount - a.amount);

  // budgets: what was allowed against what was logged
  const byBudget = new Map();
  for (const { entry } of entries) {
    if (!entry.budget) {
      continue;
    }
    const budget = byBudget.get(entry.id) || { id: entry.id, name: entry.label, planned: 0, spent: 0 };
    budget.planned = r2(budget.planned + entry.budget.planned);
    budget.spent = r2(budget.spent + entry.budget.spent);
    byBudget.set(entry.id, budget);
  }
  const budgets = [...byBudget.values()].map(budget => ({ ...budget, difference: r2(budget.planned - budget.spent) }));

  const biggest = costs
    .filter(({ entry }) => !entry.budget)
    .map(({ entry, month }) => ({
      label: entry.label,
      detail: entry.sub || '',
      amount: -entry.amount,
      monthKey: month.key,
      monthIndex: month.k,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const subscriptions = sum(
    costs.filter(({ entry }) => entry.cat === 'subs'),
    ({ entry }) => -entry.amount,
  );
  const negativeMonths = months.filter(month => month.status === 'neg');
  const tightMonths = months.filter(month => month.status === 'tight');
  const overBudgets = budgets.filter(budget => budget.spent > budget.planned + 0.005);
  const keptBudgets = budgets.filter(budget => budget.spent > 0 && budget.spent <= budget.planned);

  /** What went well. Each item: an id the view knows how to phrase, and the numbers for it. */
  const good = [];
  // Keeping a sliver (under 5% of income and under the cushion) is not worth a green tick.
  const leftOverShare = moneyIn ? leftOver / moneyIn : 0;
  const cushion = plan.settings.cushion;
  if (leftOver > 0 && (leftOverShare >= 0.05 || (cushion > 0 && leftOver >= cushion))) {
    good.push({ id: 'leftOver', amount: leftOver, share: moneyIn ? leftOver / moneyIn : 0 });
  }
  if (saved > 0) {
    good.push({ id: 'saved', amount: saved, share: moneyIn ? saved / moneyIn : 0 });
  }
  if (debtChange < -0.005) {
    good.push({ id: 'debtDown', amount: -debtChange });
  }
  // while the period is still running a budget can still be overspent, so it is too early to call it kept
  const periodOver = today === null || last.end < today;
  if (periodOver && keptBudgets.length && !overBudgets.length) {
    good.push({ id: 'budgetsKept', count: keptBudgets.length, amount: sum(keptBudgets, budget => budget.difference) });
  }
  if (!negativeMonths.length && !tightMonths.length) {
    good.push({ id: 'aboveCushion' });
  }
  if (months.some(month => month.fix) && unplanned < Math.max(10, moneyOut * 0.02)) {
    good.push({ id: 'noSurprises' });
  }

  /** What to watch, most serious first. */
  const watch = [];
  if (negativeMonths.length) {
    const worst = negativeMonths.reduce((a, b) => (b.close < a.close ? b : a));
    watch.push({ id: 'negative', count: negativeMonths.length, amount: worst.close, monthIndex: worst.k });
  }
  if (leftOver < 0) {
    watch.push({ id: 'spentMore', amount: -leftOver });
  }
  for (const budget of overBudgets) {
    watch.push({
      id: 'overBudget',
      name: budget.name,
      amount: -budget.difference,
      yearly: r2((-budget.difference / months.length) * 12),
    });
  }
  if (unplanned >= Math.max(10, moneyOut * 0.02)) {
    watch.push({ id: 'unplanned', amount: unplanned, share: moneyOut ? unplanned / moneyOut : 0 });
  }
  if (cardChange > 0.005) {
    watch.push({ id: 'cardUp', amount: cardChange });
  }
  if (tightMonths.length && !negativeMonths.length) {
    watch.push({ id: 'tight', count: tightMonths.length });
  }
  if (moneyIn && subscriptions / moneyIn >= 0.05) {
    watch.push({ id: 'subscriptions', amount: subscriptions, yearly: r2((subscriptions / months.length) * 12) });
  }
  if (categories.length > 1 && categories[0].share >= 0.4 && categories[0].cat !== 'housing') {
    watch.push({ id: 'topCategory', cat: categories[0].cat, share: categories[0].share, amount: categories[0].amount });
  }

  return {
    moneyIn,
    moneyOut,
    leftOver,
    saved,
    unplanned,
    debtChange,
    startBalance: first.open,
    endBalance: last.close,
    categories,
    budgets,
    biggest,
    good,
    watch,
  };
}
