/**
 * @file Unit tests for the app lock: the PIN's salted hash, the attempt limit (PIN and biometrics), when the app locks
 * after being in the background, and the optional encryption of the stored data. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BIO_ATTEMPTS,
  MAX_ATTEMPTS,
  afterBioFailure,
  afterFailure,
  afterSuccess,
  bioAllowed,
  cooldownFor,
  shouldLock,
  validPin,
  waitLeft,
} from '../../src/logic/lock.js';
import { dataKey, hashPin, isSealed, openText, sealText, verifyPin } from '../../src/services/pin.js';

const FAST = 1000; // iterations for tests (the app uses 310 000)

/* ---------- the PIN ---------- */

test('a PIN is 4 to 12 digits', () => {
  assert.ok(validPin('1234') && validPin('123456789012'));
  assert.ok(
    !validPin('123') && !validPin('1234567890123') && !validPin('12a4') && !validPin(' 1234') && !validPin(1234),
  );
});

test('a PIN is stored as a salted hash, never as itself', async () => {
  const record = await hashPin('4821', { iter: FAST });
  assert.deepEqual(Object.keys(record).sort(), ['hash', 'iter', 'kdf', 'salt']);
  assert.equal(record.kdf, 'PBKDF2-SHA256');
  assert.ok(!JSON.stringify(record).includes('4821'));
  assert.equal(Buffer.from(record.salt, 'base64').length, 16, '16 random bytes of salt');
  assert.equal(Buffer.from(record.hash, 'base64').length, 32, '256 bits of hash');
});

test('the same PIN gets another salt and so another hash each time', async () => {
  const a = await hashPin('4821', { iter: FAST });
  const b = await hashPin('4821', { iter: FAST });
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('checking: the right PIN passes, any other fails, a damaged record fails', async () => {
  const record = await hashPin('4821', { iter: FAST });
  assert.equal(await verifyPin('4821', record), true);
  assert.equal(await verifyPin('4822', record), false);
  assert.equal(await verifyPin('', record), false);
  assert.equal(await verifyPin('4821', { ...record, hash: 'AAAA' }), false);
  assert.equal(await verifyPin('4821', null), false);
});

/* ---------- the attempt limit ---------- */

test('four wrong PINs: no pause yet; the fifth: a 30 second pause', () => {
  let state = { fails: 0, until: 0, bioFails: 0 };
  const now = 1_000_000;
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    state = afterFailure(state, now);
    assert.equal(waitLeft(state, now), 0, `after ${i} wrong, no pause`);
  }
  state = afterFailure(state, now);
  assert.equal(state.fails, MAX_ATTEMPTS);
  assert.equal(waitLeft(state, now), 30_000);
  assert.equal(waitLeft(state, now + 29_999), 1);
  assert.equal(waitLeft(state, now + 30_000), 0, 'then it can be tried again');
});

test('every further 5 wrong PINs doubles the pause, up to 15 minutes', () => {
  assert.deepEqual(
    [5, 10, 15, 20, 25, 30, 35, 60].map(cooldownFor),
    [30e3, 60e3, 120e3, 240e3, 480e3, 900e3, 900e3, 900e3],
  );
  assert.equal(cooldownFor(4), 0);
  assert.equal(cooldownFor(7), 0, 'only every fifth wrong PIN pauses');
});

test('the right PIN clears the count', () => {
  let state = { fails: 0, until: 0, bioFails: 0 };
  for (let i = 0; i < 7; i++) {
    state = afterFailure(state, 0);
  }
  assert.deepEqual(afterSuccess(state), { fails: 0, until: 0, bioFails: 0 });
});

test('after 5 failed biometric tries, only the PIN opens the app', () => {
  let state = { fails: 0, until: 0, bioFails: 0 };
  for (let i = 1; i < BIO_ATTEMPTS; i++) {
    state = afterBioFailure(state);
    assert.ok(bioAllowed(state), `still allowed after ${i}`);
  }
  state = afterBioFailure(state);
  assert.equal(bioAllowed(state), false);
  assert.equal(bioAllowed(afterSuccess(state)), true, 'the PIN gives biometrics back');
});

/* ---------- when the app locks ---------- */

test('locks when it was away at least the chosen time; not before; never without a PIN', () => {
  const at = 10_000_000;
  const o = { hasPin: true, timeout: 300, lastActive: at };
  assert.equal(shouldLock({ ...o, now: at + 299_999 }), false);
  assert.equal(shouldLock({ ...o, now: at + 300_000 }), true);
  assert.equal(shouldLock({ ...o, timeout: 0, now: at + 1 }), true, '"immediately" locks as soon as it was away');
  assert.equal(shouldLock({ ...o, hasPin: false, now: at + 1e9 }), false);
  assert.equal(shouldLock({ ...o, lastActive: null, now: at }), true, 'no trace of when it was last used: locked');
  assert.equal(shouldLock({ ...o, now: at - 5000 }), true, 'a clock that went back is not trusted');
});

test('with the data encrypted, a freshly opened app is always locked (the key is not kept anywhere)', () => {
  const at = 10_000_000;
  assert.equal(
    shouldLock({ hasPin: true, timeout: 3600, lastActive: at, now: at + 10, fresh: true, encrypted: true }),
    true,
  );
  assert.equal(
    shouldLock({ hasPin: true, timeout: 3600, lastActive: at, now: at + 10, fresh: true, encrypted: false }),
    false,
  );
});

/* ---------- encryption at rest ---------- */

test('sealed data can only be read with the key of the same PIN', async () => {
  const salt = 'c2FsdHNhbHRzYWx0c2FsdA==';
  const key = await dataKey('4821', salt, FAST);
  const sealed = await sealText('{"plans":{"a":{"name":"Secret plan"}}}', key);
  assert.ok(isSealed(sealed));
  assert.ok(!JSON.stringify(sealed).includes('Secret'), 'nothing readable is stored');
  assert.equal(await openText(sealed, key), '{"plans":{"a":{"name":"Secret plan"}}}');
  const wrong = await dataKey('4822', salt, FAST);
  await assert.rejects(() => openText(sealed, wrong));
  const again = await sealText('same text', key);
  const twice = await sealText('same text', key);
  assert.notEqual(again.iv, twice.iv, 'a new IV every time');
  assert.ok(!isSealed({ v: 6, plans: {} }) && !isSealed(null));
});

test('a large plan (about 2 MB) seals and opens (no limit of function arguments on the way)', async () => {
  const key = await dataKey('4821', 'c2FsdHNhbHRzYWx0c2FsdA==', FAST);
  const big = JSON.stringify({
    items: Array.from({ length: 30000 }, (_, i) => ({ id: 'item' + i, name: 'Groceries ' + i, amount: i })),
  });
  assert.ok(big.length > 1.5e6);
  assert.equal(await openText(await sealText(big, key), key), big);
});

test('lock settings are cleaned: no PIN means no lock, and nothing else can stand without it', async () => {
  const { normLock } = await import('../../src/services/lockConfig.js');
  const none = normLock(undefined);
  assert.deepEqual([none.pin, none.bio, none.encrypt, none.timeout, none.fails], [null, null, null, 60, 0]);
  const pin = await hashPin('4821', { iter: FAST });
  const full = normLock({
    pin,
    timeout: 300,
    bio: { id: 'abcd', pub: 'efgh', alg: -7 },
    encrypt: { salt: 'c2FsdA==', iter: 1000 },
    fails: 3,
  });
  assert.deepEqual([full.timeout, full.bio.alg, full.encrypt.iter, full.fails], [300, -7, 1000, 3]);
  const orphans = normLock({
    timeout: 7,
    bio: { id: 'abcd', pub: 'efgh', alg: -7 },
    encrypt: { salt: 'c2FsdA==', iter: 1000 },
  });
  assert.deepEqual(
    [orphans.bio, orphans.encrypt, orphans.timeout],
    [null, null, 60],
    'biometrics and encryption need a PIN',
  );
  assert.deepEqual(normLock(normLock(full)), normLock(full));
});

test('an ES256 signature in DER becomes the 64 raw bytes Web Crypto checks, and checks', async () => {
  const { derToRaw } = await import('../../src/services/biometric.js');
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const data = new TextEncoder().encode('authenticator data + client data hash');
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, data));
  // DER as an authenticator sends it: 0x30 len 0x02 lenR R 0x02 lenS S, with a 0x00 before a number with its high bit set
  const int = part => (part[0] & 0x80 ? [0, ...part] : [...part]);
  const r = int(raw.subarray(0, 32));
  const s = int(raw.subarray(32));
  const der = Uint8Array.from([0x30, 4 + r.length + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s]);
  assert.deepEqual(derToRaw(der), raw);
  assert.equal(
    await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, derToRaw(der), data),
    true,
  );
});
