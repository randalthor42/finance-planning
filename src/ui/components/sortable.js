/**
 * @file Drag-to-reorder for lists of rows (pointer events, keyboard friendly grip).
 */
import { $t } from '../../core/i18n.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';

/* --- 6.5 drag to reorder (pointer events, so it works with mouse and touch; arrow keys on the handle also work) --- */
export const grip = () =>
  h(
    'button',
    {
      type: 'button',
      class: 'grip',
      'aria-label': $t('Drag to reorder, or use the arrow keys'),
      title: $t('Drag to reorder'),
      onclick: e => e.stopPropagation(),
    },
    icon('grip'),
  );
export function sortable(box, sel, onMove, key) {
  box.dataset.sort = key || '';
  box.addEventListener('pointerdown', e => {
    const g = e.target.closest('.grip');
    if (!g || !box.contains(g)) {
      return;
    }
    const row = g.closest(sel);
    const par = row && row.parentNode;
    if (!row) {
      return;
    }
    const all = () => [...par.children].filter(x => x.matches(sel));
    const from = all().indexOf(row);
    const grab = e.clientY - row.getBoundingClientRect().top;
    e.preventDefault();
    row.classList.add('drag');
    // the row follows the pointer; the other rows make room by really moving in the page
    const move = ev => {
      const others = all().filter(x => x !== row);
      let ref = null;
      for (const o of others) {
        const r = o.getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          ref = o;
          break;
        }
      }
      if (ref !== row.nextElementSibling || (ref === null && par.lastElementChild !== row)) {
        if (ref) {
          par.insertBefore(row, ref);
        } else {
          others.length ? others[others.length - 1].after(row) : 0;
        }
      }
      row.style.transform = '';
      row.style.transform = `translateY(${ev.clientY - grab - row.getBoundingClientRect().top}px)`;
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      row.style.transform = '';
      row.classList.remove('drag');
      const to = all().indexOf(row);
      if (to !== from) {
        onMove(from, to);
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
  box.addEventListener('keydown', e => {
    const g = e.target.closest && e.target.closest('.grip');
    if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const rows = [...box.querySelectorAll(sel)];
    const from = rows.indexOf(g.closest(sel));
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (to >= 0 && to < rows.length) {
      onMove(from, to);
      const again = box.isConnected ? box : document.querySelector(`[data-sort="${key}"]`);
      const r = again && again.querySelectorAll(sel)[to];
      if (r && r.querySelector('.grip')) {
        r.querySelector('.grip').focus();
      }
    }
  });
}
export const moveIn = (arr, from, to) => {
  arr.splice(to, 0, arr.splice(from, 1)[0]);
};
