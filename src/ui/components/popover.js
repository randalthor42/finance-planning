/**
 * @file Popovers and context menus. Only one is open at a time; closePop() removes it and its outside-click listener.
 * While one is open nothing behind it scrolls (wheel, touch, keys, the scroll bar): the pop-up is placed where it was
 * opened and would otherwise float away from what it belongs to. A list inside the pop-up still scrolls.
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
    lockScroll(false);
  }
}
/** Keys that scroll the page when the focus is not in a text box. */
const SCROLL_KEYS = new Set([
  ' ',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
/** True when a wheel or touch over `target` can scroll something inside the open pop-up (a long menu, a list). */
function scrollsInPop(target) {
  for (let el = target instanceof Element ? target : null; el && POP && POP.contains(el); el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      return true;
    }
  }
  return false;
}
const stopScroll = e => {
  if (!scrollsInPop(e.target)) {
    e.preventDefault();
  }
};
const stopKeys = e => {
  const target = e.target instanceof Element ? e.target : null;
  const typing = target && target.closest('input, textarea, select, [contenteditable]');
  if (SCROLL_KEYS.has(e.key) && !typing && !(target && POP && POP.contains(target))) {
    e.preventDefault();
  }
};
const LOCK = { passive: false, capture: true };
/** Stops (or lets again) every way of scrolling the page and the panels behind the open pop-up. */
function lockScroll(on) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  document[method]('wheel', stopScroll, LOCK);
  document[method]('touchmove', stopScroll, LOCK);
  document[method]('keydown', stopKeys, true);
  // the scroll bar of the page cannot be dragged either; its gutter stays so nothing shifts
  document.documentElement.classList.toggle('pop-lock', on);
}
/**
 * Right-click menu for list rows. items: [label, fn, cssClass]; null is skipped.
 * A plain string is a section title over the items that follow, and '-' is a dividing line.
 */
export function ctxMenu(e, items) {
  e.preventDefault();
  closePop();
  const pop = h('div', { class: 'mpop menu', role: 'menu' }, items.filter(Boolean).map(menuEntry));
  finishMenu(e, pop);
}
/** One entry of a menu: a dividing line ('-'), a section title (a string), or an item ([label, action, class]). */
function menuEntry(item) {
  if (item === '-') {
    return h('hr', { class: 'menu-sep', role: 'separator' });
  }
  if (typeof item === 'string') {
    return h('div', { class: 'menu-h', role: 'presentation', text: item });
  }
  return menuItem(item);
}
function menuItem([l, fn, className]) {
  return h('button', {
    type: 'button',
    role: 'menuitem',
    class: className || '',
    text: l,
    onclick: () => {
      closePop();
      fn();
    },
  });
}
/** Places a menu at the pointer (or under the control, from the keyboard) and makes it the open pop-up. */
function finishMenu(e, pop) {
  pop.anchor = pop;
  (e.target.closest('dialog') || document.body).append(pop);
  // Opened with the keyboard (Enter, Space, the menu key) the event has no pointer position: place it under the control.
  let x = e.clientX;
  let y = e.clientY;
  const owner = e.currentTarget instanceof Element ? e.currentTarget : e.target;
  if (e.detail === 0 && owner instanceof Element && !x && !y) {
    const rect = owner.getBoundingClientRect();
    x = rect.left;
    y = rect.bottom + 4;
  }
  pop.style.left = clamp(x, 8, Math.max(8, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = clamp(y, 8, Math.max(8, innerHeight - pop.offsetHeight - 8)) + 'px';
  const first = pop.querySelector('button');
  if (e.detail === 0 && first) {
    first.focus();
  }
  POP = pop;
  document.addEventListener('mousedown', popOutside, true);
  lockScroll(true);
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
  lockScroll(true);
}
