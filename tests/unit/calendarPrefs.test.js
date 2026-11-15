/**
 * @file Unit tests for the calendar settings: defaults, cleaning of stored values, and how they are kept. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AHEAD, CAL_ADD, CAL_LINE, calendarDefaults, normCalendar } from '../../src/models/calendarPrefs.js';
import { normDB } from '../../src/models/db.js';

test('nothing stored gives the defaults: Monday first, every menu option on, spending on the Overview', () => {
  const prefs = normCalendar(undefined);
  assert.deepEqual(prefs, calendarDefaults());
  assert.equal(prefs.weekStart, 1);
  assert.equal(prefs.menus, true);
  assert.ok(CAL_ADD.every(key => prefs.add[key] === true));
  assert.ok(CAL_LINE.every(key => prefs.line[key] === true));
  assert.deepEqual(prefs.overviewGroups, AHEAD);
});

test('cleaning clean settings changes nothing (the defaults and any cleaned value are stable)', () => {
  assert.deepEqual(normCalendar(calendarDefaults()), calendarDefaults());
  const once = normCalendar({ weekStart: 0, overviewGroups: ['wish', 'inc', 'bill'], add: { loan: false } });
  assert.deepEqual(normCalendar(once), once);
});

test('the defaults are a fresh copy each time', () => {
  const a = calendarDefaults();
  a.add.loan = false;
  a.overviewGroups.push('inc');
  assert.equal(calendarDefaults().add.loan, true);
  assert.deepEqual(calendarDefaults().overviewGroups, AHEAD);
});

test('old layout and figure choices are dropped: the page chooses the layout', () => {
  const prefs = normCalendar({
    overviewLayout: 'tablet',
    plannerLayout: 'auto',
    overviewFigure: 'spent',
    plannerFigure: 'none',
  });
  assert.equal('overviewLayout' in prefs, false);
  assert.equal('plannerLayout' in prefs, false);
  assert.equal('overviewFigure' in prefs, false);
  assert.equal(prefs.plannerFigure, 'balance');
});

test('choices are kept', () => {
  const prefs = normCalendar({
    weekStart: 0,
    fixedWeeks: true,
    maxChips: 5,
    trips: false,
    overview: false,
    overviewGroups: ['spend'],
    plannerFigure: 'net',
    menus: false,
    add: { loan: false, goal: false },
    line: { delete: false },
  });
  assert.equal(prefs.weekStart, 0);
  assert.equal(prefs.fixedWeeks, true);
  assert.equal(prefs.maxChips, 5);
  assert.equal(prefs.trips, false);
  assert.equal(prefs.overview, false);
  assert.deepEqual(prefs.overviewGroups, ['spend']);
  assert.equal(prefs.plannerFigure, 'net');
  assert.equal(prefs.menus, false);
  assert.equal(prefs.add.loan, false);
  assert.equal(prefs.add.goal, false);
  assert.equal(prefs.add.expense, true, 'an option not mentioned keeps its default');
  assert.equal(prefs.line.delete, false);
  assert.equal(prefs.line.copy, true);
});

test('bad stored values fall back to the defaults, one by one', () => {
  const prefs = normCalendar({
    weekStart: 3,
    fixedWeeks: 'yes',
    maxChips: 99,
    plannerFigure: 'huge',
    add: { expense: 'no', hack: true },
    line: 'all',
  });
  assert.equal(prefs.weekStart, 1);
  assert.equal(prefs.fixedWeeks, false);
  assert.equal(prefs.maxChips, 6, 'too many lines are capped, not reset');
  assert.equal(normCalendar({ maxChips: 0 }).maxChips, 1);
  assert.equal(normCalendar({ maxChips: 2.5 }).maxChips, 3);
  assert.equal(prefs.plannerFigure, 'balance');
  assert.equal(normCalendar({ plannerFigure: 42 }).plannerFigure, 'balance');
  assert.equal(prefs.add.expense, true);
  assert.equal('hack' in prefs.add, false, 'unknown options are dropped');
  assert.deepEqual(prefs.line, calendarDefaults().line);
});

test('Overview groups: known ones only, once each, in the usual order; never none at all', () => {
  assert.deepEqual(normCalendar({ overviewGroups: ['wish', 'nope', 'bill', 'wish'] }).overviewGroups, ['bill', 'wish']);
  assert.deepEqual(normCalendar({ overviewGroups: [] }).overviewGroups, AHEAD);
  assert.deepEqual(normCalendar({ overviewGroups: ['nope'] }).overviewGroups, AHEAD);
});

test('the stored database keeps the calendar settings and cleans them', () => {
  const db = normDB({ plans: {}, calendar: { weekStart: 0, add: { trip: false } } });
  assert.equal(db.calendar.weekStart, 0);
  assert.equal(db.calendar.add.trip, false);
  assert.equal(normDB({}).calendar.weekStart, 1);
  // saved and read back: the same settings
  assert.deepEqual(normDB(JSON.parse(JSON.stringify(db))).calendar, db.calendar);
});
