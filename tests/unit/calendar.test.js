/**
 * @file Unit tests for the calendar arithmetic: weeks, events on days, spans, totals and the plan adapters. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { D } from '../../src/core/dates.js';
import {
  calendarWeeks,
  dayBalances,
  entryEvents,
  entryGroup,
  eventsIn,
  eventsOn,
  layoutEvents,
  monthRange,
  normEvents,
  totals,
  tripEvents,
  weekPos,
} from '../../src/logic/calendar.js';
import { normPlan } from '../../src/models/plan.js';
import { project } from '../../src/logic/projection.js';

const day = s => D.parse(s);
const keys = week => week.map(n => D.key(n));

test('a month covers whole weeks, starting on Monday by default', () => {
  // November 2026 starts on a Sunday and ends on a Monday
  const { start, end } = monthRange(2026 * 12 + 10);
  assert.equal(D.key(start), '2026-11-01');
  assert.equal(D.key(end), '2026-11-30');
  const weeks = calendarWeeks(start, end);
  assert.equal(weeks.length, 6);
  assert.equal(keys(weeks[0])[0], '2026-10-26');
  assert.equal(keys(weeks[0])[6], '2026-11-01');
  assert.equal(keys(weeks[5])[6], '2026-12-06');
  assert.ok(weeks.every(week => week.length === 7));
});

test('the week can start on Sunday, and a fixed grid always has six weeks', () => {
  // February 2026 starts on a Sunday and has exactly 4 weeks when weeks start on Sunday
  const { start, end } = monthRange(2026 * 12 + 1);
  assert.equal(calendarWeeks(start, end, 0).length, 4);
  assert.equal(weekPos(start, 0), 0);
  assert.equal(weekPos(start, 1), 6);
  const fixed = calendarWeeks(start, end, 0, true);
  assert.equal(fixed.length, 6);
  assert.equal(fixed[5][6] - fixed[0][0], 41);
});

test('a period that follows a payday is covered the same way', () => {
  const weeks = calendarWeeks(day('2026-10-26'), day('2026-11-25'));
  assert.equal(keys(weeks[0])[0], '2026-10-26');
  assert.equal(keys(weeks.at(-1))[6], '2026-11-29');
});

test('events are cleaned: dates as days, bad dates have no day, bad ends are dropped', () => {
  const [a, b, c, d] = normEvents([
    { id: 7, title: 'Rent', date: '2026-11-02', amount: -800 },
    { title: 'Broken', date: '2026-02-30', amount: 'x' },
    { title: 'Backwards', date: day('2026-11-10'), end: '2026-11-01' },
    { title: 'Trip', date: '2026-11-10', end: '2026-11-12', done: 1 },
  ]);
  assert.deepEqual([a.id, a.date, a.amount], ['7', day('2026-11-02'), -800]);
  assert.deepEqual([b.id, b.date, b.amount], ['ev1', null, null]);
  assert.equal(c.end, null);
  assert.deepEqual([d.end, d.done], [day('2026-11-12'), true]);
  assert.deepEqual(normEvents(null), []);
});

test('one-day events land on their day in the order given; undated ones are kept apart', () => {
  const events = normEvents([
    { id: 'a', title: 'A', date: '2026-11-02' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C', date: '2026-11-02' },
    { id: 'far', title: 'Next year', date: '2027-11-02' },
  ]);
  const layout = layoutEvents(events, day('2026-10-26'), day('2026-12-06'));
  assert.deepEqual(
    layout.days.get(day('2026-11-02')).items.map(ev => ev.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    layout.undated.map(ev => ev.id),
    ['b'],
  );
  assert.equal(layout.days.has(day('2027-11-02')), false);
});

test('spans keep one row on every day and never overlap', () => {
  const events = normEvents([
    { id: 'short', title: 'Weekend', date: '2026-11-07', end: '2026-11-08' },
    { id: 'long', title: 'Holiday', date: '2026-11-05', end: '2026-11-10' },
    { id: 'after', title: 'Course', date: '2026-11-11', end: '2026-11-12' },
  ]);
  const layout = layoutEvents(events, day('2026-11-01'), day('2026-11-30'));
  const lanesOn = s => layout.days.get(day(s)).lanes.map(lane => lane && lane.event.id);
  assert.equal(layout.lanes, 2);
  assert.deepEqual(lanesOn('2026-11-05'), ['long']);
  assert.deepEqual(lanesOn('2026-11-07'), ['long', 'short']);
  // a free row is reused once the span in it has ended
  assert.deepEqual(lanesOn('2026-11-11'), ['after']);
  const mid = layout.days.get(day('2026-11-07')).lanes[0];
  assert.deepEqual([mid.first, mid.last, mid.index, mid.length], [false, false, 3, 6]);
  assert.deepEqual(
    eventsOn(layout, day('2026-11-07')).map(ev => ev.id),
    ['long', 'short'],
  );
});

test('a span that starts before the days shown is cut to them, and a gap below a span stays a gap', () => {
  const events = normEvents([
    { id: 'long', title: 'Long', date: '2026-10-20', end: '2026-11-03' },
    { id: 'second', title: 'Second', date: '2026-11-02', end: '2026-11-04' },
  ]);
  const layout = layoutEvents(events, day('2026-11-01'), day('2026-11-30'));
  assert.equal(layout.days.has(day('2026-10-31')), false);
  assert.equal(layout.days.get(day('2026-11-01')).lanes[0].first, false);
  assert.deepEqual(
    layout.days.get(day('2026-11-04')).lanes.map(lane => lane && lane.event.id),
    [null, 'second'],
  );
});

test('totals: in, out, net and count; events without an amount only count', () => {
  const events = normEvents([
    { title: 'Salary', date: '2026-11-01', amount: 2000 },
    { title: 'Rent', date: '2026-11-02', amount: -800.1 },
    { title: 'Food', amount: -200.2 },
    { title: 'Trip', date: '2026-11-05', end: '2026-11-09' },
  ]);
  assert.deepEqual(totals(events), { in: 2000, out: 1000.3, net: 999.7, count: 4 });
  // the period shown: a span that overlaps it counts once, undated lines belong to it
  const shown = eventsIn(events, day('2026-11-08'), day('2026-11-30'));
  assert.deepEqual(
    shown.map(ev => ev.title),
    ['Food', 'Trip'],
  );
});

/* --- adapters --- */

const TODAY = D.parse('2026-11-14');
function sample() {
  const plan = normPlan({
    settings: { startMonth: '2026-11', opening: 100 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000, day: 1 }],
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 400, day: 3 },
      { id: 'food0001', name: 'Food', amount: 300, budget: true },
      { id: 'fun00001', name: 'Fun', amount: 50, budget: true, reserve: false },
    ],
    items: [
      { id: 'shoes001', name: 'Shoes', amount: 50, date: '2026-11-20' },
      { id: 'lunch001', name: 'Lunch', amount: 12, date: '2026-11-10', budget: 'food0001' },
    ],
    trips: [
      { id: 'rome0001', name: 'Rome', month: '2026-11', from: '2026-11-20', to: '2026-11-23', items: [] },
      { id: 'idea0001', name: 'Someday', kind: 'idea', from: '2026-12-01', items: [] },
    ],
  });
  return { plan, month: project(plan, { today: TODAY }).months[0] };
}

test('projected lines become events with their group, day and amount', () => {
  const { month } = sample();
  const events = entryEvents(month);
  const byTitle = Object.fromEntries(events.map(ev => [ev.title, ev]));
  assert.equal(byTitle.Salary.group, 'inc');
  assert.equal(byTitle.Salary.date, D.parse('2026-11-01'));
  assert.equal(byTitle.Rent.amount, -400);
  assert.equal(byTitle.Food.group, 'budget');
  assert.equal(byTitle.Food.date, null);
  assert.equal(byTitle.Lunch.group, 'spend');
  assert.equal(byTitle.Lunch.done, true);
  assert.equal(byTitle.Shoes.group, 'spend');
  // a tracked budget with nothing logged is not a line of the month planner, so it is not an event either
  assert.equal(byTitle.Fun, undefined);
  assert.equal(byTitle.Rent.data.entry.key, 'bill:rent0001');
  assert.equal(byTitle.Rent.id, '2026-11:bill:rent0001');
  assert.equal(entryGroup({ group: 'loan' }), 'loan');
});

test('trips with dates become spans; ideas and trips without dates do not', () => {
  const { plan } = sample();
  const events = tripEvents(plan.trips);
  assert.equal(events.length, 1);
  assert.deepEqual(
    [events[0].title, D.key(events[0].date), D.key(events[0].end), events[0].amount],
    ['Rome', '2026-11-20', '2026-11-23', null],
  );
});

test('the running balance of the last day is where the month ends', () => {
  const { month } = sample();
  const balances = dayBalances(month);
  assert.equal(balances.size, month.end - month.start + 1);
  assert.equal(balances.get(month.end), month.close);
  // the budget has no day, so it is counted on the first day with the salary
  assert.equal(balances.get(month.start), 100 + 1000 - (300 - 12));
  assert.equal(balances.get(D.parse('2026-11-03')), balances.get(month.start) - 400);
});

test('the next 7 days: payments still due, their total, and the lowest end-of-day balance', async () => {
  const { normPlan } = await import('../../src/models/plan.js');
  const { project } = await import('../../src/logic/projection.js');
  const { nextDays, dayBalances } = await import('../../src/logic/calendar.js');
  const { D: Days } = await import('../../src/core/dates.js');
  const plan = normPlan({
    settings: { startMonth: '2026-11', opening: 500 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1000, day: 25 }],
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 400, day: 16 },
      { id: 'phone001', name: 'Phone', amount: 30, day: 18 },
      { id: 'gym00001', name: 'Gym', amount: 20, day: 28 },
    ],
  });
  const today = Days.parse('2026-11-15');
  const months = project(plan, { today }).months;
  const next = nextDays(months, today);
  assert.equal(next.payments, 2, 'rent on the 16th and phone on the 18th; the gym on the 28th is later');
  assert.equal(next.out, 430);
  assert.equal(next.lowest.balance, dayBalances(months[0]).get(Days.parse('2026-11-21')));
});
