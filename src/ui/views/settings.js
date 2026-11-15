/**
 * @file Settings page: plan, look and behaviour, data, languages, activity log.
 */
import { APP } from '../../config.js';
import { D, M } from '../../core/dates.js';
import { FMT, money } from '../../core/format.js';
import { $t, ordinal, plural } from '../../core/i18n.js';
import { samplePlan } from '../../models/samplePlan.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { info } from '../components/info.js';
import { card, chip, page, row, segc } from '../components/layout.js';
import { confirmModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';
import { exportModal, importFlow } from '../modals/backup.js';
import { rollModal, settingsModal } from '../modals/settings.js';
import { UI, curK, monthAt } from '../state.js';
import { languageCard } from './language.js';
import { V } from './registry.js';

const logRow = e =>
  h(
    'div',
    { class: 'row' },
    h('span', { class: 'grow', text: e.text }),
    h('span', {
      class: 'd',
      text: (d =>
        isNaN(d)
          ? ''
          : d.toLocaleString(FMT.dloc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))(
        new Date(e.t),
      ),
    }),
  );
export const STABS = [
  ['general', $t('This plan')],
  ['plans', $t('All plans')],
  ['look', $t('Look and behaviour')],
  ['language', $t('Language')],
  ['backup', $t('Backup and transfer')],
  ['activity', $t('Activity')],
];
V.settings = () => {
  const plan = Store.plan;
  const settings = plan.settings;
  const db = Store.db;
  const plans = Object.values(db.plans);
  const tab = STABS.some(t => t[0] === UI.stab) ? UI.stab : 'general';
  const full = plans.length >= APP.maxPlans;
  const kv = (l, v) =>
    h('div', { class: 'row' }, h('span', { class: 'grow muted', text: l }), h('span', { class: 'amt', text: v }));
  const opt = (label, hint, control) =>
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
  const auto = h('input', {
    type: 'checkbox',
    checked: db.autosave,
    'aria-label': $t('Autosave'),
    onchange: () => Store.setPref('autosave', auto.checked),
  });
  const pages = {
    general: () => [
      card(
        $t('This plan'),
        null,
        btn($t('Edit'), settingsModal, 'primary sm', 'edit'),
        h(
          'div',
          { class: 'rows' },
          kv($t('Name'), plan.name),
          kv($t('First month'), M.label(M.parse(settings.startMonth), true)),
          kv($t('Months planned'), String(settings.horizon)),
          kv($t('Cash at the start'), money(settings.opening)),
          kv($t('Safety cushion'), settings.cushion ? money(settings.cushion) : $t('Not set')),
          kv(
            $t('Salary arrives'),
            settings.payDay
              ? $t('on the {0}', ordinal(settings.payDay)) +
                  (settings.payShift === 'next'
                    ? $t(', or the next working day')
                    : settings.payShift === 'prev'
                      ? $t(', or the working day before')
                      : '')
              : $t('Not set (calendar months)'),
          ),
          kv(
            $t('A month runs'),
            settings.payDay
              ? $t('{0} to {1} for {2}', D.label(monthAt(curK()).start), D.label(monthAt(curK()).end), M.label(curK()))
              : $t('the calendar month'),
          ),
          kv($t('Currency'), settings.currency),
          kv($t('Numbers'), settings.numFmt === 'us' ? '1,234.56' : '1.234,56'),
          kv($t('Dates'), settings.dateFmt === 'mdy' ? $t('Nov 26, 2026') : $t('26 Nov 2026')),
        ),
        h(
          'div',
          { class: 'acts', style: 'margin-top:12px' },
          btn($t('Roll forward to this month'), rollModal, 'sm'),
          info(
            $t(
              'Moves the first month of the plan to the current month and asks for your real balance. Use it when the first months of the plan are in the past.',
            ),
          ),
        ),
      ),
    ],
    look: () => [
      card(
        $t('Look and behaviour'),
        null,
        null,
        h(
          'div',
          { class: 'rows' },
          opt(
            $t('Theme'),
            null,
            segc(
              [
                ['auto', $t('Auto')],
                ['light', $t('Light')],
                ['dark', $t('Dark')],
              ],
              db.theme,
              v => Store.setPref('theme', v),
            ),
          ),
          opt(
            $t('Notifications'),
            $t('Where the short messages appear.'),
            segc(
              [
                ['tr', $t('Top right')],
                ['br', $t('Bottom right')],
                ['tl', $t('Top left')],
                ['bl', $t('Bottom left')],
              ],
              db.toastPos,
              v => {
                Store.setPref('toastPos', v);
                toast($t('Notifications appear here'));
              },
            ),
          ),
          opt(
            $t('Autosave'),
            $t('Save changes in pop-ups as you type, with no Save button.'),
            h('label', { class: 'switch' }, auto),
          ),
        ),
      ),
      card(
        $t('Shortcuts'),
        null,
        null,
        h(
          'div',
          { class: 'rows' },
          kv($t('Undo'), $t('Ctrl + Z')),
          kv($t('Redo'), $t('Ctrl + Y  or  Ctrl + Shift + Z')),
          kv($t('Reorder a row'), $t('drag the dots, or focus them and use ↑ ↓')),
          kv($t('Delete or copy a row'), $t('right-click it, or use its bin icon')),
          kv($t('Add amounts'), $t('type 120+35 in any amount box')),
        ),
      ),
    ],
    language: languageCard,
    plans: () => [
      card(
        $t('Plans'),
        $t('Keep separate plans, or copy one to try an idea, such as with and without a loan.'),
        null,
        h(
          'div',
          { class: 'rows' },
          plans.map(x =>
            row({
              title: x.name,
              chips: x.id === db.active ? chip($t('open'), 'acc') : null,
              desc: `${M.label(M.parse(x.settings.startMonth))} · ${plural(x.settings.horizon, 'month')}`,
              right: h(
                'div',
                { class: 'acts' },
                x.id !== db.active
                  ? btn(
                      $t('Open'),
                      () => {
                        UI.month = null;
                        Store.switchTo(x.id);
                      },
                      'sm',
                    )
                  : null,
                btn(
                  $t('Copy'),
                  () => {
                    if (
                      !Store.addPlan({ ...JSON.parse(JSON.stringify(x)), id: null, name: x.name + $t(' copy') }, false)
                    ) {
                      toast($t('Plan limit reached'), { kind: 'bad' });
                    }
                    App.render();
                  },
                  'sm ghost',
                  'copy',
                ),
                ibtn(
                  $t('Delete plan'),
                  () =>
                    confirmModal(
                      $t('Delete “{0}”?', x.name),
                      $t(
                        'This removes the plan and everything in it from this browser. Export a backup first if you might want it back.',
                      ),
                      $t('Delete plan'),
                      () => Store.removePlan(x.id),
                    ),
                  'sm ghost danger',
                  'trash',
                ),
              ),
            }),
          ),
        ),
        h(
          'div',
          { class: 'acts', style: 'margin-top:12px' },
          h('button', {
            type: 'button',
            class: 'btn sm',
            disabled: full,
            text: $t('New empty plan'),
            onclick: () => {
              UI.month = null;
              Store.addPlan({
                name: $t('New plan'),
                settings: {
                  currency: settings.currency,
                  numFmt: settings.numFmt,
                  dateFmt: settings.dateFmt,
                  payDay: settings.payDay,
                  payShift: settings.payShift,
                  payFor: settings.payFor,
                },
              });
            },
          }),
          h('button', {
            type: 'button',
            class: 'btn sm',
            disabled: full,
            text: $t('Add the sample plan'),
            onclick: () => {
              UI.month = null;
              Store.addPlan(samplePlan());
            },
          }),
        ),
      ),
    ],
    backup: () => [
      card(
        $t('Backup and transfer'),
        $t('Your data lives in this browser. Export a backup to keep it safe or move it to another device.'),
        null,
        h(
          'div',
          { class: 'acts' },
          btn($t('Export backup'), exportModal, 'primary', 'download'),
          btn($t('Import backup'), importFlow, '', 'upload'),
        ),
        h('p', {
          class: 'small muted',
          style: 'margin-top:10px',
          text: $t(
            'Importing adds the plans from the file next to the ones you have. It never overwrites anything. Clearing this browser’s site data deletes your plans, so export now and then.',
          ),
        }),
      ),
      card(
        $t('Privacy'),
        null,
        null,
        h('p', {
          class: 'muted small',
          text: $t(
            'This file works offline and is blocked from making any network request. Nothing you type leaves this device unless you export it yourself.',
          ),
        }),
        h(
          'div',
          { class: 'acts', style: 'margin-top:12px' },
          btn(
            $t('Delete everything'),
            () =>
              confirmModal(
                $t('Delete all plans?'),
                $t('Every plan stored in this browser will be removed. This cannot be undone.'),
                $t('Delete everything'),
                () => {
                  UI.view = 'overview';
                  Store.wipe();
                },
              ),
            'danger sm',
            'trash',
          ),
        ),
      ),
    ],
    activity: () => [
      card(
        $t('Activity'),
        $t('What changed in this browser, newest first. It is not part of exported backups.'),
        db.log.length ? btn($t('Clear'), () => Store.clearLog(), 'sm ghost') : null,
        db.log.length
          ? h('div', { class: 'rows', style: 'max-height:70vh;overflow:auto' }, db.log.slice().reverse().map(logRow))
          : h('p', { class: 'muted', text: $t('Nothing yet. Every change you make is listed here.') }),
      ),
    ],
  };
  return page(
    $t('Settings'),
    STABS.find(t => t[0] === tab)[1],
    null,
    h(
      'div',
      { class: 'subnav', role: 'tablist' },
      STABS.map(t =>
        h('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(t[0] === tab),
          text: t[1],
          onclick: () => App.go('settings', { stab: t[0] }),
        }),
      ),
    ),
    h('div', { class: 'stack', style: 'max-width:760px' }, pages[tab]()),
  );
};
