/**
 * @file Audit: the full ledger behind the plan and a set of checks that the numbers add up. Pure.
 *
 * The checks are the rules the rest of the app relies on. If one fails, a screen somewhere is showing a wrong number,
 * so they double as a regression test (tests/unit/audit.test.js runs them).
 */
import { r2 } from '../core/util.js';

/** Two amounts are "the same" within one cent, to allow for rounding along the way. */
const same = (first, second) => Math.abs(first - second) < 0.011;

/**
 * Every line of every month in order, with the balance after it.
 * Lines without a fixed day are listed first in their month, in plan order.
 * @returns {{monthKey: string, monthIndex: number, date: ?number, group: string, label: string, detail: string, amount: number, paid: boolean, balance: number}[]}
 */
export function ledgerRows(projection) {
  const rows = [];
  for (const month of projection.months) {
    let balance = month.open;
    const entries = month.entries
      .map((entry, position) => ({ entry, position }))
      .sort((a, b) => (a.entry.date ?? -1) - (b.entry.date ?? -1) || a.position - b.position);
    for (const { entry } of entries) {
      balance = r2(balance + entry.amount);
      rows.push({
        monthKey: month.key,
        monthIndex: month.k,
        date: entry.date ?? null,
        group: entry.group,
        label: entry.label,
        detail: entry.sub || '',
        amount: entry.amount,
        paid: !!entry.paid,
        onCard: entry.onCard ? entry.charged : 0,
        balance,
      });
    }
  }
  return rows;
}

/**
 * Runs every consistency check on a projection.
 * @returns {{id: string, ok: boolean, failures: string[]}[]} One result per rule; `failures` names the months that break it.
 */
export function auditChecks(plan, projection) {
  const months = projection.months;
  const rules = {
    // the balance carries over: a month starts exactly where the one before ended
    carryOver: [],
    // a month ends at its start plus the sum of its lines
    linesAddUp: [],
    // "have now" plus "still to come" is the end of the month
    nowPlusToCome: [],
    // money in and money out are the sums of the positive and negative lines (corrections aside)
    inAndOut: [],
    // net worth is cash plus savings minus debt
    netWorth: [],
    // a card owes last month's amount, plus interest, plus what was put on it, minus what was paid off
    cards: [],
    // a paid line has nothing still to come; an unpaid one has all of it
    paidLines: [],
  };

  months.forEach((month, position) => {
    const expectedOpen = position === 0 ? plan.settings.opening : months[position - 1].close;
    if (!same(month.open, expectedOpen)) {
      rules.carryOver.push(month.key);
    }
    const lineTotal = month.entries.reduce((sum, entry) => sum + entry.amount, 0);
    if (!same(month.open + lineTotal, month.close)) {
      rules.linesAddUp.push(month.key);
    }
    if (!same(month.now + month.todo, month.close)) {
      rules.nowPlusToCome.push(month.key);
    }
    const planned = month.entries.filter(entry => entry.group !== 'adjust');
    const moneyIn = planned.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
    const moneyOut = planned.reduce((sum, entry) => sum + Math.max(0, -entry.amount), 0);
    if (!same(moneyIn, month.inc) || !same(moneyOut, month.out)) {
      rules.inAndOut.push(month.key);
    }
    if (!same(month.close + month.savings - month.debt, month.worth)) {
      rules.netWorth.push(month.key);
    }
    if (month.entries.some(entry => !same(entry.still, entry.paid ? 0 : entry.amount))) {
      rules.paidLines.push(month.key);
    }
  });

  for (const account of plan.accounts) {
    const card = projection.cards[account.id];
    if (!card) {
      continue;
    }
    months.forEach((month, position) => {
      if (card.added[position] < 0 || card.paidOff[position] < 0 || card.series[position] < 0) {
        rules.cards.push(`${account.name} ${month.key}`);
      }
    });
  }

  return Object.entries(rules).map(([id, failures]) => ({ id, ok: failures.length === 0, failures }));
}
