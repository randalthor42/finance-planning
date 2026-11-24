/**
 * @file The single data access module: the only code that touches the browser's storage (localStorage and
 * IndexedDB). Everything else goes through it: the store (state/store.js) for the database, the data file
 * (state/fileSync.js) for its small record and its file handle, the translations (core/i18n.js) for language packs.
 * Nothing here talks to a network: it is all on this device.
 *
 * Optional encryption at rest (Settings › Lock and privacy): the database is then stored sealed (AES-256-GCM, a key
 * made from the PIN, services/pin.js). The browser's storage is synchronous and its cryptography is not, so while the
 * app is unlocked the adapter keeps the opened text in memory for read(), and write() seals in the background, in
 * order (the last write wins). While it is on, nothing readable is kept anywhere else: no record index, and backups
 * are kept sealed (LocalStorageAdapter.backup, .index).
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
import { $t } from '../core/i18n.js';
import { newId } from '../core/util.js';
import { isSealed, openText, sealText, sealedKeyInfo } from './pin.js';

/** The error shown when the browser refuses to store the data (full, or private mode). */
const notStored = () => new Error($t('The data could not be saved: the browser’s storage is full or not allowed.'));

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
      // the oldest go once there are more than KEEP_BACKUPS (the requests run in order: this one is counted)
      const keys = s.getAllKeys();
      keys.onsuccess = () => {
        const extra = keys.result.length - KEEP_BACKUPS;
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

/** The database in localStorage, sealed when encryption at rest is on. The store's adapter. */
export class LocalStorageAdapter {
  constructor(key) {
    this.key = key;
    /** The key of the encryption at rest while it is on and the app is unlocked, else null. Never stored. */
    this.cryptoKey = null;
    /** The opened text while sealed (read() parses it). */
    this.opened = null;
    /** The salt and iterations of that key, written into every sealed write (services/pin.js sealText). */
    this.keyInfo = null;
    this.writing = Promise.resolve();
    /** Called when a sealed write fails (the page says "Not saved"). */
    this.onError = () => {};
    /**
     * Another tab changed the PIN or the encryption: this tab's key and data are out of date. Nothing more is written
     * from here (the page reloads), so it can never store data sealed with a key nobody has any more.
     */
    this.frozen = false;
  }
  /** Stops all writes from this tab (see frozen). */
  freeze() {
    this.frozen = true;
    this.cryptoKey = null;
    this.opened = null;
  }
  raw() {
    try {
      return JSON.parse(localStorage.getItem(this.key));
    } catch (e) {
      return null;
    }
  }
  /** Whether what is stored is sealed (encrypted at rest). */
  sealed() {
    return isSealed(this.raw());
  }
  /**
   * The stored text, as the store reads it (a migration keeps it as a backup): the opened text while sealed and
   * unlocked; null while sealed and locked (nothing can be read then).
   */
  readText() {
    if (this.cryptoKey) {
      return this.opened;
    }
    return this.sealed() ? null : readText(this.key);
  }
  read() {
    if (this.cryptoKey) {
      return this.opened ? JSON.parse(this.opened) : null;
    }
    const stored = this.raw();
    return isSealed(stored) ? null : stored; // sealed and locked: nothing can be read
  }
  /**
   * text: the database already serialised (PlanStore keeps each plan's text, see dbText); made here otherwise. Sealed
   * in the background while encryption at rest is on. When the storage is full, backups kept beside it are given up
   * for the data itself. Returns false when it still fails (the menu then says the data is not saved).
   */
  write(db, text) {
    if (this.frozen) {
      return false;
    }
    const value = text === undefined ? JSON.stringify(db) : text;
    if (this.cryptoKey) {
      this.opened = value;
      const key = this.cryptoKey;
      this.writing = this.writing
        .then(() => sealText(value, key, this.keyInfo))
        .then(sealed => {
          if (this.cryptoKey === key) {
            localStorage.setItem(this.key, JSON.stringify(sealed));
          }
        })
        .catch(error => this.onError(error));
      return true;
    }
    if (writeText(this.key, value)) {
      return true;
    }
    return dropLocalBackups() && writeText(this.key, value);
  }
  /**
   * Keeps a backup of the data (before a migration, a first Drive sync, a merge). While encryption at rest is on, the
   * copy kept is the sealed data as stored, never the opened text.
   */
  backup(text, info) {
    return backup(this.cryptoKey ? readText(this.key) : text, info);
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
  /** The record index (IndexedDB) follows the database: see records. None while encryption at rest is on. */
  index(entries, marks) {
    return this.cryptoKey ? Promise.resolve() : records.put(entries, marks);
  }
  indexCurrent(planId, updatedAt) {
    return this.cryptoKey ? Promise.resolve(true) : records.current(planId, updatedAt);
  }
  reindex(planId, entries, updatedAt, pause) {
    return this.cryptoKey ? Promise.resolve() : records.rebuild(planId, entries, updatedAt, pause);
  }
  clearCopies() {
    return clearCopies();
  }
  /** Opens sealed data with `key` (or plain data, as it is). Throws with the wrong key. */
  async unlock(key) {
    const stored = this.raw();
    this.opened = isSealed(stored) ? await openText(stored, key) : JSON.stringify(stored);
    this.cryptoKey = key;
    this.keyInfo = sealedKeyInfo(stored) || this.keyInfo;
  }
  /**
   * Opens again what another tab stored (the storage event), with the key already here. Throws when that no longer
   * fits this tab: the data cannot be opened with this key, or is not sealed any more (the caller then reloads).
   */
  async reload() {
    if (this.cryptoKey) {
      if (!this.sealed()) {
        throw new Error('stored data is no longer sealed');
      }
      await this.unlock(this.cryptoKey);
    }
  }
  /**
   * Stores `db` sealed with `key` (made with `meta`: { salt, iter }, kept in the sealed data), then uses that key from
   * now on. Resolves once it is stored; throws (and changes nothing) when it could not be.
   */
  async seal(key, db, meta) {
    const text = JSON.stringify(db);
    const wasPlain = !this.cryptoKey;
    const job = this.writing.then(async () => {
      const sealed = await sealText(text, key, meta);
      try {
        localStorage.setItem(this.key, JSON.stringify(sealed));
      } catch (e) {
        throw notStored();
      }
      this.cryptoKey = key;
      this.keyInfo = meta || null;
      this.opened = text;
    });
    this.writing = job.catch(() => {});
    await job;
    if (wasPlain) {
      // the copies kept in readable form until now (record index, backups) go: nothing readable stays beside it
      await clearCopies();
    }
  }
  /** Stores `db` plain again and stops sealing. Throws (and changes nothing) when it could not be stored. */
  async unseal(db) {
    await this.settled();
    try {
      localStorage.setItem(this.key, JSON.stringify(db));
    } catch (e) {
      throw notStored();
    }
    this.cryptoKey = null;
    this.keyInfo = null;
    this.opened = null;
  }
  /** "Forgot your PIN": removes the data and these other keys (the lock settings) from this browser. */
  erase(otherKeys = []) {
    this.freeze();
    for (const key of [this.key, ...otherKeys]) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    }
  }
  /** Waits for the sealed writes under way. */
  settled() {
    return this.writing;
  }
}
