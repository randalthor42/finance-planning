/**
 * @file Bill reminders: which payments of the projected months are due soon or overdue, and which of them were not
 * told yet. Pure (the day is passed in). The page and the system notifications are ui/reminders.js.
 *
 * Reminded: recurring bills and subscriptions, loan payments, and one-off payments with a day (a planned purchase, a
 * counted appointment), when they are not ticked as paid. Not reminded: money in, budgets (they have no day), spends
 * already logged. A payment whose day passed without a tick is "overdue", for a week.
 */
import { D } from '../core/dates.js';

/** How many days ahead a reminder comes: on the day, 1, 2, 3 days or a week before. */
export const REMINDER_DAYS = [0, 1, 2, 3, 7];
/** What can be reminded, each with its own switch. */
export const REMINDER_KINDS = ['bill', 'loan', 'oneoff'];
/** Overdue payments are reminded for this many days after their day. */
const OVERDUE_DAYS = 7;
/** What was told is remembered this many days (enough for a payment to be overdue and forgotten). */
const KEEP_DAYS = 60;

/** The kind of a ledger line for reminders, or null when it is not a payment to remind. */
function kindOf(e) {
  if (e.amount >= 0 && !e.onCard) {
    return null; // money in, or nothing to pay
  }
  if (e.budget || e.of) {
    return null; // a budget has no day; a logged spend is already paid
  }
  if (e.key.startsWith('bill:')) {
    return 'bill';
  }
  if (e.group === 'loan') {
    return 'loan';
  }
  if (e.key.startsWith('item:') || e.key.startsWith('appt:')) {
    return 'oneoff';
  }
  return null;
}

/**
 * The payments to remind on `today` (day number), soonest first: { id, monthKey, entryKey, label, amount, date,
 * daysLeft, overdue, kind, entry }. `days`: how far ahead; `kinds`: { bill, loan, oneoff } switches. The id is the
 * line and its day, so the same payment is told once however often the list is asked for.
 * @param {import('../types.js').Month[]} months the projected months
 * @returns {object[]} the reminders, soonest first ([] when none)
 */
export function dueReminders(months, { today, days, kinds }) {
  const from = today - OVERDUE_DAYS;
  const to = today + days;
  const out = [];
  for (const month of months) {
    if (month.end < from || month.start > to) {
      continue;
    }
    for (const e of month.entries) {
      const kind = e.date === null || e.paid ? null : kindOf(e);
      if (!kind || !kinds[kind] || e.date < from || e.date > to) {
        continue;
      }
      out.push({
        id: e.key + '@' + D.key(e.date),
        monthKey: month.key,
        entryKey: e.key,
        label: e.label,
        amount: e.onCard ? e.charged : -e.amount,
        date: e.date,
        daysLeft: e.date - today,
        overdue: e.date < today,
        kind,
        entry: e,
      });
    }
  }
  return out.sort((a, b) => a.date - b.date || a.label.localeCompare(b.label));
}

/**
 * The reminders not told yet: `seen` is { id: 'YYYY-MM-DD' told }.
 * @returns {object[]} the reminders of `list` not in `seen`
 */
export const newReminders = (list, seen) => list.filter(r => !Object.prototype.hasOwnProperty.call(seen, r.id));

/**
 * What was told more than KEEP_DAYS ago is forgotten.
 * @returns {Object<string, string>} `seen` without what is older: { id: 'YYYY-MM-DD' told }
 */
export function pruneSeen(seen, today) {
  return Object.fromEntries(
    Object.entries(seen).filter(([, told]) => D.parse(told) !== null && today - D.parse(told) <= KEEP_DAYS),
  );
}
