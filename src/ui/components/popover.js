/**
 * @file Popovers and context menus. Only one is open at a time; closePop() removes it and its outside-click listener.
 */
import { clamp } from '../../core/util.js';
import { h } from '../dom.js';

/* --- 6.3 pickers (month and day) --- */
export let POP = null;
const popOutside = e => {
  if (POP && !POP.contains(e.target) && !POP.anchor.contains(e.target)) {
    closePop();
  }
};
export function closePop() {
  if (POP) {
    POP.remove();
    POP = null;
    document.removeEventListener('mousedown', popOutside, true);
  }
}
/** Right-click menu for list rows. items: [label, fn, cssClass] */
export function ctxMenu(e, items) {
  e.preventDefault();
  closePop();
  const pop = h(
    'div',
    { class: 'mpop menu', role: 'menu' },
    items.filter(Boolean).map(([l, fn, className]) =>
      h('button', {
        type: 'button',
        role: 'menuitem',
        class: className || '',
        text: l,
        onclick: () => {
          closePop();
          fn();
        },
      }),
    ),
  );
  pop.anchor = pop;
  (e.target.closest('dialog') || document.body).append(pop);
  pop.style.left = clamp(e.clientX, 8, Math.max(8, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = clamp(e.clientY, 8, Math.max(8, innerHeight - pop.offsetHeight - 8)) + 'px';
  POP = pop;
  document.addEventListener('mousedown', popOutside, true);
}
export function popover(anchor, label, setup) {
  closePop();
  const pop = h('div', { class: 'mpop', role: 'dialog', 'aria-label': label });
  pop.anchor = anchor;
  setup(pop);
  (anchor.closest('dialog') || document.body).append(pop);
  const r = anchor.getBoundingClientRect();
  const ph = pop.offsetHeight;
  pop.style.top = (r.bottom + 6 + ph > innerHeight - 8 ? Math.max(8, r.top - ph - 6) : r.bottom + 6) + 'px';
  pop.style.left = clamp(r.left, 8, Math.max(8, innerWidth - pop.offsetWidth - 8)) + 'px';
  POP = pop;
  document.addEventListener('mousedown', popOutside, true);
}
