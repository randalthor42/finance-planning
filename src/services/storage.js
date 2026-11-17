/**
 * @file Persistence adapter. Swap this class for an HTTP adapter to store plans on a server.
 *
 * Optional encryption at rest (Settings › Lock and privacy): the data is then stored sealed (AES-256-GCM, a key made
 * from the PIN, services/pin.js). The browser's storage is synchronous and its cryptography is not, so while the app
 * is unlocked the adapter keeps the opened text in memory for read(), and write() seals in the background, in order
 * (the last write wins). settled() waits for the writes.
 */
import { $t } from '../core/i18n.js';
import { isSealed, openText, sealText } from './pin.js';

/** The error shown when the browser refuses to store the data (full, or private mode). */
const notStored = () => new Error($t('The data could not be saved: the browser’s storage is full or not allowed.'));

/** The only code that knows where data lives. Swap this class to change storage. */
export class LocalStorageAdapter {
  constructor(key) {
    this.key = key;
    /** The key of the encryption at rest while it is on and the app is unlocked, else null. Never stored. */
    this.cryptoKey = null;
    /** The opened text while sealed (read() parses it). */
    this.opened = null;
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
  read() {
    if (this.cryptoKey) {
      return this.opened ? JSON.parse(this.opened) : null;
    }
    const stored = this.raw();
    return isSealed(stored) ? null : stored; // sealed and locked: nothing can be read
  }
  write(db) {
    if (this.frozen) {
      return false;
    }
    const text = JSON.stringify(db);
    if (this.cryptoKey) {
      this.opened = text;
      const key = this.cryptoKey;
      this.writing = this.writing
        .then(() => sealText(text, key))
        .then(sealed => {
          if (this.cryptoKey === key) {
            localStorage.setItem(this.key, JSON.stringify(sealed));
          }
        })
        .catch(error => this.onError(error));
      return true;
    }
    try {
      localStorage.setItem(this.key, text);
      return true;
    } catch (e) {
      return false;
    }
  }
  /** Opens sealed data with `key` (or plain data, as it is). Throws with the wrong key. */
  async unlock(key) {
    const stored = this.raw();
    this.opened = isSealed(stored) ? await openText(stored, key) : JSON.stringify(stored);
    this.cryptoKey = key;
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
    const job = this.writing.then(async () => {
      const sealed = await sealText(text, key, meta);
      try {
        localStorage.setItem(this.key, JSON.stringify(sealed));
      } catch (e) {
        throw notStored();
      }
      this.cryptoKey = key;
      this.opened = text;
    });
    this.writing = job.catch(() => {});
    await job;
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
