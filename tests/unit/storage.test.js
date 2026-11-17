/**
 * @file Unit tests for the storage adapter with encryption at rest: what is written, who can read it back.
 * A small in-memory localStorage stands in for the browser's. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorageAdapter } from '../../src/services/storage.js';
import { dataKey, sealedKeyInfo } from '../../src/services/pin.js';

const memory = new Map();
globalThis.localStorage = {
  getItem: k => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: k => memory.delete(k),
};
const KEY = 'test.db';
const db = { v: 6, plans: { a: { name: 'My secret plan' } } };
const salt = 'c2FsdHNhbHRzYWx0c2FsdA==';

test('without encryption it stores plain JSON, as before', () => {
  memory.clear();
  const store = new LocalStorageAdapter(KEY);
  assert.equal(store.write(db), true);
  assert.deepEqual(JSON.parse(memory.get(KEY)), db);
  assert.deepEqual(store.read(), db);
  assert.equal(store.sealed(), false);
});

test('sealed: nothing readable is stored, a new page cannot read it, the right PIN can', async () => {
  memory.clear();
  const key = await dataKey('4821', salt, 1000);
  const store = new LocalStorageAdapter(KEY);
  await store.seal(key, db);
  assert.ok(!memory.get(KEY).includes('secret'), 'the plan name is not in storage');
  assert.equal(store.sealed(), true);
  assert.deepEqual(store.read(), db, 'this page, unlocked, reads it');

  const later = new LocalStorageAdapter(KEY); // the app opened again
  assert.equal(later.read(), null, 'locked: nothing to read');
  const wrong = await dataKey('0000', salt, 1000);
  await assert.rejects(() => later.unlock(wrong));
  await later.unlock(await dataKey('4821', salt, 1000));
  assert.deepEqual(later.read(), db);
});

test('writes while sealed stay sealed and keep their order; turning it off stores plain again', async () => {
  memory.clear();
  const key = await dataKey('4821', salt, 1000);
  const store = new LocalStorageAdapter(KEY);
  await store.seal(key, db);
  store.write({ ...db, n: 1 });
  store.write({ ...db, n: 2 });
  await store.settled();
  const again = new LocalStorageAdapter(KEY);
  await again.unlock(key);
  assert.equal(again.read().n, 2, 'the last write wins');
  await store.unseal({ ...db, n: 3 });
  assert.equal(JSON.parse(memory.get(KEY)).n, 3);
  assert.equal(store.sealed(), false);
});

test('sealed data carries the salt of its key: changing the PIN is one write, nothing else must land with it', async () => {
  memory.clear();
  const store = new LocalStorageAdapter(KEY);
  const first = await dataKey('4821', salt, 1000);
  await store.seal(first, db, { salt, iter: 1000 });
  const newSalt = 'bmV3c2FsdG5ld3NhbHRuZXc=';
  await store.seal(await dataKey('93017755', newSalt, 1000), db, { salt: newSalt, iter: 1000 });
  // the settings were never updated (the tab closed right after): the data itself says how to open it
  const stored = JSON.parse(memory.get(KEY));
  const info = sealedKeyInfo(stored);
  assert.deepEqual(info, { salt: newSalt, iter: 1000 });
  const later = new LocalStorageAdapter(KEY);
  await assert.rejects(() => later.unlock(first), 'the old PIN no longer opens it');
  await later.unlock(await dataKey('93017755', info.salt, info.iter));
  assert.deepEqual(later.read(), db);
});

test('when the browser refuses to store sealed data, sealing fails and nothing changes', async () => {
  memory.clear();
  const store = new LocalStorageAdapter(KEY);
  store.write(db);
  const setItem = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
  const key = await dataKey('4821', salt, 1000);
  try {
    await assert.rejects(() => store.seal(key, db, { salt, iter: 1000 }));
  } finally {
    globalThis.localStorage.setItem = setItem;
  }
  assert.equal(store.cryptoKey, null, 'still not encrypting');
  assert.deepEqual(JSON.parse(memory.get(KEY)), db, 'the plain data is still there');
});

test('a tab whose key is out of date is frozen: it writes nothing any more', async () => {
  memory.clear();
  const store = new LocalStorageAdapter(KEY);
  await store.seal(await dataKey('4821', salt, 1000), db, { salt, iter: 1000 });
  const before = memory.get(KEY);
  store.freeze();
  assert.equal(store.write({ ...db, n: 9 }), false);
  await store.settled();
  assert.equal(memory.get(KEY), before);
});

test('another tab stored the data plain again: reloading with this tab’s key fails instead of sealing it back', async () => {
  memory.clear();
  const store = new LocalStorageAdapter(KEY);
  await store.seal(await dataKey('4821', salt, 1000), db, { salt, iter: 1000 });
  memory.set(KEY, JSON.stringify(db)); // the other tab turned encryption off
  await assert.rejects(() => store.reload());
});
