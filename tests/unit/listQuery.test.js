/**
 * @file Unit tests for list search, filters and sort. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyQuery, isFiltered } from '../../src/logic/listQuery.js';

const fields = [
  { key: 'name', label: 'Name', type: 'text', value: row => row.name },
  {
    key: 'cat',
    label: 'Category',
    type: 'enum',
    value: row => row.cat,
    options: [
      ['food', 'Food'],
      ['fun', 'Fun'],
      ['gift', 'Gifts'],
    ],
  },
  { key: 'budget', label: 'Budget', type: 'enum', value: row => row.budget },
  { key: 'amount', label: 'Amount', type: 'money', value: row => row.amount },
  { key: 'day', label: 'Day', type: 'number', value: row => row.day },
];
const rows = [
  { name: 'Mamă flowers', cat: 'gift', budget: null, amount: -20, day: 3 },
  { name: 'Groceries', cat: 'food', budget: 'g', amount: -50, day: null },
  { name: 'Mamá lunch', cat: 'food', budget: 'g', amount: -15, day: 1 },
  { name: 'Cinema', cat: 'fun', budget: null, amount: -9, day: 3 },
];
const names = result => result.rows.map(row => row.name);

test('search ignores accents and case, and finds option labels', () => {
  assert.deepEqual(names(applyQuery(rows, { text: 'MAMA' }, fields)), ['Mamă flowers', 'Mamá lunch']);
  assert.deepEqual(names(applyQuery(rows, { text: 'gifts' }, fields)), ['Mamă flowers']);
});

test('filters: AND across fields, OR within one field', () => {
  const query = { filters: { cat: ['food', 'fun'], budget: ['g'] } };
  assert.deepEqual(names(applyQuery(rows, query, fields)), ['Groceries', 'Mamá lunch']);
  assert.equal(isFiltered(query), true);
  assert.equal(isFiltered({ text: ' ', filters: { cat: [] } }), false);
});

test('sort is stable and puts empty values last in both directions', () => {
  assert.deepEqual(names(applyQuery(rows, { sort: { key: 'day' } }, fields)), [
    'Mamá lunch',
    'Mamă flowers',
    'Cinema',
    'Groceries',
  ]);
  assert.deepEqual(names(applyQuery(rows, { sort: { key: 'day', descending: true } }, fields)), [
    'Mamă flowers',
    'Cinema',
    'Mamá lunch',
    'Groceries',
  ]);
});

test('counts and money sums follow what is shown', () => {
  const result = applyQuery(rows, { filters: { budget: ['g'] } }, fields);
  assert.equal(result.total, 4);
  assert.equal(result.shown, 2);
  assert.equal(result.sums.amount, -65);
});
