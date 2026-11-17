/**
 * @file Settings › Storage: Google Drive sync (state/driveSync.js) and moving plans with QR codes
 * (modals/qrTransfer.js); and the small sync status icon of the menu and the top bar. See docs/sync.md.
 */
import { APP } from '../../config.js';
import { FMT } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { Drive } from '../../state/driveSync.js';
import { btn } from '../components/button.js';
import { card, chip } from '../components/layout.js';
import { confirmModal } from '../components/modal.js';
import { formModal } from '../components/form.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { qrReceiveModal, qrSendModal } from '../modals/qrTransfer.js';

/** Each status: its name, colour, icon and what it means (the status icon's tooltip). */
export const DRIVE_STATUS = {
  off: () => [$t('Off'), '', 'cloudOff', $t('Google Drive sync is off.')],
  syncing: () => [$t('Syncing…'), 'acc', 'refresh', $t('Syncing with Google Drive…')],
  synced: () => [$t('Synced'), 'good', 'cloud', $t('Synced with Google Drive.')],
  offline: () => [
    $t('Offline'),
    'warn',
    'cloudOff',
    $t('Offline. Your changes are saved here and sync when the connection returns.'),
  ],
  signin: () => [
    $t('Sign in again'),
    'warn',
    'alert',
    $t('Google needs you to sign in again to keep syncing. Your changes are saved here meanwhile.'),
  ],
  locked: () => [
    $t('Passphrase needed'),
    'warn',
    'lock',
    $t('Your data in Google Drive is encrypted. Enter its passphrase on this device to sync.'),
  ],
  error: () => [$t('Not syncing'), 'bad', 'alert', $t('Google Drive did not answer. Runway tries again in a minute.')],
};

const ago = ms => {
  if (!ms) {
    return '';
  }
  return new Date(ms).toLocaleString(FMT.dloc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Why Drive sync cannot be used here, or '' when it can. */
export function driveUnavailable() {
  if (!APP.google.clientId) {
    return $t(
      'Google Drive sync is not set up in this copy of Runway: it needs the Google client ID of whoever publishes it (see docs/sync.md). Use a data file in a synced folder, or QR codes, instead.',
    );
  }
  if (location.protocol === 'file:') {
    return $t(
      'Google sign-in does not work in a page opened as a file. Open Runway from its web address, or install it from there, to sync with Google Drive.',
    );
  }
  return '';
}

/** The icon in the menu's foot and the top bar while sync is on. A click: sign in again, or Settings › Storage. */
export function syncIcon(go) {
  if (!Drive.enabled) {
    return null;
  }
  const [label, tone, ic, text] = DRIVE_STATUS[Drive.status]();
  if (Drive.status === 'signin') {
    Drive.prepare(); // sync is on: Google's script ready for the click on this icon
  }
  const title = Drive.lastSync && Drive.status === 'synced' ? `${text} ${ago(Drive.lastSync)}` : text;
  return h(
    'button',
    {
      type: 'button',
      class: 'btn ghost icon sync-state ' + tone + (Drive.status === 'syncing' ? ' spin' : ''),
      title,
      'aria-label': $t('Google Drive: {0}', label),
      'data-sync-status': Drive.status,
      onclick: () => (Drive.status === 'signin' ? signIn() : go()),
    },
    icon(ic),
  );
}

/** "Sign in again": Google's window, from the click. */
function signIn() {
  Drive.signInAgain().then(ok => {
    if (!ok && Drive.status === 'signin') {
      toast($t('Not signed in. Your changes stay on this device until you sign in.'), { kind: 'bad' });
    }
  });
}

/** Asks for a new passphrase twice, with the warning that it cannot be recovered. */
function passphraseModal() {
  formModal({
    title: $t('Encrypt your cloud copy'),
    saveLabel: $t('Encrypt'),
    values: { pw: '', pw2: '' },
    fields: [
      {
        k: 'pw',
        type: 'pass',
        max: 200,
        label: $t('Passphrase'),
        hint: $t(
          'Your data is encrypted on this device before it goes to Google Drive. Your other devices need the same passphrase once. A lost passphrase cannot be recovered by anyone: keep it somewhere safe.',
        ),
      },
      { k: 'pw2', type: 'pass', max: 200, label: $t('Repeat passphrase') },
    ],
    onSave: v => {
      if (!v.pw || v.pw.length < 8) {
        return $t('Use at least 8 characters.');
      }
      if (v.pw !== v.pw2) {
        return $t('The passphrases do not match.');
      }
      Drive.setPassphrase(v.pw).then(() => toast($t('Your cloud copy is encrypted.')));
      return '';
    },
  });
}

/** The passphrase set on another device, to read the encrypted cloud copy. */
function unlockModal() {
  formModal({
    title: $t('Enter the passphrase'),
    saveLabel: $t('Unlock'),
    values: { pw: '' },
    fields: [
      {
        k: 'pw',
        type: 'pass',
        max: 200,
        label: $t('Passphrase'),
        hint: $t('The passphrase you chose when you encrypted your cloud copy on another device.'),
      },
    ],
    onSave: v => {
      if (!v.pw) {
        return $t('Enter the passphrase.');
      }
      Drive.unlock(v.pw).then(ok =>
        ok
          ? toast($t('Unlocked. Syncing.'))
          : toast($t('That passphrase does not open your cloud copy.'), { kind: 'bad' }),
      );
      return '';
    },
  });
}

const kv = (label, value) => h('div', { class: 'row' }, h('span', { class: 'grow muted', text: label }), value);
const note = (tone, ic, text) =>
  h('div', { class: 'note ' + tone, style: 'margin-top:12px' }, icon(ic), h('div', { class: 'grow', text }));

/** "Turn on sync": Google's window opens from the click. */
export function turnOnButton(label = $t('Turn on sync'), tone = 'primary') {
  const on = btn(
    label,
    () =>
      Drive.turnOn().then(ok => {
        if (ok) {
          toast($t('Sync is on. A copy of your data as it was is kept in this browser.'));
        }
      }),
    tone,
    'cloud',
  );
  // nothing goes to Google before this click, not even a request for its script (if a browser then blocks
  // Google's window because the script took long to load, Drive.turnOn says to click once more)
  on.dataset.driveOn = '';
  return on;
}

export function driveCard() {
  const title = $t('Sync with Google Drive');
  const about = $t(
    'Keeps your plans in step on every device where you sign in with the same Google account: your computer, phone and tablet. Every change is saved here first, so Runway works offline; it syncs when it can.',
  );
  const privacy = h('p', {
    class: 'small muted',
    style: 'margin-top:10px',
    text: $t(
      'Runway stores one file in a hidden app folder of your Google Drive. It can see only that file, never your other files, and no server of ours is involved. With a passphrase, Google cannot read it either.',
    ),
  });
  const why = driveUnavailable();
  if (why) {
    return card(title, about, null, note('info', 'info', why), privacy);
  }
  if (!Drive.enabled) {
    return card(title, about, null, h('div', { class: 'acts', style: 'margin-top:4px' }, turnOnButton()), privacy);
  }
  const status = Drive.status;
  const [label, tone, , text] = DRIVE_STATUS[status]();
  if (status === 'signin') {
    Drive.prepare();
  }
  const rows = h(
    'div',
    { class: 'rows', 'data-drive-status': status },
    kv($t('Status'), chip(label, tone)),
    kv($t('Last synced'), h('span', { text: Drive.lastSync ? ago(Drive.lastSync) : $t('Not yet') })),
    kv(
      $t('Encryption'),
      h('span', {
        text:
          status === 'locked'
            ? $t('On (set on another device)')
            : Drive.encrypted
              ? $t('With your passphrase')
              : $t('Off'),
      }),
    ),
  );
  const notes = {
    offline: () => note('warn', 'cloudOff', text),
    signin: () => note('warn', 'alert', text),
    locked: () => note('warn', 'lock', text),
    error: () => note('bad', 'alert', Drive.detail && Drive.detail !== 'busy' ? `${text} (${Drive.detail})` : text),
  };
  const main = {
    signin: () => btn($t('Sign in again'), signIn, 'primary', 'check'),
    locked: () => btn($t('Enter the passphrase'), unlockModal, 'primary', 'lock'),
    error: () => btn($t('Try again'), () => Drive.sync('try again'), 'primary', 'refresh'),
  };
  return card(
    title,
    about,
    null,
    rows,
    notes[status] ? notes[status]() : null,
    h(
      'div',
      { class: 'acts', style: 'margin-top:12px' },
      main[status] ? main[status]() : btn($t('Sync now'), () => Drive.sync('now'), '', 'refresh'),
      Drive.encrypted
        ? btn($t('Remove the passphrase'), () =>
            confirmModal(
              $t('Remove the passphrase?'),
              $t('Your cloud copy will be stored without encryption, readable by Google like your other Drive files.'),
              $t('Remove the passphrase'),
              () => Drive.setPassphrase(null),
            ),
          )
        : status !== 'locked'
          ? btn($t('Encrypt with a passphrase'), passphraseModal, '', 'lock')
          : null,
      btn($t('Turn off sync'), () => Drive.turnOff(), 'ghost'),
      btn(
        $t('Delete my cloud data'),
        () =>
          confirmModal(
            $t('Delete your data from Google Drive?'),
            $t(
              'The file in Runway’s app folder of your Google Drive is deleted and sync is turned off on this device. Your plans stay on this device. Your other devices stop syncing when they notice.',
            ),
            $t('Delete my cloud data'),
            () =>
              Drive.deleteCloudData().then(ok =>
                toast(ok ? $t('Your data was deleted from Google Drive.') : $t('Nothing was deleted.'), {
                  kind: ok ? '' : 'bad',
                }),
              ),
          ),
        'ghost danger',
        'trash',
      ),
    ),
    privacy,
  );
}

export function qrCard() {
  return card(
    $t('Move with QR codes'),
    $t(
      'Move plans to another device without any network or account: one screen shows a loop of QR codes, the other reads them with its camera. Encrypted with a one-time code.',
    ),
    null,
    h(
      'div',
      { class: 'acts', style: 'margin-top:4px' },
      btn($t('Send'), qrSendModal, '', 'qr'),
      btn($t('Receive'), qrReceiveModal, '', 'camera'),
    ),
  );
}
