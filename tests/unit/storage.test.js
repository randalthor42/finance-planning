/**
 * @file Unit tests for the browser storage module (services/storage.js) with a stand-in for localStorage that has a
 * size limit, like a real browser's. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorageAdapter, dropLocalBackups } from '../../src/services/storage.js';

/** A localStorage that refuses a write once the total text would pass `limit` characters (QuotaExceededError). */
function limitedStorage(limit) {
  const map = new Map();
  const used = () => [...map.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() {
      return map.size;
    },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const after = used() - (map.has(k) ? k.length + map.get(k).length : 0) + k.length + String(v).length;
      if (after > limit) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(k, String(v));
    },
    removeItem: k => map.delete(k),
  };
}

/** Puts `storage` in place of the browser's localStorage while fn runs. */
function withStorage(storage, fn) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (before) {
      Object.defineProperty(globalThis, 'localStorage', before);
    } else {
      delete globalThis.localStorage;
    }
  }
}

test('storage full of an old backup: the backup is given up so the data itself is saved', () => {
  const storage = limitedStorage(3000);
  withStorage(storage, () => {
    storage.setItem('runway.db.v1.backup.v6', 'x'.repeat(2000));
    const adapter = new LocalStorageAdapter('runway.db.v1');
    assert.equal(adapter.write(null, 'y'.repeat(1500)), true, 'saved');
    assert.equal(storage.getItem('runway.db.v1').length, 1500);
    assert.equal(storage.getItem('runway.db.v1.backup.v6'), null, 'the backup made room');
  });
});

test('storage full with nothing to give up: the write says it failed (the menu shows "not saved")', () => {
  withStorage(limitedStorage(100), () => {
    const adapter = new LocalStorageAdapter('runway.db.v1');
    assert.equal(adapter.write(null, 'y'.repeat(500)), false);
    assert.equal(dropLocalBackups(), false);
  });
});
