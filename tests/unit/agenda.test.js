/**
 * @file Unit tests for "My calendar": the agenda stored in a plan (normPlan), repeating appointments, drafts and what
 * applying them would change. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { D, M } from '../../src/core/dates.js';
import { normPlan } from '../../src/models/plan.js';
import { AGENDA_LAYERS, AGENDA_MAX, DEFAULT_LAYERS } from '../../src/models/agenda.js';
import { project } from '../../src/logic/projection.js';
import {
  agendaEvents,
  categoryFilter,
  draftCount,
  draftEvents,
  deleteOccurrence,
  draftImpact,
  draftIds,
  editOccurrence,
  moveDrafts,
  occurrences,
  pinKey,
  prepareEntries,
  withDrafts,
} from '../../src/logic/agenda.js';

const day = s => D.parse(s);
const keys = list => list.map(n => D.key(n));
/** Start days of one entry's occurrences between two dates (inclusive). */
const occ = (entry, from, to) => keys(occurrences(prepareEntries([entry])[0], day(from), day(to)));
/** One clean appointment with the given fields. */
const appointment = fields =>
  normPlan({ agenda: { entries: [{ title: 'A', date: '2026-11-10', ...fields }] } }).agenda.entries[0];

/* ---------- the stored agenda ---------- */

test('a plan without an agenda gets an empty one: one calendar, no entries, no drafts, a few layers', () => {
  const { agenda } = normPlan({});
  assert.equal(agenda.name, '');
  assert.equal(agenda.cals.length, 1);
  assert.equal(agenda.cals[0].id, 'personal');
  assert.equal(agenda.cals[0].tone, 'acc');
  assert.deepEqual(agenda.entries, []);
  assert.deepEqual(agenda.drafts, { items: [], trips: [] });
  assert.deepEqual(agenda.layers, DEFAULT_LAYERS);
  assert.deepEqual(agenda.cats, []);
  assert.equal(agenda.figure, 'balance');
  assert.deepEqual(agenda.pins, []);
});

test('normalising the agenda twice changes nothing', () => {
  const once = normPlan({
    bills: [{ id: 'groc0001', name: 'Groceries', amount: 300, budget: true, cat: 'food' }],
    agenda: {
      name: 'Family',
      cals: [{ id: 'work0001', name: 'Work', tone: 'trip' }, { name: 'Kids' }],
      entries: [
        { title: 'Dentist', date: '2026-11-10', time: '09:30', endTime: '10:15', cal: 'work0001' },
        { title: 'Swim', date: '2026-11-03', repeat: 'week', until: '2026-12-31', skip: ['2026-11-17'] },
      ],
      layers: ['trip', 'inc'],
      cats: ['food', 'fun'],
      figure: 'spent',
      drafts: {
        items: [{ name: 'Concert', amount: 60, date: '2026-11-21', budget: 'groc0001' }],
        trips: [{ name: 'Rome', from: '2026-12-04', to: '2026-12-07', items: [{ name: 'Flights', amount: 180 }] }],
      },
    },
  });
  assert.equal(JSON.stringify(normPlan(once)), JSON.stringify(once));
  assert.equal(once.agenda.name, 'Family');
  assert.deepEqual(once.agenda.layers, ['inc', 'trip'], 'known layers, in the usual order');
});

test('garbage in the agenda never throws and never gets through', () => {
  const { agenda } = normPlan({
    agenda: {
      name: 5,
      cals: 'x',
      entries: [
        null,
        { title: 'No date' },
        { title: 'Bad date', date: '2026-02-30' },
        { title: 'Ok', date: '2026-11-10', end: '2026-11-01', time: '25:00', endTime: 'soon', repeat: 'hourly' },
        { title: 'Until before', date: '2026-11-10', repeat: 'week', until: '2026-11-01', skip: 'x' },
        { title: 'Ghost calendar', date: '2026-11-10', cal: 'nothere1' },
      ],
      layers: ['inc', 'nope', 'inc'],
      cats: ['food', 'food', 'martian'],
      figure: 'everything',
      drafts: 'x',
    },
  });
  assert.equal(agenda.name, '');
  assert.equal(agenda.cals.length, 1, 'at least one calendar is always there');
  assert.deepEqual(
    agenda.entries.map(e => e.title),
    ['Ok', 'Until before', 'Ghost calendar'],
    'entries without a real day are dropped',
  );
  const [ok, until, ghost] = agenda.entries;
  assert.deepEqual([ok.end, ok.time, ok.endTime, ok.repeat], [null, '', '', 'none']);
  assert.deepEqual([until.until, until.skip], [null, []]);
  assert.equal(ghost.cal, agenda.cals[0].id, 'an entry of a calendar that is gone lands in the first one');
  assert.deepEqual(agenda.layers, ['inc']);
  assert.deepEqual(agenda.cats, ['food']);
  assert.equal(agenda.figure, 'balance');
  assert.deepEqual(agenda.drafts, { items: [], trips: [] });
  assert.doesNotThrow(() => normPlan({ agenda: null }));
  assert.doesNotThrow(() => normPlan({ agenda: [] }));
});

test('an end time before the start time is dropped; an end time alone is not kept', () => {
  assert.equal(appointment({ time: '10:00', endTime: '09:00' }).endTime, '');
  assert.equal(appointment({ endTime: '09:00' }).endTime, '');
  assert.deepEqual([appointment({ time: '9:05' }).time, appointment({ time: '09:05' }).time], ['', '09:05']);
});

test('the agenda has limits, like every list of the plan', () => {
  const many = Array.from({ length: AGENDA_MAX.entries + 20 }, (_, i) => ({ title: 'E' + i, date: '2026-11-10' }));
  const cals = Array.from({ length: AGENDA_MAX.cals + 5 }, (_, i) => ({ name: 'C' + i }));
  const { agenda } = normPlan({ agenda: { entries: many, cals } });
  assert.equal(agenda.entries.length, AGENDA_MAX.entries);
  assert.equal(agenda.cals.length, AGENDA_MAX.cals);
  assert.ok(AGENDA_LAYERS.includes('inc') && AGENDA_LAYERS.includes('trip'));
});

test('drafts are cleaned like the records they will become', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', payDay: 25, payFor: 'next' },
    bills: [{ id: 'groc0001', name: 'Groceries', amount: 300, budget: true, cat: 'food' }],
    agenda: {
      drafts: {
        items: [
          { name: 'Late in the month', amount: '45.5', date: '2026-11-27', kind: 'out', cat: 'fun' },
          { name: 'From a budget', amount: 30, date: '2026-11-10', budget: 'groc0001' },
          { name: 'Unknown budget', amount: 30, date: '2026-11-10', budget: 'nothere1' },
        ],
        trips: [
          { name: 'Rome', kind: 'trip', from: '2026-12-04', to: '2026-12-01', items: [{ name: 'Hotel', amount: -5 }] },
        ],
      },
    },
  });
  const [late, budget, unknown] = plan.agenda.drafts.items;
  assert.equal(late.amount, 45.5);
  assert.equal(late.month, '2026-12', 'a day after the payday belongs to the next budget month');
  assert.equal(budget.budget, 'groc0001');
  assert.equal(unknown.budget, null);
  const [trip] = plan.agenda.drafts.trips;
  assert.equal(trip.to, null, 'a last day before the first day is dropped');
  assert.equal(trip.items[0].amount, 0);
});

test('draft ids never collide with the ids of the plan', () => {
  const plan = normPlan({
    items: [{ id: 'same0001', name: 'Real', amount: 10, month: '2026-11' }],
    agenda: { drafts: { items: [{ id: 'same0001', name: 'Draft', amount: 20, month: '2026-11' }] } },
  });
  assert.equal(plan.items[0].id, 'same0001', 'the real record keeps its id');
  assert.notEqual(plan.agenda.drafts.items[0].id, 'same0001');
});

test('drafts and appointments do not change a single number of the projection', () => {
  const base = {
    settings: { startMonth: '2026-11', horizon: 6, opening: 1000 },
    incomes: [{ name: 'Salary', amount: 2000, day: 1 }],
  };
  const plain = project(normPlan(base), { today: day('2026-11-05') });
  const busy = project(
    normPlan({
      ...base,
      agenda: {
        entries: [{ title: 'Dentist', date: '2026-11-10' }],
        drafts: { items: [{ name: 'TV', amount: 900, date: '2026-11-20' }] },
      },
    }),
    { today: day('2026-11-05') },
  );
  assert.deepEqual(
    busy.months.map(m => m.close),
    plain.months.map(m => m.close),
  );
});

/* ---------- repeating appointments ---------- */

test('an appointment that does not repeat happens once', () => {
  assert.deepEqual(occ(appointment({}), '2026-11-01', '2026-11-30'), ['2026-11-10']);
  assert.deepEqual(occ(appointment({}), '2026-12-01', '2026-12-31'), []);
});

test('a span that started before the days shown is still found', () => {
  const e = appointment({ date: '2026-10-28', end: '2026-11-02' });
  assert.deepEqual(occ(e, '2026-11-01', '2026-11-30'), ['2026-10-28']);
  assert.deepEqual(occ(e, '2026-11-03', '2026-11-30'), []);
});

test('every day, week, month and year', () => {
  assert.deepEqual(occ(appointment({ repeat: 'day' }), '2026-11-08', '2026-11-12'), [
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
  ]);
  assert.deepEqual(occ(appointment({ repeat: 'week' }), '2026-11-01', '2026-12-06'), [
    '2026-11-10',
    '2026-11-17',
    '2026-11-24',
    '2026-12-01',
  ]);
  assert.deepEqual(occ(appointment({ repeat: 'month' }), '2026-11-01', '2027-01-31'), [
    '2026-11-10',
    '2026-12-10',
    '2027-01-10',
  ]);
  assert.deepEqual(occ(appointment({ repeat: 'year' }), '2026-01-01', '2029-12-31'), [
    '2026-11-10',
    '2027-11-10',
    '2028-11-10',
    '2029-11-10',
  ]);
});

test('the 31st of each month falls on the last day of shorter months, as bills do; 29 February on the 28th', () => {
  assert.deepEqual(occ(appointment({ date: '2026-01-31', repeat: 'month' }), '2026-02-01', '2026-04-30'), [
    '2026-02-28',
    '2026-03-31',
    '2026-04-30',
  ]);
  assert.deepEqual(occ(appointment({ date: '2028-02-29', repeat: 'year' }), '2029-01-01', '2029-12-31'), [
    '2029-02-28',
  ]);
});

test('a repeat stops after its last day and leaves out the days skipped', () => {
  const e = appointment({ repeat: 'week', until: '2026-11-24', skip: ['2026-11-17'] });
  assert.deepEqual(occ(e, '2026-11-01', '2026-12-31'), ['2026-11-10', '2026-11-24']);
});

test('a repeating span keeps its length and shows while it overlaps the days shown', () => {
  // Friday to Sunday, every week
  const e = appointment({ date: '2026-11-06', end: '2026-11-08', repeat: 'week' });
  assert.deepEqual(occ(e, '2026-11-15', '2026-11-21'), ['2026-11-13', '2026-11-20']);
});

test('years after the first day, a daily or weekly repeat is found without walking through every day', () => {
  const e = prepareEntries([appointment({ date: '1990-01-01', repeat: 'day' })])[0];
  const t0 = performance.now();
  const found = occurrences(e, day('2150-06-01'), day('2150-06-07'));
  assert.equal(found.length, 7);
  assert.ok(performance.now() - t0 < 5, 'arithmetic, not a walk over 160 years of days');
});

/* ---------- on the calendar ---------- */

test('appointments become calendar events of their calendar, ordered by day then time', () => {
  const { agenda } = normPlan({
    agenda: {
      cals: [
        { id: 'personal', name: 'Personal' },
        { id: 'work0001', name: 'Work', tone: 'trip' },
      ],
      entries: [
        { id: 'late0001', title: 'Dinner', date: '2026-11-10', time: '19:00' },
        { id: 'allday01', title: 'Holiday', date: '2026-11-10' },
        { id: 'early001', title: 'Standup', date: '2026-11-10', time: '09:00', cal: 'work0001' },
        { id: 'week0001', title: 'Swim', date: '2026-11-02', repeat: 'week' },
      ],
    },
  });
  const events = agendaEvents(agenda, day('2026-11-09'), day('2026-11-15'));
  assert.deepEqual(
    events.map(ev => ev.title),
    ['Swim', 'Holiday', 'Standup', 'Dinner'],
    'all-day first, then by time',
  );
  const standup = events.find(ev => ev.title === 'Standup');
  assert.equal(standup.group, 'cal:work0001');
  assert.equal(standup.time, '09:00');
  assert.equal(standup.amount, null, 'an appointment has no money');
  assert.equal(standup.data.agenda.id, 'early001');
  const swim = events.find(ev => ev.title === 'Swim');
  assert.equal(D.key(swim.date), '2026-11-09');
  assert.equal(swim.id, 'agenda:week0001:' + day('2026-11-09'), 'each occurrence has its own id');
  assert.equal(D.key(swim.data.day), '2026-11-09');
});

test('drafts become tentative events with their amounts; undated ones only in their month', () => {
  const { agenda } = normPlan({
    agenda: {
      drafts: {
        items: [
          { id: 'tv000001', name: 'TV', amount: 900, date: '2026-11-20' },
          { id: 'bonus001', name: 'Bonus', amount: 300, kind: 'in', month: '2026-12' },
        ],
        trips: [
          {
            id: 'rome0001',
            name: 'Rome',
            from: '2026-12-04',
            to: '2026-12-07',
            items: [
              { name: 'Flights', amount: 180 },
              { name: 'Hotel', amount: 320 },
            ],
          },
        ],
      },
    },
  });
  const nov = draftEvents(agenda.drafts, M.parse('2026-11'));
  assert.deepEqual(
    nov.map(ev => [ev.title, ev.amount, ev.tentative, ev.group]),
    [
      ['TV', -900, true, 'draft'],
      ['Rome', -500, true, 'draft'],
    ],
  );
  const rome = nov.find(ev => ev.title === 'Rome');
  assert.deepEqual([D.key(rome.date), D.key(rome.end)], ['2026-12-04', '2026-12-07']);
  assert.deepEqual(rome.data.draft, { list: 'trips', id: 'rome0001' });
  const dec = draftEvents(agenda.drafts, M.parse('2026-12'));
  assert.ok(dec.some(ev => ev.title === 'Bonus' && ev.date === null && ev.amount === 300));
  assert.equal(draftCount(agenda.drafts), 3);
  assert.deepEqual(draftIds(agenda.drafts).sort(), ['bonus001', 'rome0001', 'tv000001']);
});

test('a category filter keeps spending of the chosen categories and everything that is not spending', () => {
  const ev = (group, cat) => ({ group, data: { entry: { cat } } });
  assert.equal(categoryFilter([]), null, 'no categories chosen: no filter at all');
  const keep = categoryFilter(['food']);
  assert.equal(keep(ev('bill', 'food')), true);
  assert.equal(keep(ev('bill', 'housing')), false);
  assert.equal(keep(ev('budget', 'fun')), false);
  assert.equal(keep(ev('spend', 'food')), true);
  assert.equal(keep(ev('inc', 'salary')), true, 'income is not spending');
  assert.equal(keep(ev('trip', 'travel')), true, 'trips have their own layer');
  assert.equal(keep({ group: 'trip', data: { trip: {} } }), true);
});

test('a spend logged against a budget has the category of its budget', () => {
  const budgets = new Map([['groc0001', 'food']]);
  const keep = categoryFilter(['food'], budgets);
  const spend = cat => ({ group: 'spend', data: { entry: { cat, of: 'groc0001' } } });
  assert.equal(keep(spend('other')), true, 'logged without a category of its own');
  assert.equal(categoryFilter(['fun'], budgets)(spend('food')), false);
});

/* ---------- applying drafts ---------- */

const withTv = () =>
  normPlan({
    settings: { startMonth: '2026-11', horizon: 6, opening: 500, cushion: 100 },
    incomes: [{ name: 'Salary', amount: 1000, day: 1 }],
    bills: [{ name: 'Rent', amount: 900, day: 2 }],
    agenda: {
      drafts: {
        items: [
          { id: 'tv000001', name: 'TV', amount: 800, date: '2026-11-20' },
          { id: 'lamp0001', name: 'Lamp', amount: 40, date: '2026-12-03' },
        ],
        trips: [{ id: 'rome0001', name: 'Rome', from: '2027-01-04', items: [{ name: 'Flights', amount: 150 }] }],
      },
    },
  });

test('withDrafts adds the chosen drafts to a copy of the plan and leaves the plan as it was', () => {
  const plan = withTv();
  const before = JSON.stringify(plan);
  const copy = withDrafts(plan, ['tv000001', 'rome0001']);
  assert.equal(JSON.stringify(plan), before);
  assert.deepEqual(
    copy.items.map(i => i.name),
    ['TV'],
  );
  assert.deepEqual(
    copy.trips.map(t => t.name),
    ['Rome'],
  );
  assert.equal(copy.agenda.drafts.items.length, 1, 'the copy no longer has them as drafts');
});

test('moveDrafts turns the chosen drafts into plan records, once', () => {
  const draft = JSON.parse(JSON.stringify(withTv()));
  assert.equal(moveDrafts(draft, ['tv000001', 'rome0001', 'nothere1']), 2);
  const plan = normPlan(draft);
  assert.deepEqual(
    plan.items.map(i => [i.id, i.name]),
    [['tv000001', 'TV']],
  );
  assert.deepEqual(
    plan.trips.map(t => t.id),
    ['rome0001'],
  );
  assert.deepEqual(
    plan.agenda.drafts.items.map(i => i.id),
    ['lamp0001'],
  );
  assert.deepEqual(plan.agenda.drafts.trips, []);
  assert.equal(moveDrafts(draft, ['tv000001']), 0, 'applied drafts are gone');
});

test('draftImpact says what the chosen drafts would do to the months', () => {
  const plan = withTv();
  const today = day('2026-11-05');
  const base = project(plan, { today });
  const impact = draftImpact(plan, base, ['tv000001'], today);
  assert.equal(impact.out, 800);
  assert.equal(impact.in, 0);
  assert.equal(impact.before.end, base.summary.end);
  assert.equal(impact.after.end, base.summary.end - 800);
  assert.equal(impact.before.negative, 0);
  assert.ok(impact.after.negative > 0, 'the TV takes the plan below zero');
  assert.equal(impact.after.firstNeg, M.parse('2026-11'));
  assert.ok(impact.after.lowest < impact.before.lowest);
  const none = draftImpact(plan, base, [], today);
  assert.deepEqual(none.after, none.before);
});

/* ---------- records of the plan pinned to the calendar ---------- */

test('pins point at records that exist, once each; the rest is dropped', () => {
  const plan = normPlan({
    trips: [{ id: 'rome0001', name: 'Rome', from: '2026-12-04' }],
    wishes: [{ id: 'sofa0001', name: 'Sofa', price: 900 }],
    agenda: {
      pins: [
        { list: 'trips', id: 'rome0001' },
        { list: 'trips', id: 'rome0001' },
        { list: 'wishes', id: 'sofa0001' },
        { list: 'trips', id: 'sofa0001' },
        { list: 'accounts', id: 'x' },
        { list: 'items', id: 'gone0001' },
        'rubbish',
      ],
    },
  });
  assert.deepEqual(plan.agenda.pins, [
    { list: 'trips', id: 'rome0001' },
    { list: 'wishes', id: 'sofa0001' },
  ]);
  assert.equal(JSON.stringify(normPlan(plan)), JSON.stringify(plan));
});

test('applied drafts are pinned, so they stay on the calendar whatever it shows of the plan', () => {
  const draft = JSON.parse(JSON.stringify(withTv()));
  moveDrafts(draft, ['tv000001', 'rome0001']);
  const plan = normPlan(draft);
  assert.deepEqual(plan.agenda.pins, [
    { list: 'items', id: 'tv000001' },
    { list: 'trips', id: 'rome0001' },
  ]);
});

test('pinKey says which record a plan event comes from', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 3 },
    bills: [{ id: 'rent0001', name: 'Rent', amount: 800, day: 2 }],
    items: [{ id: 'tv000001', name: 'TV', amount: 800, date: '2026-11-20' }],
    trips: [
      { id: 'rome0001', name: 'Rome', month: '2026-11', items: [{ id: 'fly00001', name: 'Flights', amount: 100 }] },
    ],
  });
  const month = project(plan).months[0];
  const byLabel = label => ({ data: { entry: month.entries.find(e => e.label === label) } });
  assert.equal(pinKey(byLabel('Rent')), 'bills:rent0001');
  assert.equal(pinKey(byLabel('TV')), 'items:tv000001');
  assert.equal(pinKey(byLabel('Flights')), 'trips:rome0001');
  assert.equal(pinKey({ data: { trip: { id: 'rome0001' } } }), 'trips:rome0001');
  assert.equal(pinKey({ data: { entry: { key: 'adjust', group: 'adjust' } } }), null);
  assert.equal(pinKey({ data: {} }), null);
});

/* ---------- money on appointments ---------- */

test('an appointment can cost or bring money; it counts only when switched on, and only with an amount', () => {
  const { agenda } = normPlan({
    agenda: {
      entries: [
        { title: 'Dentist', date: '2026-11-10', amount: 60, on: true },
        { title: 'Babysitting', date: '2026-11-11', amount: '45', kind: 'in', cat: 'side' },
        { title: 'Coffee', date: '2026-11-12', amount: 0, on: true },
        { title: 'Odd', date: '2026-11-13', amount: -5, kind: 'sideways', cat: 'nope' },
      ],
    },
  });
  const [dentist, sitting, coffee, odd] = agenda.entries;
  assert.deepEqual([dentist.amount, dentist.kind, dentist.cat, dentist.on], [60, 'out', 'other', true]);
  assert.deepEqual([sitting.amount, sitting.kind, sitting.cat, sitting.on], [45, 'in', 'side', false]);
  assert.equal(coffee.on, false, 'nothing to count');
  assert.deepEqual([odd.amount, odd.kind, odd.cat], [0, 'out', 'other']);
});

const moneyPlan = entries =>
  normPlan({
    settings: { startMonth: '2026-11', horizon: 3, opening: 1000 },
    agenda: { entries },
  });

test('a counted appointment is a ledger line on its day, once per occurrence, in the months of the plan', () => {
  const plan = moneyPlan([
    { id: 'dent0001', title: 'Dentist', date: '2026-11-10', amount: 60, on: true, cat: 'health' },
    { id: 'swim0001', title: 'Swim', date: '2026-12-28', amount: 5, on: true, repeat: 'week' },
    { id: 'gift0001', title: 'Not counted', date: '2026-11-10', amount: 500 },
    { id: 'late0001', title: 'After the plan', date: '2027-06-01', amount: 70, on: true },
  ]);
  const proj = project(plan, { today: day('2026-11-05') });
  const lines = proj.months.flatMap(m => m.entries.filter(e => e.key.startsWith('appt:')).map(e => [m.key, e]));
  const dentist = lines.find(([, e]) => e.label === 'Dentist');
  assert.equal(dentist[0], '2026-11');
  assert.deepEqual(
    [dentist[1].amount, dentist[1].date, dentist[1].group, dentist[1].cat, dentist[1].id],
    [-60, day('2026-11-10'), 'item', 'health', 'dent0001'],
  );
  assert.equal(dentist[1].key, 'appt:dent0001:' + day('2026-11-10'));
  const swims = lines.filter(([, e]) => e.label === 'Swim');
  assert.deepEqual(
    swims.map(([k, e]) => k + ' ' + D.key(e.date)),
    [
      '2026-12 2026-12-28',
      '2027-01 2027-01-04',
      '2027-01 2027-01-11',
      '2027-01-18'.replace(/^/, '2027-01 '),
      '2027-01 2027-01-25',
    ],
  );
  assert.ok(!lines.some(([, e]) => e.label === 'Not counted' || e.label === 'After the plan'));
  assert.equal(proj.months[0].close, 1000 - 60);
});

test('a line of a counted appointment can be ticked off like any other', () => {
  const key = 'appt:dent0001:' + day('2026-11-10');
  const plan = normPlan({
    settings: { startMonth: '2026-11', horizon: 3 },
    agenda: { entries: [{ id: 'dent0001', title: 'Dentist', date: '2026-11-10', amount: 60, on: true }] },
    paid: { '2026-11': { [key]: { d: '2026-11-10', a: null, v: 0, t: null } } },
  });
  assert.ok(plan.paid['2026-11'][key], 'the key of an appointment line is a key the plan keeps');
  const line = project(plan).months[0].entries.find(e => e.key === key);
  assert.equal(line.paid, true);
});

test('money of an appointment that is not counted yet is a draft: listed, shown tentative, applied by switching it on', () => {
  const plan = moneyPlan([
    { id: 'dent0001', title: 'Dentist', date: '2026-11-10', amount: 60 },
    { id: 'gym00001', title: 'Gym', date: '2026-11-11', amount: 30, on: true },
    { id: 'walk0001', title: 'Walk', date: '2026-11-12' },
  ]);
  assert.equal(draftCount(plan.agenda.drafts, plan.agenda), 1);
  assert.deepEqual(draftIds(plan.agenda.drafts, plan.agenda), ['dent0001']);
  const events = agendaEvents(plan.agenda, day('2026-11-01'), day('2026-11-30'));
  const by = t => events.find(ev => ev.title === t);
  assert.deepEqual([by('Dentist').amount, by('Dentist').tentative], [-60, true]);
  assert.deepEqual([by('Gym').amount, by('Gym').tentative], [-30, false]);
  assert.deepEqual([by('Walk').amount, !!by('Walk').tentative], [null, false]);
  const today = day('2026-11-05');
  const base = project(plan, { today });
  assert.equal(draftImpact(plan, base, ['dent0001'], today).out, 60);
  const draft = JSON.parse(JSON.stringify(plan));
  assert.equal(moveDrafts(draft, ['dent0001']), 1);
  assert.equal(normPlan(draft).agenda.entries[0].on, true);
});

/* ---------- one day of a repeating appointment ---------- */

const weekly = () =>
  normPlan({
    agenda: {
      entries: [
        {
          id: 'swim0001',
          title: 'Swim',
          date: '2026-11-02',
          time: '18:00',
          repeat: 'week',
          until: '2026-12-28',
          skip: ['2026-11-23'],
        },
      ],
    },
  }).agenda;
let n = 0;
const newId = () => 'new' + String(++n).padStart(5, '0');
const clean = agenda => normPlan({ agenda }).agenda;
const startsOf = (agenda, from = '2026-10-01', to = '2027-01-31') =>
  agendaEvents(agenda, day(from), day(to)).map(ev => D.key(ev.date) + ' ' + ev.title + (ev.time ? ' ' + ev.time : ''));
/** What the window shows for the occurrence of `day`: the series, on that day. */
const at = (agenda, d) => ({ ...agenda.entries[0], date: d, end: null });

test('editing this day only: the day leaves the repeat and becomes an appointment of its own', () => {
  const a = weekly();
  editOccurrence(a, 'swim0001', day('2026-11-09'), { ...at(a, '2026-11-09'), time: '19:30' }, 'one', newId);
  const c = clean(a);
  assert.deepEqual(startsOf(c).slice(0, 3), [
    '2026-11-02 Swim 18:00',
    '2026-11-09 Swim 19:30',
    '2026-11-16 Swim 18:00',
  ]);
  const single = c.entries.find(e => e.id !== 'swim0001');
  assert.deepEqual([single.repeat, single.series, single.date], ['none', 'swim0001', '2026-11-09']);
  assert.ok(c.entries[0].skip.includes('2026-11-09'));
});

test('editing this and following days: the repeat ends the day before and a new one starts', () => {
  const a = weekly();
  editOccurrence(a, 'swim0001', day('2026-11-16'), { ...at(a, '2026-11-16'), time: '07:00' }, 'following', newId);
  const c = clean(a);
  assert.deepEqual(startsOf(c), [
    '2026-11-02 Swim 18:00',
    '2026-11-09 Swim 18:00',
    '2026-11-16 Swim 07:00',
    '2026-11-30 Swim 07:00',
    '2026-12-07 Swim 07:00',
    '2026-12-14 Swim 07:00',
    '2026-12-21 Swim 07:00',
    '2026-12-28 Swim 07:00',
  ]);
  const [old, next] = c.entries;
  assert.equal(old.until, '2026-11-15');
  assert.deepEqual(
    [next.series, next.until, next.skip],
    ['swim0001', '2026-12-28', ['2026-11-23']],
    'keeps its end and skipped days',
  );
});

test('this and following from the first day is every day', () => {
  const a = weekly();
  editOccurrence(a, 'swim0001', day('2026-11-02'), { ...at(a, '2026-11-02'), title: 'Swimming' }, 'following', newId);
  assert.deepEqual(
    clean(a).entries.map(e => [e.id, e.title]),
    [['swim0001', 'Swimming']],
  );
});

test('editing every day changes the whole repeat; moving the day moves every day, skipped ones too', () => {
  const a = weekly();
  editOccurrence(a, 'swim0001', day('2026-11-16'), { ...at(a, '2026-11-17'), title: 'Pool' }, 'all', newId);
  const [e] = clean(a).entries;
  assert.deepEqual([e.title, e.date, e.until, e.skip], ['Pool', '2026-11-03', '2026-12-29', ['2026-11-24']]);
});

test('changes to every day reach the days changed on their own, for the fields that were changed', () => {
  const a = weekly();
  editOccurrence(a, 'swim0001', day('2026-11-09'), { ...at(a, '2026-11-09'), time: '19:30' }, 'one', newId);
  editOccurrence(a, 'swim0001', day('2026-11-02'), { ...at(a, '2026-11-02'), title: 'Pool' }, 'all', newId);
  const c = clean(a);
  assert.deepEqual(startsOf(c).slice(0, 2), ['2026-11-02 Pool 18:00', '2026-11-09 Pool 19:30'], 'its own time stays');
});

test('deleting one day, this and following, or every day', () => {
  let a = weekly();
  deleteOccurrence(a, 'swim0001', day('2026-11-09'), 'one');
  assert.ok(!startsOf(clean(a)).some(s => s.startsWith('2026-11-09')));
  a = weekly();
  editOccurrence(a, 'swim0001', day('2026-12-07'), { ...at(a, '2026-12-07'), time: '08:00' }, 'one', newId);
  deleteOccurrence(a, 'swim0001', day('2026-11-16'), 'following');
  assert.deepEqual(
    startsOf(clean(a)),
    ['2026-11-02 Swim 18:00', '2026-11-09 Swim 18:00'],
    'days changed on their own go too',
  );
  a = weekly();
  editOccurrence(a, 'swim0001', day('2026-11-16'), { ...at(a, '2026-11-16'), time: '07:00' }, 'following', newId);
  const piece = a.entries.find(e => e.id !== 'swim0001').id;
  deleteOccurrence(a, piece, day('2026-12-07'), 'all');
  assert.deepEqual(clean(a).entries, [], 'every day is every piece of it');
  a = weekly();
  deleteOccurrence(a, 'swim0001', day('2026-11-02'), 'following');
  assert.deepEqual(a.entries, [], 'from the first day on is all of it');
});
