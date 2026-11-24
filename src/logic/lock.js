/**
 * @file The app lock's rules: what a PIN is, how many wrong tries before a pause, how long the pause, when biometrics
 * give way to the PIN, and when the app locks after being away. Pure: the time is passed in (ms since 1970).
 * The PIN's hash and the encryption are services/pin.js; the lock screen is ui/lock.js.
 */
import { LOCK_TIMEOUTS } from '../config.js';

/** Wrong PINs in a row before a pause; then every further this many. */
export const MAX_ATTEMPTS = 5;
/** Failed biometric tries before only the PIN opens the app (as on a phone). */
export const BIO_ATTEMPTS = 5;
/** The first pause, and the longest. Each further 5 wrong PINs double it. */
const FIRST_PAUSE = 30e3;
const LONGEST_PAUSE = 15 * 60e3;
/** After how long away the app locks, in seconds (config.js): immediately, 1, 5, 15 minutes, 1 hour. */
export { LOCK_TIMEOUTS };

/**
 * A PIN: 4 to 12 digits.
 * @returns {boolean}
 */
export const validPin = pin => typeof pin === 'string' && /^\d{4,12}$/.test(pin);

/**
 * The pause after `fails` wrong PINs in a row: 30 s at 5, doubled every further 5, at most 15 min; 0 in between.
 * @returns {number} the pause in ms (0: none)
 */
export function cooldownFor(fails) {
  if (fails < MAX_ATTEMPTS || fails % MAX_ATTEMPTS) {
    return 0;
  }
  return Math.min(LONGEST_PAUSE, FIRST_PAUSE * 2 ** (fails / MAX_ATTEMPTS - 1));
}

/**
 * A wrong PIN at `now`: one more failure, and a pause when it is a fifth one. The state is { fails, until, bioFails }.
 * @returns {{fails: number, until: number, bioFails: number}} the new state
 */
export function afterFailure(state, now) {
  const fails = state.fails + 1;
  const pause = cooldownFor(fails);
  return { ...state, fails, until: pause ? now + pause : state.until };
}
/**
 * The right PIN (or biometrics): everything starts again.
 * @returns {{fails: number, until: number, bioFails: number}} the state with every count back at 0
 */
export const afterSuccess = () => ({ fails: 0, until: 0, bioFails: 0 });
/**
 * How long until a PIN can be tried again, in ms (0: now).
 * @returns {number} ms, 0 when a PIN can be tried now
 */
export const waitLeft = (state, now) => Math.max(0, (state.until || 0) - now);
/**
 * A failed or cancelled biometric try.
 * @returns {{fails: number, until: number, bioFails: number}} the new state, one more biometric failure
 */
export const afterBioFailure = state => ({ ...state, bioFails: (state.bioFails || 0) + 1 });
/**
 * Whether biometrics may still be tried (fewer than BIO_ATTEMPTS failures since the last unlock).
 * @returns {boolean}
 */
export const bioAllowed = state => (state.bioFails || 0) < BIO_ATTEMPTS;

/**
 * Whether the app must show the lock: it has a PIN and was away (in the background, or closed) at least `timeout`
 * seconds since `lastActive`. No trace of the last use, or a clock that went back, locks. A freshly opened app with
 * encrypted data always locks: its key is never stored, only the PIN can make it again.
 * @param {{hasPin: boolean, timeout: number, lastActive: ?number, now: number, fresh?: boolean, encrypted?: boolean}} o
 * @returns {boolean}
 */
export function shouldLock({ hasPin, timeout, lastActive, now, fresh = false, encrypted = false }) {
  if (!hasPin) {
    return false;
  }
  if (fresh && encrypted) {
    return true;
  }
  if (lastActive === null || lastActive === undefined || now < lastActive) {
    return true;
  }
  return now - lastActive >= timeout * 1000;
}
