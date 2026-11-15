/**
 * @file Short notifications (toasts) shown in a corner of the screen.
 */
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
    h('span', { text }),
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
  setTimeout(() => t.remove(), o.undo ? 7000 : 3600);
}
