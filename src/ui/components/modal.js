/**
 * @file Modal windows built on <dialog>, the autosave helper used by editing windows, and the confirmation window.
 */
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { Store } from '../../state/store.js';
import { btn } from './button.js';
import { POP, closePop } from './popover.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';

/* --- 6.6 modals, forms, toasts --- */
export function modal({ title, body, foot, wide, onClose, guard, err }) {
  closePop();
  // Unsaved changes: a stray click outside, Esc or the X asks first instead of throwing the work away.
  const ask = () => {
    const c = modal({
      title: $t('Discard your changes?'),
      body: h('p', { class: 'muted', text: $t('This window has changes that are not saved yet.') }),
      foot: [
        h('span', { class: 'sp' }),
        btn($t('Keep editing'), () => c.close(), ''),
        btn(
          $t('Discard changes'),
          () => {
            c.close();
            d.close();
          },
          'danger',
        ),
      ],
    });
    c.classList.add('narrow');
  };
  const tryClose = () => (guard && guard() ? ask() : d.close());
  const d = h(
    'dialog',
    { class: 'modal' + (wide ? ' wide' : '') },
    h(
      'div',
      { class: 'modal-in' },
      h(
        'div',
        { class: 'modal-h' },
        h('h2', { text: title }),
        h(
          'button',
          { type: 'button', class: 'btn ghost icon', 'aria-label': $t('Close'), onclick: tryClose },
          icon('x'),
        ),
      ),
      h('div', { class: 'modal-b' }, body),
      err ? h('div', { class: 'modal-e' }, err) : null,
      foot ? h('div', { class: 'modal-f' }, foot) : null,
    ),
  );
  d.addEventListener('cancel', e => {
    if (POP) {
      e.preventDefault();
      closePop();
    } else if (guard && guard()) {
      e.preventDefault();
      ask();
    }
  });
  d.addEventListener('mousedown', e => {
    if (e.target === d) {
      tryClose();
    }
  });
  d.addEventListener('close', () => {
    closePop();
    if (onClose) {
      onClose();
    }
    d.remove();
  });
  document.body.append(d);
  d.showModal();
  return d;
}
/**
 * Autosave helper shared by every editing modal. When the "save as I type" setting is on, save() runs shortly after each change
 * and all of a modal's saves count as ONE undo step. When it is off, nothing is saved until the Save button.
 */
export function autosaver(save, allow = true, getState = null) {
  const tag = 'm' + uid();
  const on = allow && Store.db.autosave;
  let timer = null;
  let dirty = false;
  // "Changed" means the values differ from when the window opened (or was last saved), not that a field was clicked.
  // Clicking into an input or switching a tab inside the window touches the form without changing anything.
  const snapshot = () => (getState ? JSON.stringify(getState()) : null);
  let cleanState = snapshot();
  const reallyChanged = () => (getState ? snapshot() !== cleanState : true);
  const run = () => {
    clearTimeout(timer);
    timer = null;
    Store.tag = tag;
    try {
      const ok = save();
      if (ok) {
        dirty = false;
        cleanState = snapshot();
      }
      return ok;
    } finally {
      Store.tag = null;
    }
  };
  return {
    on,
    get dirty() {
      return dirty && !on && reallyChanged();
    },
    touch() {
      dirty = true;
      // with autosave on, nothing is saved (and no undo step is made) unless a value really changed
      if (on && reallyChanged()) {
        clearTimeout(timer);
        timer = setTimeout(run, 450);
      }
    },
    submit: run,
    flush() {
      if (on && timer) {
        run();
      }
    },
    discard() {
      clearTimeout(timer);
      timer = null;
      if (Store.lastTag === tag) {
        Store.undo();
      }
    },
    foot: () => (on ? h('span', { class: 'tiny muted', text: $t('Saves as you type') }) : null),
  };
}

/** A yes/no question. The yes button is red unless `yesClass` says otherwise (e.g. 'primary' for a harmless action). */
export function confirmModal(title, text, yes, fn, yesClass = 'danger') {
  const d = modal({
    title,
    body: h('p', { class: 'muted', text }),
    foot: [
      h('span', { class: 'sp' }),
      btn($t('Cancel'), () => d.close(), 'ghost'),
      btn(
        yes,
        () => {
          d.close();
          fn();
        },
        yesClass,
      ),
    ],
  });
}
