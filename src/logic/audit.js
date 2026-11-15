/**
 * @file Audit: the full ledger behind the plan and a set of checks that the numbers add up. Pure.
 *
 * The checks are the rules the rest of the app relies on. If one fails, a screen somewhere is showing a wrong number,
 * so they double as a regression test (tests/unit/audit.test.js runs them).
 */
import { r2 } from '../core/util.js';

/** Two amounts are "the same" within one cent, to allow for rounding along the way. */
const same = (first, second) => Math.abs(first - second) < 0.011;

/** Order of the ledger lines: by day; on the same day money in comes first; lines without a fixed day come last. */
function ledgerOrder(a, b) {
  const dayA = a.entry.date ?? Infinity;
  const dayB = b.entry.date ?? Infinity;
  if (dayA !== dayB) {
    return dayA < dayB ? -1 : 1;
  }
  const inA = a.entry.amount > 0 ? 0 : 1;
  const inB = b.entry.amount > 0 ? 0 : 1;
  return inA - inB || a.position - b.position;
}

/**
 * Every line of every month in order, with the balance after it.
 * Lines are in day order, money in first on the same day, and lines without a fixed day last (so the running
 * balance does not show an overdraft before the salary). The month still ends at the same balance.
 * @returns {{monthKey: string, monthIndex: number, date: ?number, group: string, label: string, detail: string, amount: number, paid: boolean, balance: number}[]}
 */
export function ledgerRows(projection) {
  const rows = [];
  for (const month of projection.months) {
    let balance = month.open;
    const entries = month.entries.map((entry, position) => ({ entry, position })).sort(ledgerOrder);
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
    // corrections and financing (card draws, savings) are neither; a refund is spending that came back
    const planned = month.entries.filter(entry => entry.group !== 'adjust' && entry.group !== 'transfer');
    const isRefund = entry => entry.amount > 0 && entry.cat === 'refund';
    const moneyIn = planned.reduce((sum, entry) => sum + (isRefund(entry) ? 0 : Math.max(0, entry.amount)), 0);
    const moneyOut = planned.reduce(
      (sum, entry) => sum + Math.max(0, -entry.amount) - (isRefund(entry) ? entry.amount : 0),
      0,
    );
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

/**
 * Bills or incomes that look like the same thing entered twice: same name (ignoring "copy" and case), amount, day and
 * account. Not an error in the maths, so it is not one of the checks; the Audit page and the Overview warn about it.
 * @returns {{list: 'bills'|'incomes', names: string[], amount: number}[]}
 */
export function duplicateLines(plan) {
  const found = [];
  for (const list of ['incomes', 'bills']) {
    const groups = new Map();
    for (const record of plan[list]) {
      const name = String(record.name)
        .toLowerCase()
        .replace(/\s*\bcopy\b\s*(\(\d+\))?\s*$/, '')
        .trim();
      const key = [name, record.amount, record.day, record.account, record.every, record.from, record.to].join('|');
      groups.set(key, (groups.get(key) || []).concat(record));
    }
    for (const records of groups.values()) {
      if (records.length > 1) {
        found.push({ list, names: records.map(record => record.name), amount: records[0].amount });
      }
    }
  }
  return found;
}
