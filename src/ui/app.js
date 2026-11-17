/**
 * @file The application shell: navigation, routing between views, rendering.
 */
import { APP } from '../config.js';
import { D } from '../core/dates.js';
import { $t } from '../core/i18n.js';
import { Sync } from '../state/fileSync.js';
import { Store } from '../state/store.js';
import { POP, closePop } from './components/popover.js';
import { $, h, sv } from './dom.js';
import { icon } from './icons.js';
import { themeColor } from './pwa.js';
import { searchModal } from './modals/search.js';
import { UI } from './state.js';
import { FTABS } from './views/forecast.js';
import { langPicker } from './views/language.js';
import { V } from './views/registry.js';
import { syncIcon } from './views/syncSettings.js';
import { STABS } from './views/settings.js';
import { TOOLS } from './views/tools.js';

/* --- 6.10 shell --- */
/** The menu, in groups. A view with sub-sections lists them under itself while it is open. */
const NAV = [
  [
    '',
    [
      ['overview', $t('Overview'), 'home'],
      ['months', $t('Month planner'), 'calendar'],
      ['forecast', $t('Forecast'), 'table'],
      ['review', $t('Review'), 'chart'],
      ['audit', $t('Audit'), 'check'],
    ],
  ],
  [
    $t('Money'),
    [
      ['accounts', $t('Accounts'), 'bank'],
      ['recurring', $t('Income and bills'), 'repeat'],
      ['subs', $t('Subscriptions'), 'list'],
      ['items', $t('Transactions'), 'tag'],
    ],
  ],
  [
    $t('Plans and goals'),
    [
      ['trips', $t('Trips and events'), 'plane'],
      ['wishes', $t('Wishlist'), 'star'],
      ['goals', $t('Savings goals'), 'target'],
      ['loans', $t('Loans'), 'copy'],
    ],
  ],
  [
    $t('More'),
    [
      ['tools', $t('Tools'), 'clock'],
      ['settings', $t('Settings'), 'gear'],
    ],
  ],
];
const NAV_ALL = NAV.flatMap(g => g[1]);
/**
 * Where the changes went, at the foot of the menu: the browser storage and, when it is on, the data file
 * (state/fileSync.js). When something needs the person (permission for the file, no file chosen, an error) it is a
 * button that leads there.
 */
function saveState() {
  const file = Sync.name;
  const toStorage = () => App.go('settings', { stab: 'storage' });
  const badge = (text, title, tone, onclick) =>
    h(
      onclick ? 'button' : 'div',
      { type: onclick ? 'button' : null, class: 'save-state' + (tone ? ' ' + tone : ''), title, onclick },
      h('i'),
      h('span', { text }),
    );
  const status = Sync.status;
  if (status === 'ok') {
    return badge($t('Saved'), $t('Every change is saved to {0} and in this browser.', file), '', toStorage);
  }
  if (!Store.saveOk) {
    return badge(
      $t('Not saved!'),
      $t('This browser is blocking storage (private mode?). Export a backup to keep your changes.'),
      'err',
      toStorage,
    );
  }
  if (status === 'prompt') {
    return badge(
      $t('Reconnect file'),
      $t('Runway needs your OK to keep saving to {0}. Until then, changes are saved in this browser.', file),
      'warn',
      () => Sync.reconnect(),
    );
  }
  if (status === 'unlinked') {
    return badge(
      $t('Choose a file'),
      $t('Changes are saved in this browser only. Choose where to keep your data file.'),
      'warn',
      toStorage,
    );
  }
  if (status === 'error') {
    return badge($t('File not saved'), Sync.error, 'err', toStorage);
  }
  return badge($t('Saved'), $t('Every change is saved in this browser straight away.'));
}
const SUBS = { settings: () => [STABS, 'stab'], tools: () => [TOOLS, 'ttab'], forecast: () => [FTABS, 'ftab'] };
function renderSide() {
  const db = Store.db;
  const toStorage = () => App.go('settings', { stab: 'storage' });
  const plans = Object.values(db.plans);
  const current = NAV_ALL.find(n => n[0] === UI.view);
  const logo = () =>
    sv(
      'svg',
      { viewBox: '0 0 32 32', 'aria-hidden': 'true' },
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
  // the logo is the way home, as on any site
  const home = () =>
    h(
      'button',
      {
        type: 'button',
        class: 'logobtn',
        'aria-label': $t('Go to the overview'),
        title: $t('Overview'),
        onclick: () => App.go('overview'),
      },
      logo(),
    );
  const pick =
    plans.length > 1
      ? h(
          'select',
          {
            class: 'inp plan-pick',
            'aria-label': $t('Plan'),
            onchange: e => {
              UI.month = null;
              Store.switchTo(e.target.value);
            },
          },
          plans.map(p => h('option', { value: p.id, text: p.name, selected: p.id === db.active })),
        )
      : h('div', { class: 'plan-name', text: Store.plan.name });
  const undo = () =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn ghost icon',
        'aria-label': $t('Undo'),
        title: $t('Undo (Ctrl+Z)'),
        disabled: !Store.undoS.length,
        onclick: () => Store.undo(),
      },
      icon('undo'),
    );
  const redo = () =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn ghost icon',
        'aria-label': $t('Redo'),
        title: $t('Redo (Ctrl+Y)'),
        disabled: !Store.redoS.length,
        onclick: () => Store.redo(),
      },
      icon('redo'),
    );
  const item = n => {
    const hasSub = !!SUBS[n[0]] && UI.view === n[0];
    const sub = hasSub && !UI.subClosed ? SUBS[n[0]]() : null;
    return [
      h(
        'button',
        {
          type: 'button',
          class: 'navi',
          'data-view': n[0],
          'aria-current': UI.view === n[0] ? 'page' : null,
          'aria-expanded': hasSub ? String(!UI.subClosed) : null,
          title: n[1],
          onclick: () => (hasSub ? App.toggleSub() : App.go(n[0])),
        },
        icon(n[2]),
        h('span', { text: n[1] }),
      ),
      sub
        ? h(
            'div',
            { class: 'subitems' },
            sub[0].map((t, i) =>
              h(
                'button',
                {
                  type: 'button',
                  'aria-current': (UI[sub[1]] || sub[0][0][0]) === t[0] ? 'true' : null,
                  onclick: () => App.go(n[0], { [sub[1]]: t[0] }),
                },
                h('span', { text: t[1] }),
              ),
            ),
          )
        : null,
    ];
  };
  $('#side').replaceChildren(
    h(
      'div',
      { class: 'brand' },
      home(),
      h('div', { class: 'grow' }, h('span', { class: 'bname', text: APP.name }), pick),
      h(
        'button',
        {
          type: 'button',
          class: 'btn ghost icon navx',
          'aria-label': $t('Close menu'),
          onclick: () => App.menu(false),
        },
        icon('x'),
      ),
    ),
    h(
      'button',
      { type: 'button', class: 'searchbtn', title: $t('Search your plan (Ctrl K)'), onclick: searchModal },
      icon('list'),
      h('span', { class: 'grow', text: $t('Search…') }),
      h('kbd', { text: /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K' }),
    ),
    h(
      'nav',
      { class: 'nav', 'aria-label': $t('Sections') },
      NAV.map(g => h('div', { class: 'navg' }, g[0] ? h('div', { class: 'navh', text: g[0] }) : null, g[1].map(item))),
    ),
    h('div', { class: 'side-foot' }, langPicker(), saveState(), syncIcon(toStorage), undo(), redo()),
  );
  // phone and tablet: a top bar with the menu button; the side menu becomes a drawer
  $('#top').replaceChildren(
    h(
      'button',
      {
        type: 'button',
        class: 'btn ghost icon',
        'aria-label': $t('Open menu'),
        'aria-expanded': String(document.body.classList.contains('nav-open')),
        onclick: () => App.menu(true),
      },
      icon('menu'),
    ),
    home(),
    h('b', { text: current ? current[1] : APP.name }),
    h('span', { class: 'grow' }),
    ...[syncIcon(toStorage)].filter(Boolean), // none while Drive sync is off
    undo(),
    redo(),
  );
}
export const App = {
  render() {
    if (POP && !POP.closest('dialog')) {
      closePop();
    }
    const t = Store.db.theme;
    document.documentElement.dataset.theme =
      t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
    themeColor(document.documentElement.dataset.theme);
    $('#toasts').className = 'pos-' + Store.db.toastPos;
    const main = $('#main');
    const plan = Store.plan;
    const view = plan ? (V[UI.view] ? UI.view : 'overview') : 'welcome';
    const same = main.dataset.view === view;
    const y = scrollY;
    $('#app').classList.toggle('bare', !plan);
    if (plan) {
      renderSide();
    }
    // A bug in one view must not blank the whole app: show what went wrong and keep the menu usable.
    let content;
    try {
      content = V[view]();
    } catch (error) {
      console.error(error);
      content = h(
        'section',
        { class: 'card' },
        h('h2', { text: $t('This page could not be shown') }),
        h('p', {
          class: 'muted',
          text: $t(
            'Your data is safe. Open another page, or export a backup in Settings. Details: {0}',
            String(error && error.message),
          ),
        }),
      );
    }
    main.replaceChildren(...[content].flat(Infinity).filter(Boolean));
    main.dataset.view = view;
    scrollTo(0, same ? y : 0);
  },
  /**
   * The data file's status changed (state/fileSync.js): the badge in the menu is drawn again, not the whole page,
   * unless the page shows the status itself (Settings, the welcome screen).
   */
  fileStatus() {
    if (!Store.plan || UI.view === 'settings') {
      App.render();
    } else {
      renderSide();
    }
  },
  /** Fold or unfold the sub-sections of the open menu item. */
  toggleSub() {
    UI.subClosed = !UI.subClosed;
    App.render();
  },
  go(view, o) {
    if (view !== UI.view) {
      UI.design = null;
    }
    Object.assign(UI, o || {});
    UI.view = view;
    UI.subClosed = false;
    App.menu(false, true);
    App.render();
  },
  menu(open, quiet) {
    document.body.classList.toggle('nav-open', !!open);
    if (!quiet) {
      renderSide();
    }
  },
  /** The overview and "this month" follow the real date: when the day changes, everything is recomputed. */
  tick() {
    if (D.today() !== Store.day && !document.querySelector('dialog[open]')) {
      Store.recalc();
      App.render();
    }
  },
};
