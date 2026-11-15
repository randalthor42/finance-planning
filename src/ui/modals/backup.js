/**
 * @file Export window (plain or password-encrypted) and the import flow.
 */
import { $t, plural } from '../../core/i18n.js';
import { IO } from '../../services/backup.js';
import { Store } from '../../state/store.js';
import { formModal } from '../components/form.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';
import { UI } from '../state.js';

export function exportModal() {
  const many = Object.keys(Store.db.plans).length > 1;
  const can = IO.canEncrypt();
  formModal({
    title: $t('Export a backup'),
    saveLabel: $t('Download'),
    values: { scope: 'one', pw: '', pw2: '' },
    fields: [
      ...(many
        ? [
            {
              k: 'scope',
              type: 'seg',
              label: $t('What to export'),
              options: [
                ['one', $t('This plan')],
                ['all', $t('All plans')],
              ],
            },
          ]
        : []),
      ...(can
        ? [
            {
              k: 'pw',
              type: 'pass',
              max: 200,
              label: $t('Password (optional)'),
              hint: $t(
                'With a password the file is encrypted (AES-256). Use one if the file will sit in email or cloud storage. There is no way to recover a forgotten password.',
              ),
            },
            { k: 'pw2', type: 'pass', max: 200, label: $t('Repeat password') },
          ]
        : []),
    ],
    onSave: v => {
      if (v.pw && v.pw.length < 8) {
        return $t('Use at least 8 characters.');
      }
      if (v.pw && v.pw !== v.pw2) {
        return $t('The passwords do not match.');
      }
      const plans = v.scope === 'all' ? Object.values(Store.db.plans) : [Store.plan];
      const d = new Date().toISOString().slice(0, 10);
      IO.backup(plans, v.pw)
        .then(t => {
          IO.download(`runway-backup-${d}${v.pw ? '.encrypted' : ''}.json`, t);
          toast($t('Backup downloaded'));
        })
        .catch(() => toast($t('Could not create the backup')));
      return '';
    },
  });
}
export function importFlow() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  const finish = plans => {
    let first = null;
    let n = 0;
    for (const p of plans) {
      const c = Store.addPlan({ ...p, id: null }, false);
      if (c) {
        n++;
        first = first || c;
      }
    }
    if (first) {
      Store.switchTo(first.id);
      UI.month = null;
      toast($t('Imported {0}. Your other plans were not changed.', plural(n, 'plan')));
    } else {
      toast($t('Nothing imported: plan limit reached'), { kind: 'bad' });
    }
  };
  const run = async (text, password) => {
    try {
      const r = await IO.read(text, password);
      if (r.needsPassword) {
        formModal({
          title: $t('This backup is encrypted'),
          saveLabel: $t('Open'),
          values: { pw: '' },
          fields: [{ k: 'pw', type: 'pass', max: 200, label: $t('Password') }],
          onSave: v => (v.pw ? (run(text, v.pw), '') : $t('Enter the password.')),
        });
      } else {
        finish(r.plans);
      }
    } catch (e) {
      toast(e.message || $t('Could not read that file'), { kind: 'bad' });
    }
  };
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) {
      return;
    }
    if (f.size > IO.MAX_BYTES) {
      return toast($t('That file is too large to be a backup'));
    }
    f.text().then(t => run(t));
  });
  input.click();
}
