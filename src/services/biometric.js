/**
 * @file Biometric unlock with WebAuthn: the device's own fingerprint or face check (a platform authenticator), no
 * server and no network. Turning it on makes a credential on this device and keeps its public key (services/
 * lockConfig.js); unlocking asks the device to sign a fresh random challenge with it, which is checked here: the
 * answer is for this page and this challenge, the person was verified (not only present), and the signature is valid
 * for the stored key.
 *
 * WebAuthn needs a web address: it works when Runway is served over https or from localhost, not when the file is
 * opened from disk (file:// has no domain to tie a credential to). support() says which.
 */
import { $t } from '../core/i18n.js';
const b64 = bytes => {
  const u8 = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(text);
};
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = text => unb64(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));

/**
 * Whether biometric unlock can be offered here: { ok, reason } with reason 'file' (opened from disk), 'insecure',
 * 'missing' (no WebAuthn), 'none' (no fingerprint or face on this device) or '' when it can.
 * @returns {Promise<{ok: boolean, reason: ''|'file'|'insecure'|'missing'|'none'}>}
 */
export async function support() {
  if (location.protocol === 'file:') {
    return { ok: false, reason: 'file' };
  }
  if (!isSecureContext) {
    return { ok: false, reason: 'insecure' };
  }
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    return { ok: false, reason: 'missing' };
  }
  try {
    const ok = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return ok ? { ok: true, reason: '' } : { ok: false, reason: 'none' };
  } catch (e) {
    return { ok: false, reason: 'none' };
  }
}

/**
 * Makes the credential on this device (the system asks for the fingerprint or face). Returns { id, pub, alg }.
 * @returns {Promise<{id: string, pub: string, alg: number}>} the credential (base64)
 */
export async function register() {
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Runway' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'runway', displayName: 'Runway' },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      attestation: 'none',
      timeout: 60000,
    },
  });
  const pub = cred.response.getPublicKey && cred.response.getPublicKey();
  if (!pub) {
    throw new Error($t('This browser cannot set up fingerprint or face unlock for Runway. Use your PIN.'));
  }
  return { id: b64url(cred.rawId), pub: b64(pub), alg: cred.response.getPublicKeyAlgorithm() };
}

/**
 * An ES256 signature comes as DER (SEQUENCE of two INTEGERs); Web Crypto wants the two numbers side by side.
 * @returns {Uint8Array} r and s, 32 bytes each
 */
export function derToRaw(der) {
  const int = at => {
    const len = der[at + 1];
    const start = at + 2;
    let bytes = der.subarray(start, start + len);
    while (bytes.length > 32 && bytes[0] === 0) {
      bytes = bytes.subarray(1);
    }
    const out = new Uint8Array(32);
    out.set(bytes, 32 - bytes.length);
    return [out, start + len];
  };
  const [r, next] = int(2);
  const [s] = int(next);
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/**
 * Asks the device to verify the person with credential `bio` ({ id, pub, alg }). True only when the answer is for
 * this page and this challenge, the person was verified, and the signature is valid. False when it fails or is
 * cancelled.
 * @returns {Promise<boolean>}
 */
export async function verify(bio) {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: fromB64url(bio.id) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    if (!assertion || b64url(assertion.rawId) !== bio.id) {
      return false;
    }
    const { authenticatorData, clientDataJSON, signature } = assertion.response;
    const client = JSON.parse(new TextDecoder().decode(clientDataJSON));
    if (client.type !== 'webauthn.get' || client.challenge !== b64url(challenge) || client.origin !== location.origin) {
      return false;
    }
    const flags = new Uint8Array(authenticatorData)[32];
    if (!(flags & 0x01) || !(flags & 0x04)) {
      return false; // the person must have been present (UP) and verified (UV): a fingerprint or a face, not a tap
    }
    const signed = new Uint8Array(authenticatorData.byteLength + 32);
    signed.set(new Uint8Array(authenticatorData), 0);
    signed.set(new Uint8Array(await crypto.subtle.digest('SHA-256', clientDataJSON)), authenticatorData.byteLength);
    const es = bio.alg === -7;
    const algo = es ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const key = await crypto.subtle.importKey('spki', unb64(bio.pub), algo, false, ['verify']);
    const sig = es ? derToRaw(new Uint8Array(signature)) : new Uint8Array(signature);
    return await crypto.subtle.verify(es ? { name: 'ECDSA', hash: 'SHA-256' } : algo, key, sig, signed);
  } catch (e) {
    return false;
  }
}
