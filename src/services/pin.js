/**
 * @file The PIN and the encryption at rest, with the browser's own cryptography (Web Crypto): nothing is sent anywhere.
 *
 * - The PIN is stored as a salted hash only: PBKDF2 with SHA-256, a random 16-byte salt and many iterations, like the
 *   password of an encrypted backup (services/backup.js). Checking compares in constant time.
 * - Encryption at rest (optional): the stored data is sealed with AES-256-GCM under a key made from the PIN with its
 *   own salt. The key lives in memory only while the app is open and unlocked; it is never stored.
 * A PIN of a few digits is weak against someone who copies the stored data and tries every PIN: the lock keeps
 * people out of the screen; encryption keeps a casual look at the browser's storage out. Both say so on the page.
 */
const enc = new TextEncoder();
/** Base64 of bytes, a chunk at a time: spreading a whole plan into one call would exceed the arguments limit. */
function b64(bytes) {
  const u8 = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(text);
}
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

/** Iterations of PBKDF2 in the app (tests pass fewer). */
export const PIN_ITER = 310000;

async function pbkdf2Bits(pin, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256),
  );
}

/**
 * The salted hash of a PIN: { kdf, iter, salt, hash } (base64). A new random salt each time.
 * @returns {Promise<{kdf: string, iter: number, salt: string, hash: string}>}
 */
export async function hashPin(pin, { iter = PIN_ITER } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { kdf: 'PBKDF2-SHA256', iter, salt: b64(salt), hash: b64(await pbkdf2Bits(pin, salt, iter)) };
}

/** Same length and same bytes, looking at every byte whatever it finds (no early exit to time). */
function sameBytes(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] || 0) ^ (b[i] || 0);
  }
  return diff === 0;
}

/**
 * Whether `pin` is the one `record` (hashPin) was made from. A missing or damaged record never matches.
 * @returns {Promise<boolean>}
 */
export async function verifyPin(pin, record) {
  try {
    if (!record || typeof pin !== 'string' || !pin) {
      return false;
    }
    return sameBytes(await pbkdf2Bits(pin, unb64(record.salt), record.iter), unb64(record.hash));
  } catch (error) {
    return false;
  }
}

/**
 * A random salt for the encryption key (base64).
 * @returns {string} base64
 */
export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

/**
 * The AES-GCM key of the encryption at rest, from the PIN and its own salt. Not extractable.
 * @returns {Promise<CryptoKey>}
 */
export async function dataKey(pin, salt, iter = PIN_ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(salt), iterations: iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Seals a text: { runway: 'sealed', v: 2, salt, iter, iv, data }, with a new IV every time. `meta` is the salt and
 * iterations the key was made with: kept in the sealed data itself, so the data and what opens it are written in one
 * go (a crash between two writes can never leave data that no PIN opens). The salt is not secret.
 * @returns {Promise<object>} the sealed data: {runway: 'sealed', v, salt, iter, iv, data}
 */
export async function sealText(text, key, meta = null) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
  const out = { runway: 'sealed', v: meta ? 2 : 1, iv: b64(iv), data: b64(data) };
  if (meta) {
    out.salt = meta.salt;
    out.iter = meta.iter;
  }
  return out;
}
/**
 * The salt and iterations of the key of sealed data (version 2), or null (version 1: they are in the lock settings).
 * @returns {?{salt: string, iter: number}}
 */
export function sealedKeyInfo(sealed) {
  if (isSealed(sealed) && typeof sealed.salt === 'string' && Number.isFinite(sealed.iter)) {
    return { salt: sealed.salt, iter: sealed.iter };
  }
  return null;
}
/**
 * Opens a sealed text. Throws with the wrong key or damaged data (AES-GCM checks it).
 * @returns {Promise<string>} the text
 */
export async function openText(sealed, key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, key, unb64(sealed.data));
  return new TextDecoder().decode(plain);
}
/**
 * Whether something read from storage is sealed data.
 * @returns {boolean}
 */
export const isSealed = o => !!o && typeof o === 'object' && o.runway === 'sealed' && typeof o.data === 'string';
