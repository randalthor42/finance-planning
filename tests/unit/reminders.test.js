/**
 * @file Unit tests for bill reminders (which payments are due soon or overdue, which were already told) and for hiding
 * amounts on screen (what is masked, and that the activity log keeps the real amounts). Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { D } from '../../src/core/dates.js';
import { FMT, MASK, compact, maskMoney, money, plainMoney, setFmt, signed } from '../../src/core/format.js';
import { dueReminders, newReminders, pruneSeen } from '../../src/logic/reminders.js';
import { project } from '../../src/logic/projection.js';
import { normDB } from '../../src/models/db.js';
import { normPlan } from '../../src/models/plan.js';

const day = s => D.parse(s);
const plan = normPlan({
  settings: { startMonth: '2026-11', horizon: 3, opening: 3000 },
  accounts: [{ name: 'Main', type: 'debit', balance: 3000 }],
  incomes: [{ id: 'salary01', name: 'Salary', amount: 2000, day: 10 }],
  bills: [
    { id: 'rent0001', name: 'Rent', amount: 800, day: 10, cat: 'housing' },
    { id: 'gym00001', name: 'Gym', amount: 30, day: 5, cat: 'health' },
    { id: 'nflx0001', name: 'Streaming', amount: 12, day: 12, cat: 'subs' },
    { id: 'phone001', name: 'Phone', amount: 20, day: 11, cat: 'utilities' },
    { id: 'groc0001', name: 'Groceries', amount: 300, cat: 'food', budget: true },
  ],
  loans: [{ id: 'car00001', name: 'Car loan', amount: 6000, term: 24, first: '2026-11', day: 11 }],
  items: [
    { id: 'tv000001', name: 'TV', amount: 500, date: '2026-11-11' },
    { id: 'spend001', name: 'Market', amount: 20, date: '2026-11-11', budget: 'groc0001' },
  ],
  paid: { '2026-11': { 'bill:phone001': { d: '2026-11-01', a: null, v: 0, t: null } } },
});
const months = project(plan, { today: day('2026-11-09') }).months;
const ALL = { bill: true, loan: true, oneoff: true };
const due = (o = {}) => dueReminders(months, { today: day('2026-11-09'), days: 2, kinds: ALL, ...o });

test('payments due in the next days: bills, loan payments and one-off payments, soonest first', () => {
  const list = due();
  assert.deepEqual(
    list.map(r => [r.label, r.kind, r.daysLeft]),
    [
      ['Gym', 'bill', -4],
      ['Rent', 'bill', 1],
      ['Car loan', 'loan', 2],
      ['TV', 'oneoff', 2],
    ],
  );
  const rent = list.find(r => r.label === 'Rent');
  assert.equal(rent.amount, 800);
  assert.equal(rent.overdue, false);
  assert.equal(list[0].overdue, true, 'a bill whose day passed without being ticked is overdue');
});

test('not reminded: money in, budgets (no day), paid lines, spends already logged, lines further away', () => {
  const labels = due().map(r => r.label);
  for (const label of ['Salary', 'Groceries', 'Phone', 'Market', 'Streaming']) {
    assert.ok(!labels.includes(label), label);
  }
  assert.ok(
    due({ days: 3 }).some(r => r.label === 'Streaming'),
    'three days ahead reaches the 12th',
  );
});

test('each kind can be switched off, and overdue lines only go back a week', () => {
  assert.deepEqual(
    due({ kinds: { bill: true, loan: false, oneoff: false } }).map(r => r.label),
    ['Gym', 'Rent'],
  );
  assert.ok(!dueReminders(months, { today: day('2026-11-20'), days: 0, kinds: ALL }).some(r => r.label === 'Gym'));
});

test('the same payment is told once: what was told is remembered, and forgotten after two months', () => {
  const list = due();
  const seen = Object.fromEntries(list.slice(0, 2).map(r => [r.id, '2026-11-09']));
  assert.deepEqual(
    newReminders(list, seen).map(r => r.label),
    ['Car loan', 'TV'],
  );
  assert.equal(list[1].id, 'bill:rent0001@2026-11-10', 'stable: the line and its day');
  assert.deepEqual(pruneSeen({ a: '2026-08-01', b: '2026-11-01' }, day('2026-11-09')), { b: '2026-11-01' });
});

/* ---------- hiding amounts ---------- */

test('hidden: amounts on screen are masked, in every format; the numbers in fields and files are not', () => {
  setFmt({ currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy', cents: false });
  FMT.hidden = true;
  try {
    assert.equal(money(1234), MASK);
    assert.equal(signed(-50), MASK);
    assert.equal(compact(12000), MASK);
    assert.match(plainMoney(1234), /^1\.234\s€$/u, 'the real amount when it must stay (the activity log)');
  } finally {
    FMT.hidden = false;
  }
  assert.match(money(1234), /^1\.234\s€$/u);
});

test('maskMoney masks the amounts inside a sentence and leaves dates and other numbers', () => {
  setFmt({ currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy', cents: false });
  const text = `Checked: you have ${plainMoney(1234)} · Rent ${plainMoney(-820)} on 2 Nov 2026, 3 payments`;
  FMT.hidden = true;
  try {
    assert.equal(maskMoney(text), `Checked: you have ${MASK} · Rent ${MASK} on 2 Nov 2026, 3 payments`);
  } finally {
    FMT.hidden = false;
  }
  assert.equal(maskMoney(text), text, 'shown: nothing changes');
  setFmt({ currency: 'USD', numFmt: 'us', dateFmt: 'mdy', cents: true });
  FMT.hidden = true;
  try {
    assert.equal(
      maskMoney(`Paid ${plainMoney(1234.5)} and ${plainMoney(-9.99)} today`),
      `Paid ${MASK} and ${MASK} today`,
    );
  } finally {
    FMT.hidden = false;
  }
});

test('the preferences for reminders and hidden amounts are cleaned', () => {
  const db = normDB({ reminders: { on: true, days: 9, bill: 'yes', notify: true }, hideAmounts: 1 });
  assert.deepEqual(db.reminders, { on: true, days: 2, bill: true, loan: true, oneoff: true, notify: true });
  assert.equal(db.hideAmounts, false, 'only true is true');
  assert.equal(normDB({}).reminders.on, false, 'off until the person turns it on');
});
