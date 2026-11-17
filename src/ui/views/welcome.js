/**
 * @file First screen when there is no plan yet.
 */
import { $t } from '../../core/i18n.js';
import { samplePlan } from '../../models/samplePlan.js';
import { Drive } from '../../state/driveSync.js';
import { Sync } from '../../state/fileSync.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { h } from '../dom.js';
import { importFlow } from '../modals/backup.js';
import { qrReceiveModal } from '../modals/qrTransfer.js';
import { newPlanModal } from '../modals/settings.js';
import { V } from './registry.js';
import { driveUnavailable, turnOnButton } from './syncSettings.js';

V.welcome = () =>
  h(
    'div',
    { class: 'welcome' },
    h('h1', { text: $t('Plan your money, month by month.') }),
    h('p', {
      class: 'muted',
      style: 'margin-bottom:18px',
      text: $t(
        'See what every bill, trip and purchase does to the months ahead. Private: your data stays on your devices unless you choose to sync it.',
      ),
    }),
    h(
      'div',
      { class: 'card' },
      h('h2', { text: $t('Start your own plan') }),
      h('p', {
        class: 'muted',
        style: 'margin:6px 0 12px',
        text: $t('Takes about two minutes. Income and bills can come later.'),
      }),
      btn($t('Create my plan'), newPlanModal, 'primary', 'plus'),
    ),
    h(
      'div',
      { class: 'acts', style: 'margin-top:14px' },
      btn(
        $t('Look around with a sample plan'),
        () => {
          Store.addPlan(samplePlan());
          App.go('overview');
        },
        'ghost',
      ),
      btn($t('Import a backup'), importFlow, 'ghost', 'upload'),
    ),
    // another device already has the plans: open its data file (a synced folder), sync with Google Drive, or take
    // them over with QR codes
    h(
      'div',
      { class: 'card', style: 'margin-top:14px' },
      h('h2', { text: $t('Already use Runway on another device?') }),
      h('p', {
        class: 'muted',
        style: 'margin:6px 0 12px',
        text: Drive.enabled
          ? $t('Syncing with Google Drive: your plans appear here in a moment.')
          : $t(
              'Bring your plans here: from its data file (for example in a synced folder), with Google Drive, or with QR codes.',
            ),
      }),
      h(
        'div',
        { class: 'acts' },
        Sync.status === 'unsupported' ? null : btn($t('Open a data file'), () => Sync.linkOpen(), '', 'upload'),
        driveUnavailable() || Drive.enabled ? null : turnOnButton($t('Sync with Google Drive'), ''),
        btn($t('Receive with QR codes'), qrReceiveModal, '', 'camera'),
      ),
    ),
  );
