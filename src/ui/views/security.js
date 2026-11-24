/**
 * @file Settings › Lock and privacy (the app lock, biometrics, encryption at rest, hidden amounts) and Settings ›
 * Reminders (bill reminders). Each change is written in the activity log. The lock's logic is ui/lock.js; reminders
 * ui/reminders.js.
 */
import { $t, plural } from '../../core/i18n.js';
import { LOCK_TIMEOUTS } from '../../logic/lock.js';
import { REMINDER_DAYS } from '../../logic/reminders.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { card, chip, segc } from '../components/layout.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { Lock } from '../lock.js';
import { pinModal } from '../modals/pin.js';
import { askNotifications, checkReminders, systemNotifications } from '../reminders.js';

/** One setting: its name and what it does on the left, the control on the right. */
const option = (label, hint, control) =>
  h(
    'div',
    { class: 'row opt' },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 't', text: label }),
      hint ? h('div', { class: 'd', text: hint }) : null,
    ),
    control,
  );
const toggle = (label, checked, onChange, disabled = false) =>
  h(
    'label',
    { class: 'switch' },
    h('input', {
      type: 'checkbox',
      checked,
      disabled,
      'aria-label': label,
      onchange: e => onChange(e.target.checked, e.target),
    }),
  );
/** A choice out of a few, named for screen readers. */
function choice(label, options, current, onPick) {
  const control = segc(options, current, onPick);
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', label);
  return control;
}
const TIMEOUT_NAMES = () => ({
  0: $t('Immediately'),
  60: $t('1 minute'),
  300: $t('5 minutes'),
  900: $t('15 minutes'),
  3600: $t('1 hour'),
});
/** Why biometrics cannot be offered here, in words. */
const BIO_REASONS = () => ({
  file: $t(
    'Not when Runway is opened as a file from your device: fingerprint and face need it to be opened from a web address (https).',
  ),
  insecure: $t('Not on a page that is not secure (https).'),
  missing: $t('This browser does not support it.'),
  none: $t('This device has no fingerprint or face unlock, or it is not set up.'),
});
/** Redraws the page after a change (the settings page shows the new state). */
const after = () => App.render();

/** Biometrics: offered only where WebAuthn works; its row is filled in once that is known (it is asked async). */
function bioRow() {
  const cfg = Lock.cfg;
  const slot = h(
    'div',
    { class: 'row opt' },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 't', text: $t('Fingerprint or face') }),
      h('div', { class: 'd', text: $t('Checking this device…') }),
    ),
  );
  if (cfg.encrypt) {
    slot.querySelector('.d').textContent = $t(
      'Off while the data is encrypted: only your PIN can make the key that opens it.',
    );
    return slot;
  }
  Lock.support().then(s => {
    const on = !!cfg.bio;
    slot.replaceWith(
      option(
        $t('Fingerprint or face'),
        s.ok
          ? $t('Unlock with this device’s fingerprint or face check. After 5 failed tries, only your PIN opens it.')
          : BIO_REASONS()[s.reason],
        toggle(
          $t('Fingerprint or face'),
          on,
          async (value, input) => {
            try {
              if (value) {
                await Lock.enableBio();
              } else {
                Lock.disableBio();
              }
            } catch (e) {
              input.checked = !value;
              // closing the phone's prompt ("Use PIN") is a choice, not an error: the switch just stays off
              if (!(e && e.cancelled)) {
                toast($t('Fingerprint or face could not be set up: {0}', String(e && e.message)), { kind: 'bad' });
              }
            }
            after();
          },
          !s.ok && !on,
        ),
      ),
    );
  });
  return slot;
}

/**
 * The cards of Settings › Lock and privacy.
 * @returns {HTMLElement[]} the lock card and the privacy card
 */
export function securityCards() {
  const cfg = Lock.cfg;
  const on = Lock.enabled();
  const names = TIMEOUT_NAMES();
  const lockCard = card(
    $t('App lock'),
    on
      ? $t('On: a PIN is asked when Runway opens or comes back after being away.')
      : $t('Off: anyone who can open this browser can open your plans.'),
    on ? chip($t('on'), 'good') : chip($t('off')),
    // the person must know what the PIN does and does not do
    h(
      'p',
      { class: 'note warn lock-note' },
      icon('alert'),
      h('span', {
        text: cfg.encrypt
          ? $t(
              'Your data on this device is encrypted with a key made from your PIN. If you forget the PIN, Runway cannot open it: keep a backup (Settings › Backup).',
            )
          : $t(
              'A PIN is a screen lock only: it does not encrypt the data stored in this browser. Someone with access to this browser’s storage or its developer tools can still read it. To protect the stored data too, turn on “Encrypt the data on this device”.',
            ),
      }),
    ),
    h(
      'div',
      { class: 'rows' },
      option(
        $t('PIN'),
        on
          ? $t('4 to 12 digits. Stored only as a salted hash, never as itself.')
          : $t('Set a PIN of 4 to 12 digits to turn the lock on.'),
        h(
          'div',
          { class: 'acts' },
          on
            ? [
                btn(
                  $t('Change PIN'),
                  () =>
                    pinModal({
                      mode: 'change',
                      title: $t('Change your PIN'),
                      check: pin => Lock.check(pin),
                      save: async pin => {
                        await Lock.changePin(pin);
                        after();
                      },
                    }),
                  'sm',
                ),
                btn(
                  $t('Turn off'),
                  () =>
                    pinModal({
                      mode: 'confirm',
                      title: $t('Turn the app lock off?'),
                      text: cfg.encrypt ? $t('The data on this device is decrypted and stored as before.') : '',
                      check: pin => Lock.check(pin),
                      save: async () => {
                        await Lock.disable();
                        after();
                      },
                    }),
                  'sm ghost',
                ),
              ]
            : btn(
                $t('Set a PIN'),
                () =>
                  pinModal({
                    mode: 'new',
                    title: $t('Set a PIN'),
                    text: $t(
                      'You will need it to open Runway. It cannot be recovered: if you forget it, the only way in is to erase the data in this browser.',
                    ),
                    save: async pin => {
                      await Lock.enable(pin);
                      after();
                    },
                  }),
                'sm primary',
                'plus',
              ),
        ),
      ),
      on
        ? option(
            $t('Lock after'),
            $t('How long Runway may be in the background, or closed, before it asks for the PIN again.'),
            choice(
              $t('Lock after'),
              LOCK_TIMEOUTS.map(s => [s, names[s]]),
              cfg.timeout,
              s => {
                Lock.setTimeout(s, names[s]);
                after();
              },
            ),
          )
        : null,
      on ? bioRow() : null,
      on
        ? option(
            $t('Encrypt the data on this device'),
            $t(
              'Stores your plans encrypted (AES-256) with a key made from your PIN, so a look at the browser’s storage shows nothing readable. Someone who copies that storage can try every short PIN in seconds: choose 8 digits or more. Fingerprint and face are off then.',
            ),
            toggle($t('Encrypt the data on this device'), !!cfg.encrypt, (value, input) => {
              input.checked = !value; // until the PIN is confirmed
              pinModal({
                mode: 'confirm',
                title: value ? $t('Encrypt your data?') : $t('Stop encrypting your data?'),
                text: value
                  ? $t('If you forget your PIN, Runway cannot open the data again. Export a backup first.')
                  : $t('Your data is stored unencrypted in this browser again.'),
                check: pin => Lock.check(pin),
                save: async pin => {
                  if (value) {
                    await Lock.enableEncryption(pin);
                  } else {
                    await Lock.disableEncryption();
                  }
                  after();
                },
              });
            }),
          )
        : null,
      on
        ? option(
            $t('Lock now'),
            null,
            btn($t('Lock now'), () => Lock.lock(), 'sm', 'lock'),
          )
        : null,
    ),
  );
  const privacy = card(
    $t('Privacy on screen'),
    null,
    null,
    h(
      'div',
      { class: 'rows' },
      option(
        $t('Hide amounts until tapped'),
        $t(
          'Shows ••• instead of amounts, for when someone can see your screen. Tap an amount, or the eye at the top, to show them; they hide again when Runway goes to the background.',
        ),
        toggle($t('Hide amounts until tapped'), Store.db.hideAmounts, value =>
          Store.setPref('hideAmounts', value, value ? $t('Hide amounts: on') : $t('Hide amounts: off')),
        ),
      ),
    ),
  );
  return [lockCard, privacy];
}

/**
 * The card of Settings › Reminders.
 * @returns {HTMLElement[]}
 */
export function reminderCards() {
  const prefs = Store.db.reminders;
  const set = (change, label) => Store.setPref('reminders', { ...prefs, ...change }, label);
  const permission = systemNotifications();
  const days = d => {
    if (d === 0) {
      return $t('On the day');
    }
    if (d === 7) {
      return $t('A week before');
    }
    return $t('{0} before', plural(d, 'day'));
  };
  const systemText = {
    granted: $t('Allowed.'),
    denied: $t('Blocked in this browser. Allow notifications for this page in the browser’s settings.'),
    default: $t('Your browser will ask when you turn this on.'),
    unsupported: $t('This browser cannot show notifications. The reminders in the app still work.'),
  }[permission];
  return [
    card(
      $t('Bill reminders'),
      $t('A reminder of bills and payments that are due, while Runway is open.'),
      null,
      h(
        'div',
        { class: 'rows' },
        option(
          $t('Remind me of payments'),
          $t(
            'Recurring bills and subscriptions, loan payments and one-off payments with a day, until they are ticked as paid. Due ones also show at the top of the Overview.',
          ),
          toggle($t('Remind me of payments'), prefs.on, value =>
            set({ on: value }, value ? $t('Bill reminders: on') : $t('Bill reminders: off')),
          ),
        ),
        prefs.on
          ? option(
              $t('How early'),
              null,
              choice(
                $t('How early'),
                REMINDER_DAYS.map(d => [d, days(d)]),
                prefs.days,
                d => set({ days: d }, $t('Bill reminders: {0}', days(d))),
              ),
            )
          : null,
        ...(prefs.on
          ? [
              ['bill', $t('Bills and subscriptions')],
              ['loan', $t('Loan payments')],
              ['oneoff', $t('One-off payments')],
            ].map(([key, label]) =>
              option(
                label,
                null,
                toggle(label, prefs[key], value =>
                  set({ [key]: value }, $t('Bill reminders, {0}: {1}', label, value ? $t('on') : $t('off'))),
                ),
              ),
            )
          : []),
        prefs.on
          ? option(
              $t('Also as system notifications'),
              systemText,
              toggle(
                $t('Also as system notifications'),
                prefs.notify && permission === 'granted',
                async (value, input) => {
                  if (value && permission !== 'granted') {
                    const answer = await askNotifications();
                    if (answer !== 'granted') {
                      input.checked = false;
                      after();
                      return;
                    }
                  }
                  set({ notify: value }, value ? $t('System notifications: on') : $t('System notifications: off'));
                },
                permission === 'unsupported' || permission === 'denied',
              ),
            )
          : null,
        prefs.on
          ? option(
              $t('Try it'),
              null,
              btn(
                $t('Show the reminders now'),
                () => {
                  if (!checkReminders({ test: true }).length) {
                    toast($t('Nothing is due in the days you chose.'));
                  }
                },
                'sm',
              ),
            )
          : null,
      ),
      h('p', {
        class: 'muted small',
        text: $t(
          'Runway is a file on your device, with no server: it cannot wake your device. Reminders come while it is open in a browser tab, also in the background. When the app lock or hidden amounts are on, system notifications say how many payments are due, not which or how much. On iPhone and iPad, system notifications only work for web apps added to the Home Screen; the reminders in the app always do.',
        ),
      }),
    ),
  ];
}
