/**
 * @file Unit tests for the list of pages that offer Design mode. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { designPages, designable, isDesignable } from '../../src/ui/components/designPages.js';

test('pages that offer Design mode are listed in the order they declare themselves, once each', () => {
  assert.equal(designable('first', 'First page'), 'first');
  designable('second', 'Second page');
  designable('first', 'First page, renamed');
  assert.deepEqual(designPages(), [
    { key: 'first', name: 'First page, renamed' },
    { key: 'second', name: 'Second page' },
  ]);
  assert.equal(isDesignable('second'), true);
  assert.equal(isDesignable('missing'), false);
});
