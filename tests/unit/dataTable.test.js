/**
 * @file Unit tests for table sorting. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// dataTable.js imports UI modules that need a browser; only the pure sort function is tested here.
globalThis.document = {
  documentElement: {},
  createElement: () => ({}),
  addEventListener() {},
  querySelector: () => null,
};
const { sortRows } = await import('../../src/ui/components/dataTable.js');

const rows = [
  { name: 'b', cost: 30 },
  { name: 'a', cost: 200 },
  { name: 'c', cost: null },
];
const columns = [{ value: row => row.name }, { value: row => row.cost }, {}];

test('numbers sort by size, not as text, and empty values go last', () => {
  assert.deepEqual(
    sortRows(rows, columns, { column: 1, descending: false }).map(row => row.name),
    ['b', 'a', 'c'],
  );
});

test('descending reverses the order', () => {
  assert.deepEqual(
    sortRows(rows, columns, { column: 0, descending: true }).map(row => row.name),
    ['c', 'b', 'a'],
  );
});

test('no sort, or a column without a value, keeps the original order', () => {
  assert.equal(sortRows(rows, columns, null), rows);
  assert.equal(sortRows(rows, columns, { column: 2, descending: false }), rows);
});
