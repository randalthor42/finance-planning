/**
 * @file Entry point: loads the styles and every view, wires the global events, then starts the app.
 */
import './styles/main.css';
import { readTexts } from 'virtual:i18n-keys';
import { APP } from './config.js';
import { $t, I18N } from './core/i18n.js';
import { deviceId } from './services/storage.js';
import { Drive, DRIVE } from './state/driveSync.js';
import { Sync } from './state/fileSync.js';
import { Store } from './state/store.js';
import { App } from './ui/app.js';
import { POP, closePop } from './ui/components/popover.js';
import { toast } from './ui/components/toast.js';
import { searchModal } from './ui/modals/search.js';
import { $ } from './ui/dom.js';
import { startPwa } from './ui/pwa.js';
import { UI, selK } from './ui/state.js';
import './ui/views/index.js';
import { expose } from './debug.js';

// every translatable text in the source, collected at build time (used by "Export language"), read when needed
I18N.source = readTexts;
if (import.meta.env.MODE === 'test') {
  expose();
} // browser tests reach into the app; the normal build drops this

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && POP && !document.querySelector('dialog[open]')) {
    return closePop();
  }
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'k') {
    e.preventDefault();
    if (!document.querySelector('dialog[open]')) {
      searchModal();
    }
    return;
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    (key === 'z' || key === 'y') &&
    !document.querySelector('dialog[open]') &&
    !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
  ) {
    e.preventDefault();
    key === 'y' || e.shiftKey ? Store.redo() : Store.undo();
    return;
  }
  // ← / → change month in the month planner (not while typing, in a pop-up, with a modifier key, or when a control
  // such as the calendar grid already used the key to move between days)
  if (
    (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
    !e.defaultPrevented &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.shiftKey &&
    UI.view === 'months' &&
    Store.plan &&
    !document.querySelector('dialog[open]') &&
    !POP &&
    !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) &&
    !e.target.isContentEditable
  ) {
    const summary = Store.proj.summary;
    const next = selK() + (e.key === 'ArrowLeft' ? -1 : 1);
    if (next >= summary.s0 && next < summary.s0 + summary.n) {
      e.preventDefault();
      App.go('months', { month: next });
    }
  }
});
addEventListener('storage', e => {
  if (e.key === APP.key) {
    Store.undoS = [];
    Store.undoChars = 0;
    Store.redoS = [];
    Store.init();
    cleanWhenIdle();
    Sync.refresh(); // the data file switch may have been changed in the other tab
    // Design mode may have been turned off in the other tab: then no page stays half in it here
    if (!Store.db.designMode) {
      UI.design = null;
    }
    App.render();
  }
  if (e.key === DRIVE.stateKey) {
    Drive.reload(); // sync turned on or off in another tab
  }
}); // another tab changed the data
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => App.render());
addEventListener('resize', closePop);
$('#scrim').addEventListener('click', () => App.menu(false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Store.flush(); // saves are coalesced (Store.save): write before the tab may be closed or frozen
    Sync.leave(); // and the data file, without waiting for its short delay
    Drive.leave(); // and Google Drive, if changes wait for their short delay
  } else {
    App.tick();
    Sync.check(); // back from another app or device: load what was saved to the data file meanwhile
    Drive.visible(); // and what was synced to Google Drive
  }
});
// Google Drive sync follows the connection: changes made offline wait, and go when it is back
addEventListener('online', () => Drive.online());
addEventListener('offline', () => Drive.offline());
addEventListener('focus', () => {
  Sync.check();
  Drive.visible();
});
addEventListener('pagehide', () => {
  Store.flush();
  Sync.leave();
  Drive.leave();
});
setInterval(() => App.tick(), 60000);
// while Runway stays open and shown, what other devices synced to Google Drive appears within a minute
setInterval(() => !document.hidden && Drive.visible(), DRIVE.poll);
Store.onChange = () => App.render();
Store.onNotify = (text, o) => toast(text, o);
// the data file: only a change of its status redraws the page, not each save
Sync.onChange = () => App.fileStatus();
Sync.onNotify = (text, o) => toast(text, o);
Sync.visible = () => !document.hidden; // no looking for changes while the page is hidden
// Google Drive sync (state/driveSync.js): like the data file, its status redraws only the icon, not the page
Drive.onChange = () => App.fileStatus();
Drive.onNotify = (text, o) => toast(text, o);
/** Plans other than the open one are cleaned (normPlan) in quiet moments after the first paint, one per moment. */
function cleanWhenIdle() {
  const later = window.requestIdleCallback || (fn => setTimeout(fn, 200));
  const next = () => {
    const [id] = Store.pending;
    if (id !== undefined) {
      Store.cleanPlan(id);
      later(next, { timeout: 3000 });
    }
  };
  later(next, { timeout: 3000 });
}
// work that can wait (the IndexedDB record index) runs when the browser is idle
Store.later = fn => (window.requestIdleCallback || (f => setTimeout(f, 1000)))(() => fn(), { timeout: 5000 });
Store.init();
App.render();
cleanWhenIdle();
// this device's id (made on the first launch), and the record index brought up to date, after the first paint
deviceId().then(id => {
  Store.deviceId = id;
});
Store.later(() => Store.reindex());
Sync.start(); // after the first paint: finds the remembered file and catches up with it
Drive.start(); // the same for Google Drive, in the background: the page never waits for the network
// installable app: manifest and service worker, over http(s) only (a page opened as a file skips both, silently)
startPwa();

// Last line of defence: an error in an event handler or a promise shows a readable message instead of failing silently.
/**
 * Browser messages that are not errors of the app. "ResizeObserver loop …" only says some size reports were moved to
 * the next frame (Chrome and Firefox word it differently); nothing failed and no data is involved.
 */
const HARMLESS = /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/;
const reportError = error => {
  const message = String((error && error.message) || error || '');
  if (HARMLESS.test(message)) {
    return;
  }
  console.error(error);
  toast($t('Something went wrong: {0}. Your data is safe.', String((error && error.message) || error)), {
    kind: 'bad',
  });
};
addEventListener('error', event => reportError(event.error || event.message));
addEventListener('unhandledrejection', event => reportError(event.reason));
