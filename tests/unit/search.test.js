/**
 * @file Unit tests for the global search. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { searchPlan } from '../../src/logic/search.js';

const plan = normPlan({
  incomes: [{ id: 'salary01', name: 'Salary', amount: 2000 }],
  bills: [
    { id: 'rent0001', name: 'Rent', amount: 500 },
    { id: 'music001', name: 'Spotify', amount: 6, cat: 'subs' },
  ],
  trips: [{ id: 'trip0001', name: 'Málaga', items: [{ id: 'cost0001', name: 'Surf lessons', amount: 80 }] }],
  wishes: [{ id: 'wish0001', name: 'Camera', price: 950, note: 'for the Malaga trip' }],
});

test('finds a record by part of its name, whatever the case', () => {
  const results = searchPlan(plan, 'REN');
  assert.deepEqual(
    results.map(result => result.id),
    ['rent0001'],
  );
  assert.equal(results[0].type, 'bill');
});

test('a subscription is labelled as one', () => {
  assert.equal(searchPlan(plan, 'spot')[0].type, 'subscription');
});

test('ignores accents and looks inside notes and trip costs', () => {
  const ids = searchPlan(plan, 'malaga').map(result => result.id);
  assert.deepEqual(ids.sort(), ['trip0001', 'wish0001']);
  assert.deepEqual(
    searchPlan(plan, 'surf').map(result => result.id),
    ['trip0001'],
  );
});

test('every word must match, and an empty search finds nothing', () => {
  assert.equal(searchPlan(plan, 'camera rent').length, 0);
  assert.equal(searchPlan(plan, '   ').length, 0);
});

test('finds appointments and drafts of My calendar, with where they are', () => {
  const withAgenda = normPlan({
    agenda: {
      entries: [{ id: 'dent0001', title: 'Dentist', date: '2026-11-10', note: 'bring the card' }],
      drafts: {
        items: [{ id: 'tv000001', name: 'New TV', amount: 800, date: '2026-11-20' }],
        trips: [{ id: 'rome0001', name: 'Rome', month: '2026-12', items: [{ name: 'Dentist in Rome', amount: 90 }] }],
      },
    },
  });
  const results = searchPlan(withAgenda, 'dentist');
  assert.deepEqual(
    results.map(r => [r.type, r.list, r.id, r.name]),
    [
      ['appointment', 'agenda', 'dent0001', 'Dentist'],
      ['draft', 'drafts:trips', 'rome0001', 'Rome'],
    ],
  );
  assert.equal(results[0].amount, null, 'an appointment has no amount');
  assert.equal(results[0].date, '2026-11-10');
  assert.deepEqual(
    searchPlan(withAgenda, 'card').map(r => r.id),
    ['dent0001'],
    'notes are searched too',
  );
  assert.deepEqual(
    searchPlan(withAgenda, 'tv').map(r => [r.type, r.list, r.amount]),
    [['draft', 'drafts:items', 800]],
  );
});
