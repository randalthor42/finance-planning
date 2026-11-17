/**
 * @file A heavy, realistic database for performance tests (scripts/lighthouse.mjs): a 10-year plan (horizon 120, the
 * most a plan allows) with every section filled, plus two more plans. Deterministic: the same data on every run.
 *   node scripts/heavy-data.mjs [6|7] > heavy.json   the database, as the app stores it (localStorage "runway.db.v1")
 * Version 7 (the default) is the current format, with dates on every record; 6 is the format before it.
 */
import { pathToFileURL } from 'node:url';
import { APP } from '../src/config.js';
import { D, M } from '../src/core/dates.js';
import { normDB } from '../src/models/db.js';
import { migrate } from '../src/models/migrations.js';
import { normPlan } from '../src/models/plan.js';

/** A small seeded random generator (mulberry32), so every run builds the same plan. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function heavyPlan(name = 'Household', seed = 1) {
  const rnd = random(seed);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const amount = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
  const start = M.now();
  const k = d => M.key(start + d);
  const id = (prefix, i) => (prefix + i.toString(36)).slice(0, 16).padEnd(4, '0');
  const today = D.today();
  const dayIn = (m, d) => {
    const month = start + m;
    return D.key(D.of(Math.floor(month / 12), month % 12, Math.min(28, d)));
  };

  const accounts = [
    { id: 'accmain1', name: 'Main account', type: 'debit', balance: 3200, main: true },
    { id: 'accjoint', name: 'Joint account', type: 'debit', balance: 1450 },
    { id: 'accwall1', name: 'Wallet', type: 'cash', balance: 85 },
    { id: 'accsave1', name: 'Savings', type: 'savings', balance: 12000 },
    { id: 'acccard1', name: 'Credit card', type: 'credit', limit: 3000, owed: 420, apr: 19.9 },
    { id: 'acccard2', name: 'Store card', type: 'credit', limit: 1200, owed: 150, apr: 24 },
  ];
  const incomes = [
    { id: 'salary01', name: 'Salary', amount: 3150, cat: 'salary', day: 26, shift: 'prev', account: 'accmain1' },
    { id: 'salary02', name: 'Partner salary', amount: 2380, cat: 'salary', day: 1, account: 'accjoint' },
    { id: 'side0001', name: 'Freelance design', amount: 600, cat: 'side', every: 2, from: k(1), day: 15 },
    { id: 'bonus001', name: 'Yearly bonus', amount: 2500, cat: 'salary', every: 12, from: k(5), day: 20 },
    { id: 'rent0001', name: 'Room rented out', amount: 420, cat: 'side', from: k(3), to: k(60), day: 3 },
    { id: 'benefit1', name: 'Child benefit', amount: 210, cat: 'benefits', day: 10 },
    { id: 'raise001', name: 'Salary raise', amount: 250, cat: 'salary', from: k(18), day: 26 },
  ];
  const billNames = [
    ['Rent', 1250, 'housing', 1],
    ['Electricity', 95, 'utilities', 8],
    ['Gas', 60, 'utilities', 8],
    ['Water', 35, 'utilities', 14],
    ['Internet', 40, 'utilities', 12],
    ['Mobile phones', 45, 'utilities', 12],
    ['Car insurance', 620, 'insurance', 15, 12],
    ['Home insurance', 240, 'insurance', 3, 12],
    ['Health insurance', 180, 'insurance', 1],
    ['Transport passes', 90, 'transport', 1],
    ['Fuel', 140, 'transport', 18],
    ['Nursery', 380, 'other', 5],
    ['Gym', 55, 'health', 5],
    ['Council tax', 160, 'housing', 20],
    ['Car service', 380, 'transport', 10, 6],
    ['Water heater repair fund', 25, 'housing', 25],
  ];
  const bills = billNames.map(([n, a, cat, day, every], i) => ({
    id: id('bill', i),
    name: n,
    amount: a,
    cat,
    day,
    every: every || 1,
    account: i % 3 ? 'accmain1' : 'accjoint',
    payTo: n === 'Fuel' ? 'acccard1' : null,
  }));
  const subs = ['Streaming video', 'Music', 'Cloud storage', 'News', 'Password manager', 'Language app', 'Podcasts'];
  subs.forEach((n, i) =>
    bills.push({ id: id('subs', i), name: n, amount: amount(3, 18), cat: 'subs', day: 3 + i * 3, account: 'accmain1' }),
  );
  const budgets = [
    ['Groceries', 620, 'food'],
    ['Eating out', 180, 'fun'],
    ['Kids', 150, 'other'],
    ['Clothes', 90, 'shopping'],
    ['Pharmacy', 40, 'health'],
    ['Hobbies', 70, 'fun'],
  ].map(([n, a, cat], i) => ({ id: id('budg', i), name: n, amount: a, cat, budget: true, reserve: i % 2 === 0 }));
  bills.push(...budgets);
  // a price change half-way through the plan, and a bill that ends with a loan
  bills.push({ id: 'rentnew1', name: 'Rent (new lease)', amount: 1320, cat: 'housing', from: k(30), day: 1 });
  bills[0].to = k(29);

  // spending against the budgets in every month of the ten years (5000 entries is the most a plan holds)
  const items = [];
  const shops = ['Supermarket', 'Market', 'Bakery', 'Butcher', 'Pizza night', 'Cinema', 'Shoes', 'Pharmacy', 'Toys'];
  for (let m = 0; m < 120 && items.length < 4300; m++) {
    for (let j = 0; j < 32; j++) {
      const b = pick(budgets);
      const date = dayIn(m, 1 + Math.floor(rnd() * 28));
      if (m === 0 && D.parse(date) > today) {
        continue;
      }
      items.push({
        id: id('sp', items.length),
        name: pick(shops),
        amount: amount(4, b.amount / 6),
        budget: b.id,
        date,
        account: pick(['accmain1', 'accjoint', 'accwall1', 'acccard1']),
      });
    }
  }
  // one-offs: planned purchases, gifts, refunds, sales
  const oneOffs = ['Birthday gift', 'Dentist', 'Car tyres', 'School trip', 'New phone', 'Furniture', 'Wedding gift'];
  for (let i = 0; items.length < 4700; i++) {
    const income = i % 9 === 0;
    items.push({
      id: id('oo', i),
      name: income ? pick(['Tax refund', 'Sold bike', 'Sold sofa']) : pick(oneOffs),
      amount: income ? amount(80, 900) : amount(30, 1200),
      kind: income ? 'in' : 'out',
      cat: income ? 'refund' : pick(['gifts', 'health', 'shopping', 'transport', 'other']),
      month: k(Math.floor(rnd() * 120)),
      note: i % 5 ? '' : 'Planned long ago; check the price again.',
    });
  }

  const places = ['Lisbon', 'Rome', 'Iceland', 'Kyoto', 'Berlin', 'Seville', 'Crete', 'Vienna', 'Prague', 'Oslo'];
  const trips = [];
  for (let i = 0; i < 30; i++) {
    const m = 2 + i * 4;
    const from = dayIn(m, 3 + (i % 10));
    trips.push({
      id: id('trip', i),
      name: `${places[i % places.length]} ${2026 + Math.floor(m / 12)}`,
      kind: i % 7 === 6 ? 'event' : i % 11 === 10 ? 'idea' : 'trip',
      month: k(m),
      from,
      to: D.key(D.parse(from) + 4 + (i % 6)),
      budget: amount(600, 3500),
      items: ['Flights', 'Hotel', 'Food and drinks', 'Getting around', 'Tickets', 'Gifts'].map((n, j) => ({
        id: id(`t${i}i`, j),
        name: n,
        amount: amount(40, 700),
        pay: j < 2 ? k(Math.max(0, m - 3 + j)) : null,
      })),
      note: 'Book early for better prices.',
    });
  }
  const loans = [
    { id: 'loancar1', name: 'Car loan', amount: 18000, rate: 6.5, term: 72, first: k(-14), day: 3, early1: 1 },
    { id: 'loanmor1', name: 'Kitchen renovation', amount: 9500, rate: 7.9, term: 60, first: k(2), day: 10, extra: 50 },
    { id: 'loanstu1', name: 'Student loan', amount: 14000, rate: 2.1, term: 120, first: k(-30), day: 28 },
    { id: 'loanbnpl', name: 'Sofa, interest free', amount: 1200, rate: 0, term: 12, first: k(1), day: 5, feePct: 2 },
  ];
  loans[0].extras = { [k(6)]: 1000, [k(18)]: 1500 };
  const goals = [
    { id: 'goalemer', name: 'Emergency fund', target: 15000, saved: 12000, monthly: 200, rate: 2.5 },
    { id: 'goalhous', name: 'House deposit', target: 60000, saved: 8000, monthly: 550, by: k(96), rate: 3 },
    { id: 'goalcar1', name: 'Next car', target: 12000, saved: 1500, monthly: 180, release: k(70) },
    { id: 'goalkids', name: 'University fund', target: 40000, saved: 3000, monthly: 250, rate: 4 },
    { id: 'goalholi', name: 'Big anniversary trip', target: 7000, saved: 500, monthly: 120, by: k(48) },
  ];
  const wishes = [];
  const wishNames = [
    'Camera',
    'Road bike',
    'Espresso machine',
    'Laptop',
    'Watch',
    'Standing desk',
    'Drone',
    'E-reader',
  ];
  for (let i = 0; i < 40; i++) {
    const how = ['cash', 'save', 'finance'][i % 3];
    wishes.push({
      id: id('wish', i),
      name: `${wishNames[i % wishNames.length]}${i >= wishNames.length ? ' ' + (1 + Math.floor(i / 8)) : ''}`,
      price: amount(80, 2500),
      how,
      month: k(3 + i * 3),
      months: 6 + (i % 18),
      apr: how === 'finance' ? 9.9 : 0,
      on: i % 4 !== 3,
      flex: i % 10 === 9,
      link: i % 6 === 0 ? 'https://example.com/product' : '',
    });
  }
  const notes = {};
  const overrides = {};
  const reserveOver = {};
  for (let m = 0; m < 120; m += 3) {
    notes[k(m)] = 'Check the car insurance renewal and the energy tariff this month.';
    overrides[k(m)] = { ['bill:' + bills[1].id]: amount(80, 140) };
    reserveOver[k(m)] = { ['bill:' + budgets[1].id]: m % 2 === 0 };
  }
  // this month: the bills that are due are ticked, and the balance was checked once
  const paid = { [k(0)]: {} };
  for (const b of bills.slice(0, 8)) {
    paid[k(0)]['bill:' + b.id] = { d: D.key(today), a: 'accmain1', v: -b.amount, t: null };
  }
  const fixes = { [k(0)]: { d: D.key(today), a: -36.4 } };

  return normPlan({
    id: ('plan' + seed).padEnd(8, '0'),
    name,
    settings: {
      currency: 'EUR',
      numFmt: 'eu',
      dateFmt: 'dmy',
      startMonth: k(0),
      horizon: 120,
      opening: 4735,
      cushion: 1500,
      cents: true,
      payDay: 26,
      payShift: 'prev',
    },
    accounts,
    incomes,
    bills,
    items,
    trips,
    loans,
    goals,
    wishes,
    fixes,
    overrides,
    reserveOver,
    paid,
    notes,
  });
}

/** Version 6 data: without what version 7 added. */
const v6 = db =>
  JSON.parse(
    JSON.stringify(db, (k, v) =>
      ['createdAt', 'updatedAt', 'deletedAt', 'deleted', 'deletedPlans', 'schemaVersion', 'fieldsUpdatedAt'].includes(k)
        ? undefined
        : v,
    ),
  );

/**
 * The database: the heavy plan open, two more plans, preferences as a long-time user would have them. version 6: as
 * the app stored it before record dates; 7 and later: migrated up to that schema (with the dates of one fixed
 * moment); by default the current one (APP.schema), as the app stores it now.
 */
export function heavyDb({ version = APP.schema } = {}) {
  const old = { ...v6(heavyDbOf()), v: 6 };
  if (version === 6) {
    return old;
  }
  const db = normDB(migrate(old, { now: Date.UTC(2026, 10, 1), target: version }).db);
  // an older schema says so, as that app stored it (normDB writes the current number)
  db.schemaVersion = db.v = Math.min(version, APP.schema);
  return db;
}
function heavyDbOf() {
  const main = heavyPlan('Household', 1);
  const second = heavyPlan('Household, with the new job', 2);
  const third = normPlan({ ...heavyPlan('Old flat (archive)', 3), items: [] });
  return normDB({
    v: APP.schema,
    active: main.id,
    plans: { [main.id]: main, [second.id]: second, [third.id]: third },
    theme: 'light',
    log: Array.from({ length: 120 }, (_, i) => ({
      t: new Date(Date.now() - i * 36e5).toISOString(),
      text: 'Updated bill “Rent”',
    })),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(heavyDb({ version: +(process.argv[2] || APP.schema) })));
}
