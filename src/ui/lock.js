/**
 * @file The app lock (Settings › Lock and privacy): the lock screen, when it shows, and turning the lock, biometrics and
 * encryption at rest on and off. The rules (attempts, pauses, "lock after") are logic/lock.js; the PIN's hash and the
 * encryption services/pin.js; biometrics services/biometric.js; the settings on this device services/lockConfig.js.
 *
 * - A PIN on its own is a screen lock: the data in the browser's storage stays readable to someone with access to it.
 *   With "encrypt the data on this device" the data is stored sealed with a key made from the PIN, and a freshly
 *   opened app can only show anything after the PIN (biometrics cannot make that key, so they are off then).
 * - The app locks when it opens, or comes back from the background, after being away at least the chosen time.
 *   "Immediately" locks as soon as it goes to the background, so the phone's app switcher shows the lock, not money.
 * - Every 5 wrong PINs: a pause (30 s, doubled each time, at most 15 min), kept across reloads. After 5 failed
 *   biometric tries only the PIN opens it, until the next unlock.
 * - Forgot the PIN: the only way in is to erase the data in this browser (then restore a backup).
 */
import { APP } from '../config.js';
import { FMT } from '../core/format.js';
import { $t, plural } from '../core/i18n.js';
import { afterBioFailure, afterFailure, afterSuccess, bioAllowed, shouldLock, waitLeft } from '../logic/lock.js';
import { register, support, verify } from '../services/biometric.js';
import { LOCK_KEY, readLock, writeLock } from '../services/lockConfig.js';
import { PIN_ITER, dataKey, hashPin, newSalt, sealedKeyInfo, verifyPin } from '../services/pin.js';
import { Store } from '../state/store.js';
import { h, sv } from './dom.js';
import { UI } from './state.js';

export const Lock = {
  cfg: readLock(),
  locked: false,
  /** The key of the encryption at rest, in memory while the app is open. Never stored. */
  key: null,
  dialog: null,
  enabled() {
    return !!this.cfg.pin;
  },
  save() {
    writeLock(this.cfg);
  },
  /** The app is in use now (written when it goes to the background, and every minute while it is used). */
  markActive() {
    if (this.enabled() && !this.locked) {
      this.cfg.lastActive = Date.now();
      this.save();
    }
  },

  /**
   * Starts the app: `start()` reads the data and draws the page. With sealed data it can only run after the PIN; with
   * plain data the page is drawn behind the lock screen (hidden) so it is there at once when unlocked.
   */
  async boot(start) {
    const sealed = Store.adapter.sealed();
    // sealed data says itself how its key is made (version 2); older sealed data needs the lock settings for that
    if (sealed && !sealedKeyInfo(Store.adapter.raw()) && !(this.cfg.pin && this.cfg.encrypt)) {
      return this.show({ broken: true });
    }
    if (!sealed && this.cfg.encrypt && Store.adapter.raw()) {
      // the data was stored plain again but the settings were not updated (closed in between): they follow the data
      this.cfg = { ...this.cfg, encrypt: null };
      this.save();
    }
    const lock = shouldLock({
      hasPin: this.enabled(),
      timeout: this.cfg.timeout,
      lastActive: this.cfg.lastActive,
      now: Date.now(),
      fresh: true,
      encrypted: sealed,
    });
    if (!lock) {
      start();
      this.markActive();
      return;
    }
    if (!sealed) {
      start();
    }
    await this.show({ sealed });
    if (sealed) {
      start();
    }
    this.writeNote();
  },
  /** Wrong PINs before an unlock are written in the activity log, once the data can be written. */
  writeNote() {
    if (this.pendingNote && Store.db) {
      Store.note(this.pendingNote);
    }
    this.pendingNote = null;
  },
  /** The page went to the background: remember when; "immediately" locks now (the app switcher shows the lock). */
  hidden() {
    UI.revealed = false; // hidden amounts are hidden again
    if (!this.enabled() || this.locked) {
      return;
    }
    this.markActive();
    if (this.cfg.timeout === 0) {
      this.lock();
    }
  },
  /** The page is back: lock when it was away at least the chosen time. */
  visible() {
    if (!this.enabled() || this.locked) {
      return;
    }
    if (shouldLock({ hasPin: true, timeout: this.cfg.timeout, lastActive: this.cfg.lastActive, now: Date.now() })) {
      this.lock();
    }
  },
  /** Locks now (the "Lock now" button, or after time away). */
  lock() {
    if (this.enabled() && !this.locked) {
      UI.revealed = false;
      this.show({ sealed: false }).then(() => this.writeNote());
    }
  },

  /** Shows the lock screen; resolves once unlocked. */
  show({ sealed = false, broken = false } = {}) {
    this.locked = true;
    document.documentElement.classList.add('locked');
    return new Promise(resolve => {
      const done = () => {
        this.locked = false;
        document.documentElement.classList.remove('locked');
        this.dialog.close();
        this.dialog.remove();
        this.dialog = null;
        this.markActive();
        resolve();
      };
      this.dialog = lockScreen({ sealed, broken, done });
      document.body.append(this.dialog);
      this.dialog.showModal();
      const input = this.dialog.querySelector('input');
      if (input) {
        input.focus();
      }
    });
  },

  /**
   * Tries a PIN on the lock screen: 'ok', 'wrong' or 'wait' (a pause after too many wrong ones). With sealed data the
   * right PIN also makes the key and opens the data.
   */
  async tryPin(pin, sealed) {
    if (waitLeft(this.cfg, Date.now()) > 0) {
      return 'wait';
    }
    const right = sealed && !this.key ? await this.openSealed(pin) : await verifyPin(pin, this.cfg.pin);
    if (!right) {
      Object.assign(this.cfg, afterFailure(this.cfg, Date.now()));
      this.save();
      return 'wrong';
    }
    this.unlocked();
    return 'ok';
  },
  /**
   * With sealed data, the PIN is right when it opens the data (not when it matches the stored hash): the data is
   * what counts. If the settings do not match it (a PIN change interrupted after the data was sealed again), they
   * are put right from it.
   */
  async openSealed(pin) {
    const info = sealedKeyInfo(Store.adapter.raw()) || this.cfg.encrypt;
    if (!info) {
      return false;
    }
    let key;
    try {
      key = await dataKey(pin, info.salt, info.iter);
      await Store.adapter.unlock(key);
    } catch (error) {
      return false;
    }
    this.key = key;
    const settingsFit = this.cfg.encrypt && this.cfg.encrypt.salt === info.salt && (await verifyPin(pin, this.cfg.pin));
    if (!settingsFit) {
      this.cfg = { ...this.cfg, pin: await hashPin(pin), encrypt: { salt: info.salt, iter: info.iter }, bio: null };
      this.save();
    }
    return true;
  },
  /**
   * Biometrics on the lock screen: 'ok' (unlocked), 'fail' (refused: one failed try more) or 'cancel' (the person
   * chose the PIN, or it was not allowed: nothing is counted).
   */
  async tryBio() {
    if (!this.cfg.bio || this.cfg.encrypt || !bioAllowed(this.cfg)) {
      return 'cancel';
    }
    const outcome = await verify(this.cfg.bio);
    if (outcome === 'fail') {
      Object.assign(this.cfg, afterBioFailure(this.cfg));
      this.save();
    }
    if (outcome === 'ok') {
      this.unlocked();
    }
    return outcome;
  },
  unlocked() {
    const fails = this.cfg.fails;
    Object.assign(this.cfg, afterSuccess());
    this.save();
    // written down once the data is readable (with sealed data, right after it is opened)
    this.pendingNote = fails ? $t('{0} before the app was unlocked', plural(fails, 'wrong PIN')) : null;
  },

  /* --- settings (Settings › Lock and privacy); each change is written in the activity log --- */

  /** Turns the lock on with a new PIN. */
  async enable(pin) {
    this.cfg = { ...this.cfg, ...afterSuccess(), pin: await hashPin(pin), lastActive: Date.now() };
    this.save();
    Store.note($t('App lock turned on'));
  },
  /** Checks the PIN asked for a change in the settings (not counted as a lock-screen try). */
  check(pin) {
    return verifyPin(pin, this.cfg.pin);
  },
  async changePin(pin) {
    const record = await hashPin(pin);
    if (this.cfg.encrypt) {
      // a new PIN makes a new key: the data is sealed again with it first (one write that carries its salt), and
      // only then are the settings changed; if that write fails nothing has changed
      const encrypt = { salt: newSalt(), iter: PIN_ITER };
      const key = await dataKey(pin, encrypt.salt, encrypt.iter);
      await Store.adapter.seal(key, Store.db, encrypt);
      this.key = key;
      this.cfg = { ...this.cfg, pin: record, encrypt };
    } else {
      this.cfg = { ...this.cfg, pin: record };
    }
    this.save();
    Store.note($t('PIN changed'));
  },
  async disable() {
    if (this.cfg.encrypt) {
      await Store.adapter.unseal(Store.db); // throws, changing nothing, when it cannot be stored
    }
    this.key = null;
    this.cfg = { ...this.cfg, pin: null, bio: null, encrypt: null, ...afterSuccess() };
    this.save();
    Store.note($t('App lock turned off'));
  },
  setTimeout(seconds, label) {
    this.cfg = { ...this.cfg, timeout: seconds };
    this.save();
    Store.note($t('Lock after: {0}', label));
  },
  support,
  async enableBio() {
    const bio = await register();
    this.cfg = { ...this.cfg, bio };
    this.save();
    Store.note($t('Biometric unlock turned on'));
  },
  disableBio() {
    this.cfg = { ...this.cfg, bio: null };
    this.save();
    Store.note($t('Biometric unlock turned off'));
  },
  /** Encrypts the data on this device with a key made from `pin` (checked by the caller). Biometrics go off. */
  async enableEncryption(pin) {
    const encrypt = { salt: newSalt(), iter: PIN_ITER };
    const key = await dataKey(pin, encrypt.salt, encrypt.iter);
    // the sealed data carries its salt, so it is stored first; the settings follow once it is (throws otherwise)
    await Store.adapter.seal(key, Store.db, encrypt);
    this.key = key;
    this.cfg = { ...this.cfg, encrypt, bio: null };
    this.save();
    Store.note($t('Encryption of the data on this device turned on'));
  },
  async disableEncryption() {
    await Store.adapter.unseal(Store.db);
    this.key = null;
    this.cfg = { ...this.cfg, encrypt: null };
    this.save();
    Store.note($t('Encryption of the data on this device turned off'));
  },
  /**
   * Another tab changed the lock settings. A new PIN, or encryption turned on or off, makes this tab's key and data
   * out of date: it stops writing and starts again (the lock screen asks for the PIN as needed). Other changes (the
   * time it was last used, wrong tries) are only taken over.
   */
  reload() {
    const before = this.cfg;
    this.cfg = readLock();
    const security = c => JSON.stringify([c.pin && c.pin.hash, c.encrypt && c.encrypt.salt]);
    if (security(before) !== security(this.cfg)) {
      Store.adapter.freeze();
      location.reload();
    }
  },
  /** Forgot the PIN: erases the data and the lock in this browser, then starts again (a backup can be imported). */
  erase() {
    Store.adapter.erase([LOCK_KEY]);
    location.reload();
  },
};

/** "30 s", "2 min": how long a pause still lasts. */
const waitText = ms => (ms >= 60e3 ? $t('{0} min', Math.ceil(ms / 60e3)) : $t('{0} s', Math.ceil(ms / 1000)));

/** The lock screen: a modal dialog above everything, the app behind it hidden (html.locked). */
function lockScreen({ sealed, broken, done }) {
  const d = h('dialog', { class: 'lockscreen', 'aria-labelledby': 'lock-title', 'aria-describedby': 'lock-text' });
  // Esc must not close the lock
  d.addEventListener('cancel', e => e.preventDefault());
  const title = h('h2', { id: 'lock-title', text: $t('{0} is locked', APP.name) });
  const message = h('p', { class: 'lock-msg', role: 'alert' });
  if (broken) {
    d.append(
      h(
        'div',
        { class: 'lock-in' },
        title,
        h('p', {
          id: 'lock-text',
          text: $t(
            'The data in this browser is encrypted, but the lock settings that open it are missing. It cannot be opened. You can erase it and import a backup.',
          ),
        }),
        eraseBlock(),
      ),
    );
    return d;
  }
  const pin = h('input', {
    class: 'inp lock-pin',
    type: 'password',
    inputmode: 'numeric',
    autocomplete: 'off',
    maxlength: 12,
    'aria-label': $t('PIN'),
    placeholder: $t('PIN'),
  });
  const submit = h('button', { type: 'submit', class: 'btn primary', text: $t('Unlock') });
  let timer = 0;
  /** A pause after too many wrong PINs: the field waits and says for how long. */
  const pause = () => {
    clearInterval(timer);
    const tick = () => {
      const left = waitLeft(Lock.cfg, Date.now());
      pin.disabled = submit.disabled = left > 0;
      if (left > 0) {
        message.textContent = $t('Too many wrong PINs. Try again in {0}.', waitText(left));
      } else {
        clearInterval(timer);
        message.textContent = '';
        pin.focus();
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  };
  const form = h(
    'form',
    {
      class: 'lock-form',
      onsubmit: async e => {
        e.preventDefault();
        const value = pin.value;
        pin.value = '';
        submit.disabled = true;
        message.textContent = $t('Checking…');
        const result = await Lock.tryPin(value, sealed).catch(() => 'wrong');
        submit.disabled = false;
        if (result === 'ok') {
          clearInterval(timer);
          done();
          return;
        }
        if (result === 'wait' || waitLeft(Lock.cfg, Date.now()) > 0) {
          pause();
          return;
        }
        const left = 5 - (Lock.cfg.fails % 5);
        message.textContent = $t('Wrong PIN. {0} left before a pause.', plural(left, 'try'));
        pin.focus();
      },
    },
    pin,
    submit,
  );
  const bioButton =
    Lock.cfg.bio && !Lock.cfg.encrypt
      ? h('button', {
          type: 'button',
          class: 'btn',
          text: $t('Use fingerprint or face'),
          hidden: !bioAllowed(Lock.cfg),
          onclick: async () => {
            message.textContent = '';
            const outcome = await Lock.tryBio();
            if (outcome === 'ok') {
              clearInterval(timer);
              done();
              return;
            }
            if (outcome === 'cancel') {
              pin.focus(); // "Use PIN": straight to the PIN, nothing to say
              return;
            }
            if (!bioAllowed(Lock.cfg)) {
              bioButton.hidden = true;
              message.textContent = $t('Too many failed tries with fingerprint or face. Use your PIN.');
            } else {
              message.textContent = $t('Not recognised. Try again, or use your PIN.');
            }
            pin.focus();
          },
        })
      : null;
  const forgot = h(
    'details',
    { class: 'lock-forgot' },
    h('summary', { text: $t('Forgot your PIN?') }),
    h('p', {
      class: 'small',
      text: Lock.cfg.encrypt
        ? $t(
            'Your data is encrypted with your PIN, and Runway cannot open it without it. You can erase it and import a backup.',
          )
        : $t('The PIN cannot be recovered. You can erase the data in this browser and import a backup.'),
    }),
    eraseBlock(),
  );
  d.append(
    h(
      'div',
      { class: 'lock-in' },
      logo(),
      title,
      h('p', {
        id: 'lock-text',
        class: 'muted',
        text: sealed ? $t('Enter your PIN to open your encrypted data.') : $t('Enter your PIN to continue.'),
      }),
      form,
      bioButton,
      message,
      forgot,
    ),
  );
  if (waitLeft(Lock.cfg, Date.now()) > 0) {
    queueMicrotask(pause);
  }
  // in the Android app the phone's fingerprint prompt opens by itself, as in other apps ("Use PIN" closes it); a
  // browser's check needs a tap first
  if (bioButton && !bioButton.hidden && Lock.cfg.bio.kind === 'device') {
    setTimeout(() => d.open && bioButton.click(), 250);
  }
  return d;
}

/** "Erase everything in this browser", behind a tick box that says what it means. */
function eraseBlock() {
  const sure = h('input', { type: 'checkbox', class: 'check' });
  const erase = h('button', {
    type: 'button',
    class: 'btn danger',
    text: $t('Erase the data in this browser'),
    disabled: true,
    onclick: () => Lock.erase(),
  });
  sure.addEventListener('change', () => {
    erase.disabled = !sure.checked;
  });
  return h(
    'div',
    { class: 'lock-erase' },
    h(
      'label',
      { class: 'switch-row' },
      sure,
      h('span', { text: $t('I understand that every plan in this browser is deleted.') }),
    ),
    erase,
  );
}

const logo = () =>
  sv(
    'svg',
    { viewBox: '0 0 32 32', class: 'lock-logo', 'aria-hidden': 'true' },
    sv('rect', { width: 32, height: 32, rx: 8, fill: 'var(--accent)' }),
    sv('path', {
      d: 'M7 22l6-7 4 4 8-10',
      fill: 'none',
      stroke: 'var(--accent-ink)',
      'stroke-width': 2.6,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );

/**
 * Whether amounts are shown now: hidden by the preference until tapped (or shown with the eye button).
 * @returns {void} nothing: it sets FMT.hidden, which money() and the other formatters read
 */
export function applyPrivacy() {
  FMT.hidden = !!(Store.db && Store.db.hideAmounts) && !UI.revealed;
}
