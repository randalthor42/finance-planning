/**
 * @file Unit tests for the list of every text of the app (for "Export language"): it is read the first time it is
 * needed, not when the app starts, and only once. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { I18N } from '../../src/core/i18n.js';

test('the texts are read on first use, once, and the export still has every one of them', () => {
  let reads = 0;
  I18N.useKeys(() => {
    reads++;
    return { KEYS: ['Overview', 'Add {0} to my plan'], WORDS: ['month'] };
  });
  assert.equal(reads, 0, 'nothing is read when the app starts');
  assert.equal(I18N.KEYS.length, 2);
  assert.deepEqual(I18N.WORDS, ['month']);
  const pack = JSON.parse(I18N.exportPack('en'));
  assert.equal(reads, 1, 'read once');
  assert.equal(pack.strings['Add {0} to my plan'], 'Add {0} to my plan');
  assert.equal(pack.strings['#month:other'], 'months');
});

test('without a list (a test, a page with none) the texts are simply empty', () => {
  I18N.useKeys(null);
  assert.deepEqual([I18N.KEYS, I18N.WORDS], [[], []]);
});
