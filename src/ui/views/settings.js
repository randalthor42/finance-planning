/**
 * @file Settings page: plan, look and behaviour, data, languages, activity log.
 */
import { APP } from '../../config.js';
import { D, M } from '../../core/dates.js';
import { FMT, money } from '../../core/format.js';
import { $t, ordinal, plural } from '../../core/i18n.js';
import { samplePlan } from '../../models/samplePlan.js';
import { Drive } from '../../state/driveSync.js';
import { Sync } from '../../state/fileSync.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { info } from '../components/info.js';
import { card, chip, page, row, segc } from '../components/layout.js';
import { designPages } from '../components/designPages.js';
import { confirmModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';
import { exportModal, importFlow } from '../modals/backup.js';
import { newPlanModal, renamePlanModal, rollModal, settingsModal } from '../modals/settings.js';
import { UI, curK, monthAt } from '../state.js';
import { calendarSettingsCards } from './calendarSettings.js';
import { languageCard } from './language.js';
import { storageCards } from './storageSettings.js';
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
/** Settings sections with one card per row, all as wide as the widest (settings-cols.one), on wide screens too. */
const ONE_COLUMN = new Set(['look', 'language', 'storage', 'backup']);
export const STABS = [
  ['general', $t('This plan')],
  ['plans', $t('All plans')],
  ['look', $t('Appearance')],
  ['calendar', $t('Calendar')],
  ['language', $t('Language')],
  ['storage', $t('Storage')],
  ['backup', $t('Backup')],
  ['activity', $t('Activity')],
];
/** "on the 26th, or the next working day": when the salary arrives, as one translatable sentence. */
function paydayText(settings) {
  const day = ordinal(settings.payDay);
  if (settings.payShift === 'next') {
    return $t('on the {0}, or the next working day', day);
  }
  if (settings.payShift === 'prev') {
    return $t('on the {0}, or the working day before', day);
  }
  return $t('on the {0}', day);
}

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
  const design = h('input', {
    type: 'checkbox',
    checked: db.designMode,
    'aria-label': $t('Design mode'),
    onchange: () => {
      // turning it off also ends Design mode, so no page is left half-arranged
      if (!design.checked) {
        UI.design = null;
      }
      Store.setPref('designMode', design.checked);
    },
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
          kv($t('Starting balance'), money(settings.opening)),
          kv($t('Safety cushion'), settings.cushion ? money(settings.cushion) : $t('Not set')),
          kv($t('Salary arrives'), settings.payDay ? paydayText(settings) : $t('Not set (calendar months)')),
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
        $t('Appearance'),
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
          // only when some page offers it (components/designPages.js); which ones is not spelled out, so new pages
          // can offer it without this text going out of date
          designPages().length
            ? opt(
                $t('Design mode'),
                $t(
                  'Show the Design mode switch on pages whose cards can be arranged, to move the cards and change their size. Layouts you made stay as they are when it is off.',
                ),
                h('label', { class: 'switch' }, design),
              )
            : null,
        ),
      ),
      card(
        $t('Shortcuts'),
        null,
        null,
        h(
          'div',
          { class: 'rows' },
          kv($t('Search'), $t('Ctrl + K')),
          kv($t('Undo'), $t('Ctrl + Z')),
          kv($t('Redo'), $t('Ctrl + Y  or  Ctrl + Shift + Z')),
          kv($t('Reorder a row'), $t('drag the dots, or focus them and use ↑ ↓')),
          kv($t('Delete or copy a row'), $t('right-click it, or use its bin icon')),
          kv($t('Add amounts'), $t('type 120+35 in any amount box')),
        ),
      ),
    ],
    language: languageCard,
    calendar: calendarSettingsCards,
    storage: storageCards,
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
                      !Store.addPlan(
                        { ...JSON.parse(JSON.stringify(x)), id: null, name: $t('{0} copy', x.name) },
                        false,
                      )
                    ) {
                      toast($t('Plan limit reached'), { kind: 'bad' });
                    }
                    App.render();
                  },
                  'sm ghost',
                  'copy',
                ),
                ibtn($t('Rename plan'), () => renamePlanModal(x.id), 'sm ghost', 'edit'),
                ibtn(
                  $t('Delete plan'),
                  () =>
                    confirmModal(
                      $t('Delete “{0}”?', x.name),
                      Sync.status === 'ok'
                        ? $t(
                            'This removes the plan and everything in it from this browser and from {0}. Export a backup first if you might want it back.',
                            Sync.name,
                          )
                        : Drive.enabled
                          ? $t(
                              'This removes the plan and everything in it from this browser and, through Google Drive sync, from your other devices. Export a backup first if you might want it back.',
                            )
                          : $t(
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
            text: $t('New plan'),
            onclick: newPlanModal,
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
        $t('Backup'),
        Sync.status === 'ok'
          ? $t(
              'Your plans are saved in {0} and in this browser. Export a backup to keep a copy somewhere else.',
              Sync.name,
            )
          : $t('Your data lives in this browser. Export a backup to keep it safe or move it to another device.'),
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
            'Importing shows first what it would change: merge it with your plans (the newest version of each entry is kept), or add its plans as separate copies. Clearing this browser’s site data deletes your plans, so export now and then.',
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
            'Runway works offline. Nothing you type leaves this device unless you export it, save it to a file you choose, send it with QR codes, or turn on Google Drive sync (Settings › Storage), which keeps a copy in your own Google Drive. Apart from Google’s sign-in and Drive while sync is on, the page cannot contact any other site.',
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
                Sync.name
                  ? $t(
                      'Every plan stored in this browser will be removed. This cannot be undone. {0} is disconnected and left as it is.',
                      Sync.name,
                    )
                  : Drive.enabled
                    ? $t(
                        'Every plan stored in this browser will be removed. This cannot be undone. Google Drive sync is turned off here; your cloud copy is left as it is.',
                      )
                    : $t('Every plan stored in this browser will be removed. This cannot be undone.'),
                $t('Delete everything'),
                () => {
                  UI.view = 'overview';
                  // the data file and Drive sync are let go first, so that emptying this browser does not empty them
                  // (and Drive sync does not bring the plans back)
                  Sync.unlink();
                  Drive.turnOff();
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
    // one column on narrow screens; on wide ones the cards of a section sit in two columns (settings-cols), except
    // the sections listed in ONE_COLUMN, where each card takes a whole row
    h('div', { class: 'settings-cols' + (ONE_COLUMN.has(tab) ? ' one' : '') }, pages[tab]()),
  );
};
