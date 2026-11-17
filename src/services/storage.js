/**
 * @file The single data access module: the only code that touches the browser's storage (localStorage and
 * IndexedDB). Everything else goes through it: the store (state/store.js) for the database, the data file
 * (state/fileSync.js) for its small record and its file handle, the translations (core/i18n.js) for language packs.
 * Nothing here talks to a network: it is all on this device.
 *
 * localStorage, key "runway.db.v1": the database (plans, browser preferences, activity log), read at start so the app
 * opens at once.
 * IndexedDB, database "runway" (version 2):
 *   kv        small values: the data file's handle ("file"), this device's id ("deviceId"), and for each plan the
 *             updatedAt its records were last indexed at ("indexed:<planId>")
 *   records   every record of every plan, live and deleted, keyed "<planId>/<type>/<id>", with indexes on updatedAt,
 *             deletedAt, planId and type: what a future sync asks ("what changed since…", "what was deleted"). A
 *             copy kept in step with the database; the database stays the source of truth.
 *   backups   the database as it was before each migration (models/migrations.js)
 * See docs/data.md.
 */
import { newId } from '../core/util.js';

/* --- localStorage --- */

export function readText(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
export function readJSON(key) {
  try {
    return JSON.parse(readText(key));
  } catch (e) {
    return null;
  }
}
/** Returns false when the browser refuses (private mode, full storage). */
export function writeText(key, text) {
  try {
    localStorage.setItem(key, text);
    return true;
  } catch (e) {
    return false;
  }
}
export const writeJSON = (key, value) => writeText(key, JSON.stringify(value));

/* --- IndexedDB --- */

const DB_NAME = 'runway';
const DB_VERSION = 2;
let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('No IndexedDB in this browser'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv'); // version 1: the data file's handle
        }
        if (!db.objectStoreNames.contains('records')) {
          const records = db.createObjectStore('records', { keyPath: 'key' });
          records.createIndex('updatedAt', 'updatedAt');
          records.createIndex('deletedAt', 'deletedAt'); // a live record (deletedAt null) is not in this index
          records.createIndex('planId', 'planId');
          records.createIndex('type', 'type');
        }
        if (!db.objectStoreNames.contains('backups')) {
          db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true }).createIndex('at', 'at');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}
/** Runs fn(store…) in one transaction; resolves with what fn returns (a request's result) when it is committed. */
async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = fn(...[].concat(stores).map(name => tx.objectStore(name)));
    tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Small values in IndexedDB (the data file's handle is one: it cannot be kept in localStorage). */
export const kv = {
  get: key => run('kv', 'readonly', s => s.get(key)),
  set: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
  del: key => run('kv', 'readwrite', s => s.delete(key)),
};

/* --- this device --- */

let device = null;
/**
 * This device's id: a random UUID made on the first launch and kept in IndexedDB (and in localStorage, in case
 * IndexedDB is not available). It names this browser, nothing about the person.
 */
export function deviceId() {
  if (!device) {
    device = (async () => {
      let id = null;
      try {
        id = await kv.get('deviceId');
      } catch (e) {}
      id = id || readText('runway.device') || newId();
      try {
        await kv.set('deviceId', id);
      } catch (e) {}
      writeText('runway.device', id);
      return id;
    })();
  }
  return device;
}

/* --- backups before a migration --- */

/** At most this many backups are kept in IndexedDB, the newest (each is a whole copy of the data). */
export const KEEP_BACKUPS = 5;
/** A backup larger than this (characters) is not put in localStorage: the data itself must keep its room there. */
const LOCAL_BACKUP_MAX = 1_000_000;
/** The prefix of backups kept in localStorage when IndexedDB is not available. */
const LOCAL_BACKUP = 'runway.db.v1.backup.';

/**
 * Keeps the database text as it was before a migration (or a first sync, a merge). In IndexedDB, where only the
 * newest KEEP_BACKUPS stay; if that fails, in localStorage when it is small enough (one per format, replaced, and
 * given up first when the data needs the room: dropLocalBackups). Resolves to true when a copy was kept.
 */
export async function backup(text, info) {
  const entry = { at: Date.now(), ...info, text };
  try {
    await run('backups', 'readwrite', s => {
      s.add(entry);
      // the oldest go once there are more than KEEP_BACKUPS (counted before this one is added)
      const keys = s.getAllKeys();
      keys.onsuccess = () => {
        const extra = keys.result.length + 1 - KEEP_BACKUPS;
        keys.result.slice(0, Math.max(0, extra)).forEach(key => s.delete(key));
      };
    });
    return true;
  } catch (e) {
    return text.length <= LOCAL_BACKUP_MAX && writeText(LOCAL_BACKUP + 'v' + info.from, text);
  }
}
/** Removes the backups kept in localStorage. Returns whether there were any (room was made). */
export function dropLocalBackups() {
  let dropped = false;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_BACKUP)) {
        localStorage.removeItem(key);
        dropped = true;
      }
    }
  } catch (e) {}
  return dropped;
}
/** The backups kept, oldest first: { id, at, from, to, text }. */
export const backups = () => run('backups', 'readonly', s => s.getAll());

/* --- the record index --- */

/** Writes are gathered and sent in one transaction per task; a plan rebuilt in parts of this many records. */
const CHUNK = 50;
let waiting = [];
let waitingMarks = [];
let sending = null;

export const records = {
  /** Adds or replaces these entries soon (one transaction), then marks the plans as indexed up to `marks`. */
  put(entries, marks = []) {
    waiting.push(...entries);
    waitingMarks.push(...marks);
    if (!sending) {
      sending = Promise.resolve().then(async () => {
        const batch = waiting;
        const done = waitingMarks;
        waiting = [];
        waitingMarks = [];
        sending = null;
        try {
          await run(['records', 'kv'], 'readwrite', (s, k) => {
            batch.forEach(e => s.put(e));
            done.forEach(([planId, at]) => k.put(at, 'indexed:' + planId));
          });
        } catch (e) {} // the index is a copy: it is rebuilt at the next start
      });
    }
    return sending;
  },
  /** Whether the plan's records were indexed as of updatedAt. */
  async current(planId, updatedAt) {
    try {
      return (await kv.get('indexed:' + planId)) === updatedAt;
    } catch (e) {
      return true; // no IndexedDB: nothing to rebuild
    }
  },
  /**
   * Replaces every entry of a plan with these (any iterable, read as it goes), CHUNK entries per transaction, waiting
   * for `pause()` between parts (the store passes the browser's idle callback), so no part is a long task. Then marks
   * the plan as indexed up to updatedAt.
   */
  async rebuild(planId, entries, updatedAt, pause = () => new Promise(resolve => setTimeout(resolve, 0))) {
    try {
      const stale = new Set(await run('records', 'readonly', s => s.index('planId').getAllKeys(planId)));
      let part = [];
      const send = async () => {
        const batch = part;
        part = [];
        await pause();
        await run('records', 'readwrite', s => batch.forEach(e => s.put(e)));
      };
      for (const e of entries) {
        stale.delete(e.key);
        part.push(e);
        if (part.length === CHUNK) {
          await send();
        }
      }
      if (part.length) {
        await send();
      }
      if (stale.size) {
        await run('records', 'readwrite', s => stale.forEach(k => s.delete(k)));
      }
      await kv.set('indexed:' + planId, updatedAt);
    } catch (e) {}
  },
  /** Records saved with a change after `since` (epoch ms), oldest first: what a sync would send. */
  changedSince: since =>
    run('records', 'readonly', s => s.index('updatedAt').getAll(IDBKeyRange.lowerBound(since, true))),
  /** Deleted records (deletedAt set), oldest deletion first. */
  deleted: () => run('records', 'readonly', s => s.index('deletedAt').getAll()),
  /** Every record of one plan. */
  ofPlan: planId => run('records', 'readonly', s => s.index('planId').getAll(planId)),
  count: () => run('records', 'readonly', s => s.count()),
};

/** "Delete everything": the record index and the backups go too (they hold the plans); the device id stays. */
export async function clearCopies() {
  try {
    await run(['records', 'backups', 'kv'], 'readwrite', (r, b, k) => {
      r.clear();
      b.clear();
      const keys = k.getAllKeys();
      keys.onsuccess = () =>
        keys.result.filter(key => String(key).startsWith('indexed:')).forEach(key => k.delete(key));
    });
  } catch (e) {}
  for (const key of Object.keys(localStorage || {})) {
    if (key.startsWith('runway.db.v1.backup')) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    }
  }
}

/* --- the database --- */

/** The database in localStorage. The store's adapter: swap this class to store plans elsewhere. */
export class LocalStorageAdapter {
  constructor(key) {
    this.key = key;
  }
  /** The stored text, as it is (a migration keeps it as a backup). */
  readText() {
    return readText(this.key);
  }
  read() {
    return readJSON(this.key);
  }
  /**
   * text: the database already serialised (PlanStore keeps each plan's text, see dbText); made here otherwise. When
   * the storage is full, backups kept beside it are given up for the data itself. Returns false when it still fails
   * (the menu then says the data is not saved).
   */
  write(db, text) {
    const value = text === undefined ? JSON.stringify(db) : text;
    if (writeText(this.key, value)) {
      return true;
    }
    return dropLocalBackups() && writeText(this.key, value);
  }
  backup(text, info) {
    return backup(text, info);
  }
  /**
   * The highest data format this browser's Runway has written (its own key, which an older version of the app does not
   * know and so leaves alone): 0 when unknown. See PlanStore.init.
   */
  schemaSeen() {
    return Number(readText(this.key + '.schema')) || 0;
  }
  markSchema(version) {
    if (version > this.schemaSeen()) {
      writeText(this.key + '.schema', String(version));
    }
  }
  /** The record index (IndexedDB) follows the database: see records. */
  index(entries, marks) {
    return records.put(entries, marks);
  }
  indexCurrent(planId, updatedAt) {
    return records.current(planId, updatedAt);
  }
  reindex(planId, entries, updatedAt, pause) {
    return records.rebuild(planId, entries, updatedAt, pause);
  }
  clearCopies() {
    return clearCopies();
  }
}
