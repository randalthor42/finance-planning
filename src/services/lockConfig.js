/**
 * @file The app lock's settings on this device (Settings › Lock and privacy), in their own place in the browser's
 * storage: they must be readable before the data can be opened (with encryption at rest, the data is sealed until the
 * PIN is given). Nothing in here can open the data: the PIN is only a salted hash (services/pin.js), the encryption
 * key is never stored, and biometrics are a public key and the id of a credential the device keeps.
 *
 *   { pin: { kdf, iter, salt, hash } | null,   the PIN's salted hash; no PIN, no lock
 *     timeout: seconds away before it locks (config.js LOCK_TIMEOUTS),
 *     bio: { id, pub, alg } | { kind: 'device' } | null,  biometric unlock: WebAuthn's credential id and public
 *                                          key, or Android's own check inside the Android app (nothing to keep)
 *     encrypt: { salt, iter } | null,         encryption at rest: the salt of its key (needs a PIN)
 *     fails, until, bioFails,                 wrong tries and the pause (logic/lock.js), kept across reloads
 *     lastActive }                            when the app was last used (ms), for "lock after"
 */
import { isObj } from '../core/util.js';
import { readJSON, writeJSON } from './storage.js';
import { LOCK_TIMEOUTS } from '../config.js';

export const LOCK_KEY = 'runway.lock.v1';
const B64 = /^[A-Za-z0-9+/=_-]{4,2000}$/;

/** A clean biometric setting, or null: a WebAuthn credential, or the Android app's own check. */
function normBio(bio) {
  if (!isObj(bio)) {
    return null;
  }
  if (bio.kind === 'device') {
    return { kind: 'device' };
  }
  if (B64.test(bio.id) && B64.test(bio.pub) && [-7, -257].includes(bio.alg)) {
    return { id: bio.id, pub: bio.pub, alg: bio.alg };
  }
  return null;
}

/**
 * Clean lock settings: anything missing or wrong gets its default (no lock).
 * @returns {{pin: ?object, timeout: number, bio: ?object, encrypt: ?object, fails: number, until: number, bioFails: number, lastActive: ?number}}
 */
export function normLock(raw) {
  const r = isObj(raw) ? raw : {};
  const int = (v, lo, hi, fallback) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : fallback);
  const pin =
    isObj(r.pin) && B64.test(r.pin.salt) && B64.test(r.pin.hash) && int(r.pin.iter, 1000, 1e7, 0)
      ? { kdf: 'PBKDF2-SHA256', iter: r.pin.iter, salt: r.pin.salt, hash: r.pin.hash }
      : null;
  return {
    pin,
    timeout: LOCK_TIMEOUTS.includes(r.timeout) ? r.timeout : 60,
    bio: pin ? normBio(r.bio) : null,
    encrypt:
      pin && isObj(r.encrypt) && B64.test(r.encrypt.salt) && int(r.encrypt.iter, 1000, 1e7, 0)
        ? { salt: r.encrypt.salt, iter: r.encrypt.iter }
        : null,
    fails: int(r.fails, 0, 1e6, 0),
    until: int(r.until, 0, 1e15, 0),
    bioFails: int(r.bioFails, 0, 1e6, 0),
    lastActive: Number.isFinite(r.lastActive) ? r.lastActive : null,
  };
}

/**
 * The lock settings stored on this device, cleaned (normLock).
 * @returns {object} the settings (normLock), the defaults when nothing is stored or it cannot be read
 */
export function readLock() {
  return normLock(readJSON(LOCK_KEY));
}
/**
 * Stores the lock settings (cleaned). Returns false when the browser refuses.
 * @returns {boolean} true when stored
 */
export function writeLock(config) {
  return writeJSON(LOCK_KEY, normLock(config));
}
