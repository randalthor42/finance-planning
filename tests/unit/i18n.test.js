/**
 * @file Unit tests for the list of every text of the app (Export language): not in the page's code, loaded once,
 * only when needed. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { I18N } from '../../src/core/i18n.js';

test('the texts to translate are loaded the first time they are needed, once', async () => {
  let reads = 0;
  I18N.source = async () => {
    reads++;
    return { keys: ['Save', 'Cancel'], words: ['plan'] };
  };
  I18N.reset();
  assert.equal(reads, 0, 'nothing is loaded at start');
  assert.deepEqual(I18N.KEYS, [], 'not loaded yet: none');
  await Promise.all([I18N.loadTexts(), I18N.loadTexts()]);
  assert.deepEqual(I18N.KEYS, ['Save', 'Cancel']);
  assert.deepEqual(I18N.WORDS, ['plan']);
  const pack = JSON.parse(I18N.exportPack('xx'));
  assert.equal(pack.strings.Save, 'Save');
  assert.equal(pack.strings['#plan:other'], 'plans');
  await I18N.loadTexts();
  assert.equal(reads, 1);
});

test('texts that cannot be had (offline, a page without them): none, and tried again next time', async () => {
  let reads = 0;
  I18N.source = async () => {
    reads++;
    throw new Error('offline');
  };
  I18N.reset();
  assert.deepEqual(await I18N.loadTexts(), { keys: [], words: [] });
  assert.deepEqual(I18N.KEYS, []);
  await I18N.loadTexts();
  assert.equal(reads, 2);
});
