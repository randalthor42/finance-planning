/**
 * @file Unit tests for fingerprint unlock inside the Android app: the bridge to Android's prompt (services/
 * nativeBiometric.js), how services/biometric.js chooses it, and the setting it keeps (services/lockConfig.js). A fake
 * window.Capacitor stands in for the app. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_BIO, register, support, verify } from '../../src/services/biometric.js';
import { inApp, nativeAvailable, nativeVerify } from '../../src/services/nativeBiometric.js';
import { normLock } from '../../src/services/lockConfig.js';

const PIN = { kdf: 'PBKDF2-SHA256', iter: 200000, salt: 'c2FsdHNhbHQ=', hash: 'aGFzaGhhc2g=' };

/**
 * A fake Android app: the bridge with the fingerprint plugin, a phone that has (or not) strong biometrics, and a
 * prompt that answers `answer` ('ok', or an error code). Records each call.
 */
function fakeApp({ strong = true, answer = 'ok', plugin = true } = {}) {
  const calls = [];
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    PluginHeaders: plugin ? [{ name: 'SplashScreen' }, { name: 'BiometricAuthNative' }] : [{ name: 'SplashScreen' }],
    nativePromise: async (name, method, options) => {
      calls.push({ name, method, options });
      if (method === 'checkBiometry') {
        return { isAvailable: true, strongBiometryIsAvailable: strong };
      }
      if (answer !== 'ok') {
        throw Object.assign(new Error('no'), { code: answer });
      }
      return undefined;
    },
  };
  return calls;
}
const leaveApp = () => delete globalThis.Capacitor;

test('outside the Android app: no bridge, nothing native is offered or called', async () => {
  leaveApp();
  assert.equal(inApp(), false);
  assert.equal(await nativeAvailable(), false);
  assert.equal(await nativeVerify(), 'cancel');
  assert.equal(await verify(DEVICE_BIO), 'cancel', 'a device setting copied to a browser unlocks nothing');
});

test('an app without the plugin is treated as a browser', async () => {
  fakeApp({ plugin: false });
  assert.equal(inApp(), false);
  leaveApp();
});

test('in the app: offered when the phone has strong biometrics, not otherwise', async () => {
  fakeApp({ strong: true });
  assert.deepEqual(await support(), { ok: true, reason: '' });
  fakeApp({ strong: false });
  assert.deepEqual(await support(), { ok: false, reason: 'none' });
  leaveApp();
});

test("the prompt asks for strong biometrics only, never the phone's own PIN", async () => {
  const calls = fakeApp();
  assert.equal(await nativeVerify('Unlock'), 'ok');
  const call = calls.find(c => c.method === 'internalAuthenticate');
  assert.equal(call.name, 'BiometricAuthNative');
  assert.equal(call.options.allowDeviceCredential, false);
  assert.equal(call.options.androidBiometryStrength, 1);
  leaveApp();
});

test("the prompt has one line, its title, without the app's name (Android shows it already)", async () => {
  const calls = fakeApp();
  await nativeVerify();
  await register();
  for (const call of calls.filter(c => c.method === 'internalAuthenticate')) {
    assert.ok(call.options.androidTitle);
    assert.doesNotMatch(call.options.androidTitle, /Runway/);
    assert.equal(call.options.androidSubtitle, undefined);
    assert.equal(call.options.reason, undefined);
  }
  leaveApp();
});

test('turning it on confirms the finger first and keeps no credential', async () => {
  fakeApp();
  assert.deepEqual(await register(), { kind: 'device' });
  fakeApp({ answer: 'userCancel' });
  await assert.rejects(register(), e => /not confirmed/.test(e.message) && e.cancelled === true, '"Use PIN": quiet');
  fakeApp({ answer: 'authenticationFailed' });
  await assert.rejects(register(), e => e.cancelled === false, 'a refused finger is said');
  leaveApp();
});

test('unlocking: recognised, refused (a failed try) and "Use PIN" (no try) are told apart', async () => {
  fakeApp();
  assert.equal(await verify(DEVICE_BIO), 'ok');
  fakeApp({ answer: 'authenticationFailed' });
  assert.equal(await verify(DEVICE_BIO), 'fail');
  fakeApp({ answer: 'biometryLockout' });
  assert.equal(await verify(DEVICE_BIO), 'fail', "Android's own lockout after too many fingers");
  for (const code of ['userCancel', 'systemCancel', 'appCancel', 'biometryNotAvailable', 'somethingElse']) {
    fakeApp({ answer: code });
    assert.equal(await verify(DEVICE_BIO), 'cancel', String(code));
  }
  leaveApp();
});

test('the lock settings keep the device setting, and only with a PIN', () => {
  assert.deepEqual(normLock({ pin: PIN, bio: { kind: 'device', extra: 1 } }).bio, { kind: 'device' });
  assert.equal(normLock({ bio: { kind: 'device' } }).bio, null);
  assert.equal(normLock({ pin: PIN, bio: { kind: 'other' } }).bio, null);
  assert.deepEqual(normLock({ pin: PIN, bio: { id: 'abcd', pub: 'efgh', alg: -7 } }).bio, {
    id: 'abcd',
    pub: 'efgh',
    alg: -7,
  });
});
