/**
 * @file Entry point: loads the styles and every view, wires the global events, then starts the app.
 */
import './styles/main.css';
import { KEYS, WORDS } from 'virtual:i18n-keys';
import { APP } from './config.js';
import { $t, I18N } from './core/i18n.js';
import { Store } from './state/store.js';
import { App } from './ui/app.js';
import { POP, closePop } from './ui/components/popover.js';
import { toast } from './ui/components/toast.js';
import { searchModal } from './ui/modals/search.js';
import { $ } from './ui/dom.js';
import { UI, selK } from './ui/state.js';
import './ui/views/index.js';
import { expose } from './debug.js';

// every translatable text in the source, collected at build time (used by "Export language")
I18N.KEYS = KEYS;
I18N.WORDS = WORDS;
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
    App.render();
  }
}); // another tab changed the data
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => App.render());
addEventListener('resize', closePop);
$('#scrim').addEventListener('click', () => App.menu(false));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    Store.flush(); // saves are coalesced (Store.save): write before the tab may be closed or frozen
  } else {
    App.tick();
  }
});
addEventListener('pagehide', () => Store.flush());
setInterval(() => App.tick(), 60000);
Store.onChange = () => App.render();
Store.onNotify = (text, o) => toast(text, o);
Store.init();
App.render();

// Last line of defence: an error in an event handler or a promise shows a readable message instead of failing silently.
const reportError = error => {
  console.error(error);
  toast($t('Something went wrong: {0}. Your data is safe.', String((error && error.message) || error)), {
    kind: 'bad',
  });
};
addEventListener('error', event => reportError(event.error || event.message));
addEventListener('unhandledrejection', event => reportError(event.reason));
