/**
 * @file Short notifications (toasts) shown in a corner of the screen.
 */
import { maskMoney } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { Store } from '../../state/store.js';
import { $, h } from '../dom.js';
import { icon } from '../icons.js';

/** Short notification that disappears on its own. Shown above pop-ups too. o.undo adds an Undo button; o.kind: 'undo' | 'bad'. */
export function toast(text, o) {
  o = o || {};
  const box = $('#toasts');
  const t = h(
    'div',
    { class: 'toast ' + (o.kind || ''), role: 'status' },
    icon(o.kind === 'undo' ? 'undo' : o.kind === 'bad' ? 'alert' : 'check'),
    // a toast says what was just done, amounts included: hidden amounts stay hidden in it too
    h('span', { text: maskMoney(text) }),
    o.undo
      ? h('button', {
          type: 'button',
          text: $t('Undo'),
          onclick: () => {
            t.remove();
            Store.undo();
          },
        })
      : null,
    h('button', { type: 'button', class: 'tx', 'aria-label': $t('Dismiss'), onclick: () => t.remove() }, '×'),
  );
  box.append(t);
  while (box.children.length > 4) {
    box.firstChild.remove();
  }
  try {
    if (box.showPopover) {
      if (box.matches(':popover-open')) {
        box.hidePopover();
      }
      box.showPopover();
    }
  } catch (x) {}
  autoDismiss(t, o.undo ? 7000 : 3600);
}
/** Removes a toast after `ms`. The countdown pauses while the pointer or keyboard focus is on it (time to read, or to reach Undo). */
function autoDismiss(toastBox, ms) {
  let remaining = ms;
  let startedAt = 0;
  let timer = 0;
  let running = false;
  const start = () => {
    if (running || toastBox.matches(':hover, :focus-within')) {
      return;
    }
    running = true;
    startedAt = Date.now();
    timer = setTimeout(() => toastBox.remove(), remaining);
  };
  const pause = () => {
    if (!running) {
      return;
    }
    running = false;
    clearTimeout(timer);
    remaining = Math.max(1200, remaining - (Date.now() - startedAt));
  };
  toastBox.addEventListener('mouseenter', pause);
  toastBox.addEventListener('focusin', pause);
  toastBox.addEventListener('mouseleave', start);
  toastBox.addEventListener('focusout', start);
  start();
}
