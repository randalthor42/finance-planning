/**
 * @file Settings › Storage: where the plans are kept. The data file (state/fileSync.js): a JSON file the person
 * chooses, written as they make changes and shared with their other devices through a synced folder. And this
 * browser's own copy, which is always kept so the app opens at once and works while the file is out of reach. And
 * Google Drive sync and QR transfers (views/syncSettings.js).
 */
import { FMT } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { Sync } from '../../state/fileSync.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { bar, card, chip } from '../components/layout.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { driveCard, qrCard } from './syncSettings.js';

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
const toggle = (id, label, checked, onChange, disabled) =>
  h(
    'label',
    { class: 'switch' },
    h('input', {
      type: 'checkbox',
      checked,
      disabled,
      'aria-label': label,
      'data-focus': id,
      onchange: event => onChange(event.target.checked),
    }),
  );
const kv = (label, value) => h('div', { class: 'row' }, h('span', { class: 'grow muted', text: label }), value);
const note = (tone, ic, text) =>
  h('div', { class: 'note ' + tone, style: 'margin-top:12px' }, icon(ic), h('div', { class: 'grow', text }));

/** What each status is called, and its colour. */
const STATUS = {
  ok: () => [$t('Saving'), 'good'],
  prompt: () => [$t('Needs your OK'), 'warn'],
  unlinked: () => [$t('No file chosen'), 'warn'],
  error: () => [$t('Not saving'), 'bad'],
};

function when(iso) {
  const d = new Date(iso);
  return isNaN(d)
    ? ''
    : d.toLocaleString(FMT.dloc, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
}

/** The buttons that fit the status. Each file picker opens from the click itself, as the browser requires. */
function actions(status) {
  const saveNew = (label, tone) => btn(label, () => Sync.linkNew(), tone, 'download');
  const open = label => btn(label, () => Sync.linkOpen(), '', 'upload');
  const stop = () => btn($t('Stop using this file'), () => Sync.unlink(), 'ghost');
  const list = {
    unlinked: () => [saveNew($t('Choose where to save'), 'primary'), open($t('Open a data file'))],
    prompt: () => [
      btn($t('Reconnect'), () => Sync.reconnect(), 'primary', 'check'),
      open($t('Open another file')),
      stop(),
    ],
    ok: () => [saveNew($t('Save to a new file'), ''), open($t('Open another file')), stop()],
    error: () => [
      btn($t('Try again'), () => Sync.reconnect(), 'primary'),
      btn($t('Replace its content with this browser’s plans'), () => Sync.overwrite(), 'danger'),
      saveNew($t('Save to a new file'), ''),
      stop(),
    ],
  }[status];
  return list ? h('div', { class: 'acts', style: 'margin-top:12px' }, list()) : null;
}

function fileCard() {
  const db = Store.db;
  const status = Sync.status;
  const title = $t('Data file');
  if (status === 'unsupported') {
    return card(
      title,
      null,
      null,
      note(
        'info',
        'info',
        $t(
          'This browser cannot save to a file you choose. Chrome, Edge and Opera on a computer can. Your plans are kept in this browser; export a backup to keep a copy or move them.',
        ),
      ),
    );
  }
  const on = status !== 'off';
  const [label, tone] = (STATUS[status] || (() => ['', '']))();
  const body = [
    option(
      $t('Save to a file you choose'),
      $t(
        'Your plans are kept in one JSON file, where you want it, and updated as you make changes. Put it in a synced folder (OneDrive, Dropbox, iCloud Drive, Syncthing) to use the same plans on another computer.',
      ),
      toggle('file-sync', $t('Save to a file you choose'), on, value => Sync.setEnabled(value)),
    ),
  ];
  if (on) {
    const by = Sync.savedBy && Sync.savedBy !== Sync.device ? $t('by another device') : $t('by this browser');
    body.push(
      h(
        'div',
        { class: 'rows', 'data-file-status': status },
        kv($t('File'), h('span', { class: 'amt', text: Sync.name || $t('Not chosen yet') })),
        kv($t('Status'), chip(label, tone)),
        Sync.savedAt && Sync.name ? kv($t('Last saved'), h('span', { text: `${when(Sync.savedAt)} · ${by}` })) : null,
      ),
      status === 'prompt'
        ? note(
            'warn',
            'alert',
            $t(
              'The browser asks again before Runway may use {0} on this visit. Until then, changes are saved in this browser and go to the file when you reconnect.',
              Sync.name,
            ),
          )
        : null,
      status === 'error' ? note('bad', 'alert', Sync.error) : null,
      actions(status),
      option(
        $t('Load changes from other devices'),
        $t(
          'Checks the file every few seconds while Runway is open, and when you come back to it, so changes saved on another computer or in another browser appear here.',
        ),
        toggle('file-watch', $t('Load changes from other devices'), db.fileWatch, value =>
          Store.setPref('fileWatch', value),
        ),
      ),
    );
  }
  body.push(
    h('p', {
      class: 'small muted',
      style: 'margin-top:10px',
      text: $t(
        'Runway can open and change only this one file. It never sees your folders or any other file, and the browser asks you before it lets Runway use it.',
      ),
    }),
  );
  return card(title, null, null, ...body);
}

/** How full the browser storage is (estimated against a typical 5 MB quota), with a warning from 70%. */
export function storageMeter() {
  const use = Store.storageUse();
  const percent = Math.min(100, Math.round(use.share * 100));
  const tone = percent >= 70 ? 'over' : 'good';
  return h(
    'div',
    { style: 'margin-top:12px' },
    h('div', {
      class: 'small ' + (percent >= 70 ? 'bad' : 'muted'),
      text:
        percent >= 70
          ? $t('Storage used: {0}% of about 5 MB. Export a backup and delete old plans or entries.', percent)
          : $t('Storage used: {0}% of about 5 MB.', Math.max(1, percent)),
    }),
    bar(Math.max(1, percent), tone),
  );
}

function browserCard() {
  const withFile = Sync.status !== 'unsupported' && Sync.status !== 'off';
  return card(
    $t('This browser'),
    withFile
      ? $t(
          'A copy of your plans is always kept in this browser, so Runway opens at once and keeps working when the file is out of reach.',
        )
      : $t(
          'Your plans are kept in this browser. Clearing its site data deletes them, so export a backup now and then.',
        ),
    null,
    storageMeter(),
  );
}

/** The cards of Settings › Storage. */
export function storageCards() {
  return [fileCard(), driveCard(), qrCard(), browserCard()];
}
