/**
 * @file Fingerprint or face unlock inside the Android app (docs/android.md), with Android's own prompt.
 *
 * The page in the app runs in Android's web view, which has no WebAuthn (services/biometric.js): there the app asks
 * Android through Capacitor's bridge instead, with the native half of the plugin @aparajita/capacitor-biometric-auth.
 * Its JavaScript half is not bundled: the bridge (window.Capacitor, put in the page by the app) is called by the
 * plugin's name and methods below, so the page on the web carries none of it, and none of this runs there.
 *
 * Only strong biometrics are accepted (Android's class 3: fingerprint, or a face check made for payments), not a face
 * seen by the front camera alone, and not the phone's PIN or pattern instead of it: the app has its own PIN for that.
 * As with the browser's check, this unlocks the screen lock; it cannot open data encrypted with the PIN, so it is off
 * while encryption is on (ui/lock.js).
 */
import { $t } from '../core/i18n.js';

/** The plugin's name on the bridge, and its methods (BiometricAuthNative.java). */
const PLUGIN = 'BiometricAuthNative';
/** Android's BiometricManager.Authenticators: BiometryStrength.STRONG in the plugin. */
const STRONG = 1;

/** The bridge, when this page is inside the Android app and the plugin is in it; null otherwise. */
function bridge() {
  const cap = globalThis.Capacitor;
  if (!cap || typeof cap.nativePromise !== 'function' || !(cap.isNativePlatform && cap.isNativePlatform())) {
    return null;
  }
  const headers = Array.isArray(cap.PluginHeaders) ? cap.PluginHeaders : [];
  return headers.some(p => p && p.name === PLUGIN) ? cap : null;
}

/**
 * Whether this page is inside the Android app with its fingerprint plugin.
 * @returns {boolean}
 */
export const inApp = () => !!bridge();

/**
 * Whether the phone can check a fingerprint or face (strong biometrics, set up in the phone's settings).
 * @returns {Promise<boolean>}
 */
export async function nativeAvailable() {
  const cap = bridge();
  if (!cap) {
    return false;
  }
  try {
    const result = await cap.nativePromise(PLUGIN, 'checkBiometry', {});
    return !!(result && result.strongBiometryIsAvailable);
  } catch (e) {
    return false;
  }
}

/**
 * The plugin's error codes that mean a finger or face was tried and not accepted: a failed try. Every other ending
 * ("Use PIN", the prompt closed by the system, no sensor) is a cancel, which is no try at all.
 */
const FAILED = new Set(['authenticationFailed', 'biometryLockout']);

/**
 * Shows Android's fingerprint prompt: 'ok' when the phone recognised the person, 'fail' when a finger or face was
 * tried and refused, 'cancel' when the person chose "Use PIN" or the prompt closed or could not be shown.
 * @param {string} [reason] the line under the prompt's title
 * @returns {Promise<'ok'|'fail'|'cancel'>}
 */
export async function nativeVerify(reason = $t('Unlock Runway')) {
  const cap = bridge();
  if (!cap) {
    return 'cancel';
  }
  try {
    await cap.nativePromise(PLUGIN, 'internalAuthenticate', {
      reason,
      androidTitle: 'Runway',
      androidSubtitle: reason,
      cancelTitle: $t('Use PIN'),
      allowDeviceCredential: false,
      androidConfirmationRequired: false,
      androidBiometryStrength: STRONG,
    });
    return 'ok';
  } catch (e) {
    return e && FAILED.has(e.code) ? 'fail' : 'cancel';
  }
}
