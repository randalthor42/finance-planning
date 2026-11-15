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
  }
});
addEventListener('storage', e => {
  if (e.key === APP.key) {
    Store.undoS = [];
    Store.redoS = [];
    Store.init();
    App.render();
  }
}); // another tab changed the data
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => App.render());
addEventListener('resize', closePop);
$('#scrim').addEventListener('click', () => App.menu(false));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    App.tick();
  }
});
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
