/**
 * @file Design mode: the cards of a page sit on a grid of 12 columns, and with "Design mode" ticked the person can
 * drag them anywhere and choose how many columns and rows each one takes, like widgets on a phone home screen.
 * The cards in the way move along to make room (the rules are in core/grid.js). The layout is a browser preference
 * (Store.db.layouts[page]), not plan data, so it is not in backups and not undone with Ctrl+Z.
 *
 * Any page can use it: designPage() in layout.js, or designToggle(key) for the checkbox and designGrid(key, cards).
 */
import { $t, plural } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import {
  GRID_COLS,
  GRID_MAX_H,
  arrange,
  arrangeOrdered,
  fitSize,
  nudge,
  place,
  resize,
  rowCount,
  sameLayout,
  snapDrop,
  toSaved,
} from '../../core/grid.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { UI } from '../state.js';
import { btn } from './button.js';
import { isDesignable, pageName } from './designPages.js';
import { confirmModal } from './modal.js';
import { closePop, popover } from './popover.js';

/**
 * One card of a design grid.
 * @typedef {object} GridCard
 * @property {string} id stable name, unique on the page, used to save its place (a letter, then letters, digits, - or _)
 * @property {string} title its name in Design mode and for screen readers
 * @property {Element|null} el the card, or null when it has nothing to show: its place stays free, and Design mode
 *   shows a stand-in so it can still be arranged
 * @property {number} [w] default width, in columns
 * @property {number} [h] default height, in rows (a row is at least --dg-row tall and grows with its cards)
 * @property {number} [minW] @property {number} [maxW] @property {number} [minH] @property {number} [maxH] size limits
 * @property {string} [cls] extra class on the card's cell
 * @property {boolean} [item] one of a list of things (an account, a trip…): see the `ordered` option of designGrid
 */

/** Pages already warned about (see designGrid): once each is enough. */
const warned = new Set();
/** Narrower than this (the grid, in px) the cards are stacked and cannot be arranged. Keep in step with features.css. */
const NARROW = 600;
/** While dragging, the page scrolls when the pointer is this close (px) to the top or bottom of the window. */
const EDGE = 60;
/** A finger has to rest this long (ms) on a card before it lifts, so swiping still scrolls the page. */
const LONG_PRESS = 350;

/** How far past the top (negative) or bottom (positive) scroll zone the pointer is, in px; 0 in between. */
function edgeScroll(y) {
  if (y < EDGE) {
    return y - EDGE;
  }
  if (y > innerHeight - EDGE) {
    return y - (innerHeight - EDGE);
  }
  return 0;
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** After the page is drawn again, the same control of the same card in the new page (to keep focus or a pop-up). */
const again = (key, id, selector) =>
  document.querySelector(`.dg[data-grid="${CSS.escape(key)}"] .dg-item[data-id="${CSS.escape(id)}"] ${selector}`);

/** Whether the "Design mode" switch is shown at all (Settings › Appearance). Saved layouts apply either way. */
const enabled = () => Store.db.designMode === true;

/**
 * True while page `key` is being arranged. The one test for it: a page that changes what it shows in Design mode
 * (Trips and Wishlist drop their search and filters) must use this, not UI.design alone, so it always agrees with the grid.
 */
export const isDesigning = key => enabled() && UI.design === key;

/** The "Design mode" checkbox for the page head, or nothing when it is turned off in Settings. */
export function designToggle(key) {
  if (!enabled()) {
    return null;
  }
  const box = h('input', {
    type: 'checkbox',
    checked: UI.design === key,
    onchange: () => {
      UI.design = box.checked ? key : null;
      closePop();
      App.render();
      const back = document.querySelector(`[data-design-toggle="${CSS.escape(key)}"] input`);
      if (back) {
        back.focus();
      }
    },
  });
  return h(
    'label',
    { class: 'switch dg-toggle', 'data-design-toggle': key, title: $t('Move the cards and change their size') },
    box,
    h('span', { text: $t('Design mode') }),
  );
}

/** Saves the layout `key` of page `page` and draws the page again. Written down in the log, like every change. */
function save(key, layout, page) {
  Store.setPref(
    'layouts',
    { ...Store.db.layouts, [key]: toSaved(layout) },
    $t('Changed the layout of the page “{0}”', pageName(page)),
  );
}

/** Where a card is, in words, for its move button (screen readers read it again after every move). */
const placeText = (title, c) =>
  $t(
    'Move “{0}”: row {1}, column {2}, {3} wide, {4} high. Arrow keys move it; Shift and arrow keys change its size.',
    title,
    c.y + 1,
    c.x + 1,
    plural(c.w, 'column'),
    plural(c.h, 'row'),
  );

/**
 * The cards of a page on a grid. Outside Design mode it is only a layout; in Design mode the cards can be arranged.
 * @param {string} key name of the page: Design mode is on for one page at a time (e.g. 'overview')
 * @param {GridCard[]} cards in their default order
 * @param {object} [options]
 * @param {string} [options.layoutKey] name of the saved layout, when one page has several (its Cards and List views);
 *   the page name by default
 * @param {boolean} [options.ordered] the person has searched, filtered or sorted the list: the `item` cards follow that
 *   order (keeping their sizes) instead of their saved places, so hidden ones leave no holes. Ignored in Design mode,
 *   where the page should pass every item.
 * @param {string} [options.note] one more sentence for the Design mode bar (e.g. that filters are off meanwhile)
 */
export function designGrid(key, cards, { cols = GRID_COLS, layoutKey = key, ordered = false, note = '' } = {}) {
  if (!isDesignable(key) && !warned.has(key)) {
    // a page that arranges its cards but is missing from the list of pages offering Design mode (designPages.js)
    warned.add(key);
    console.warn(`Design mode: page "${key}" is not declared. Add designable('${key}', name) next to its view.`);
  }
  const designing = isDesigning(key);
  const shown = designing ? cards : cards.filter(c => c.el);
  const specs = new Map(shown.map(c => [c.id, c]));
  const saved = Store.db.layouts[layoutKey] || null;
  const fixed = cards.filter(c => !c.item).map(c => c.id);
  let layout = ordered && !designing ? arrangeOrdered(shown, saved, cols, fixed) : arrange(shown, saved, cols);
  const grid = h('div', { class: 'dg' + (designing ? ' designing' : ''), 'data-grid': key });
  grid.style.setProperty('--dg-cols', cols);
  const nodes = new Map();
  for (const c of layout) {
    const spec = specs.get(c.id);
    const node = designing
      ? designCell(spec)
      : h('div', { class: 'dg-item ' + (spec.cls || ''), 'data-id': spec.id }, spec.el);
    nodes.set(c.id, node);
    grid.append(node);
  }
  let outline = [];
  /** Puts every card in its cell; in Design mode also draws the grid lines and one free row at the bottom. */
  const drawn = new Map();
  const draw = l => {
    const rows = Math.max(1, rowCount(l) + (designing ? 1 : 0));
    grid.style.gridTemplateRows = `repeat(${rows}, minmax(var(--dg-row), auto))`;
    for (const c of l) {
      // only the cards that moved are touched, so a preview while dragging costs one layout of what changed
      const place = `${c.x},${c.y},${c.w},${c.h}`;
      if (drawn.get(c.id) === place) {
        continue;
      }
      drawn.set(c.id, place);
      const node = nodes.get(c.id);
      node.style.gridColumn = `${c.x + 1} / span ${c.w}`;
      node.style.gridRow = `${c.y + 1} / span ${c.h}`;
      if (designing) {
        node.querySelector('.dg-size').textContent = `${c.w} × ${c.h}`;
        node.querySelector('.dg-grip').setAttribute('aria-label', placeText(specs.get(c.id).title, c));
      }
    }
    if (designing && outline.length !== rows * cols) {
      outline.forEach(o => o.remove());
      outline = [];
      for (let r = 0; r < rows; r++) {
        for (let x = 0; x < cols; x++) {
          outline.push(h('div', { class: 'dg-cell', style: `grid-area:${r + 1} / ${x + 1}` }));
        }
      }
      grid.prepend(...outline);
    }
  };
  draw(layout);
  const wrap = h('div', { class: 'dg-wrap' });
  if (!designing) {
    wrap.append(grid);
    return wrap;
  }

  /** Saves a finished change. The page is drawn again; `after` then runs on the new page (focus, pop-up). */
  const commit = (next, after) => {
    if (sameLayout(next, layout)) {
      draw(layout);
      return;
    }
    layout = next;
    save(layoutKey, next, key);
    if (after) {
      after();
    }
  };
  const narrow = () => grid.clientWidth < NARROW;

  /* --- size pop-up: a grid of cells, like picking the size of a new table in a word processor --- */
  const sizePop = (anchor, id) => {
    const spec = specs.get(id);
    const c = layout.find(x => x.id === id);
    const choose = (w, hh) =>
      commit(resize(layout, id, w, hh, cols), () => {
        // keep the pop-up open on the new page, on the size just chosen, to try another one
        const button = again(key, id, '.dg-size');
        if (button) {
          button.click();
        }
      });
    popover(anchor, $t('Size of “{0}”', spec.title), pop => {
      pop.classList.add('dg-pop');
      pop.append(h('div', { class: 'mpop-h', text: spec.title }), sizePicker(spec, c, cols, choose));
    });
    const current = document.querySelector('.mpop .dg-sizer [aria-pressed="true"]');
    if (current) {
      current.focus();
    }
  };
  grid.addEventListener('click', e => {
    const size = e.target.closest('.dg-size');
    if (size && !narrow()) {
      sizePop(size, size.closest('.dg-item').dataset.id);
    }
  });

  /* --- keyboard: arrows move the card, Shift + arrows change its size --- */
  grid.addEventListener('keydown', e => {
    const grip = e.target.closest && e.target.closest('.dg-grip');
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!grip || !step || e.ctrlKey || e.metaKey || e.altKey || narrow()) {
      return;
    }
    e.preventDefault();
    const id = grip.closest('.dg-item').dataset.id;
    const c = layout.find(x => x.id === id);
    let next;
    if (e.shiftKey) {
      const size = fitSize(specs.get(id), c.w + step[0], c.h + step[1], cols);
      next = resize(layout, id, size.w, size.h, cols);
    } else {
      next = nudge(layout, id, step[0], step[1], cols);
    }
    commit(next, () => {
      const back = again(key, id, '.dg-grip');
      if (back) {
        back.focus();
      }
    });
  });

  /* --- pointer: drag a card to move it, drag its corner to resize it --- */
  /** Where the columns and rows of the grid are on screen right now. */
  const metrics = () => {
    const r = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const gap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    const ends = [];
    let y = r.top;
    for (const track of style.gridTemplateRows.split(' ').map(parseFloat)) {
      if (!Number.isNaN(track)) {
        y += track;
        ends.push(y + rowGap / 2);
        y += rowGap;
      }
    }
    return { left: r.left, gap, step: (r.width - gap * (cols - 1)) / cols + gap, ends };
  };
  const rowAt = (m, y) => {
    const i = m.ends.findIndex(end => y < end);
    return i < 0 ? m.ends.length - 1 : i;
  };
  /** The slide of each card that is moving to its new cell, so a newer move can stop it. */
  const slides = new Map();
  /**
   * Moves the cards that changed cell from where they were (`before`: their on-screen boxes, measured before the
   * change) to their new cells smoothly, so it is clear what moved where.
   */
  const glide = before => {
    const motion = !reducedMotion();
    for (const id of before.keys()) {
      const running = slides.get(id);
      if (running) {
        running.cancel();
        slides.delete(id);
      }
    }
    if (!motion) {
      return;
    }
    for (const [id, r0] of before) {
      const node = nodes.get(id);
      const r1 = node.getBoundingClientRect();
      const dx = r0.left - r1.left;
      const dy = r0.top - r1.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const slide = node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
          duration: 180,
          easing: 'cubic-bezier(.2,.7,.3,1)',
        });
        slides.set(id, slide);
        slide.onfinish = () => slides.delete(id);
      }
    }
  };

  let dragging = false;
  /** Drag card `id` (mode 'move') or its corner (mode 'size'), starting from pointer event `e`. */
  const drag = (e, id, mode) => {
    const node = nodes.get(id);
    const spec = specs.get(id);
    const start = layout;
    const me = start.find(c => c.id === id);
    const others = start.filter(c => c.id !== id);
    const box = node.getBoundingClientRect();
    const grab = { x: e.clientX - box.left, y: e.clientY - box.top };
    const pointer = { x: e.clientX, y: e.clientY };
    const spot = h('div', { class: 'dg-ph', 'aria-hidden': 'true' });
    let at = { x: me.x, y: me.y, w: me.w, h: me.h };
    let shown = start;
    let frame = 0;
    let moved = true;
    // where the lifted card's cell is on the page, measured once after each change, so following the pointer
    // only sets a transform and never makes the browser lay the page out again
    let base = null;
    dragging = true;
    let finished = false;
    // capture the pointer, so the drag ends even when the button is released outside the window; losing the capture
    // without a release (the window lost focus, say) cancels the drag
    const holder = e.target instanceof Element ? e.target : null;
    try {
      holder.setPointerCapture(e.pointerId);
    } catch (error) {
      // the pointer is already gone (a long press that ended): the document listeners below still end the drag
    }
    closePop();
    grid.append(spot);
    grid.classList.add('dragging');
    node.classList.add(mode === 'move' ? 'dg-lift' : 'dg-sizing');
    // the lifted card follows the pointer; its cell (shown by the dashed spot) is where it will land
    const measure = () => {
      if (mode === 'move') {
        node.style.transform = '';
        const r = node.getBoundingClientRect();
        base = { x: r.left + scrollX, y: r.top + scrollY };
      }
    };
    const follow = () => {
      if (mode === 'move') {
        const x = pointer.x + scrollX - grab.x - base.x;
        const y = pointer.y + scrollY - grab.y - base.y;
        node.style.transform = `translate(${x}px, ${y}px)`;
      }
    };
    const show = cell => {
      spot.style.gridColumn = `${cell.x + 1} / span ${cell.w}`;
      spot.style.gridRow = `${cell.y + 1} / span ${cell.h}`;
    };
    const target = () => {
      const m = metrics();
      if (mode === 'size') {
        const size = fitSize(
          spec,
          Math.round((pointer.x - (m.left + me.x * m.step) + m.gap) / m.step),
          rowAt(m, pointer.y) - me.y + 1,
          cols,
        );
        return { x: Math.min(me.x, cols - size.w), y: me.y, ...size };
      }
      // the row under the pointer (staying put while it is over the spot, so rows that change height do not flicker)
      const s = spot.getBoundingClientRect();
      const inside = pointer.y >= s.top && pointer.y <= s.bottom;
      const y = Math.min(inside ? at.y : rowAt(m, pointer.y), rowCount(others));
      // the column under the card's left edge, nudged beside a card it would half cover
      const x = Math.round((pointer.x - grab.x - m.left) / m.step);
      return { ...snapDrop(start, id, { x, y, w: me.w, h: me.h }, cols), w: me.w, h: me.h };
    };
    const update = () => {
      const next = target();
      if (next.x !== at.x || next.y !== at.y || next.w !== at.w || next.h !== at.h) {
        at = next;
        const preview = place(start, id, at, cols, false);
        const changed = preview.filter(c => {
          const was = shown.find(o => o.id === c.id);
          return c.id !== id && (!was || was.x !== c.x || was.y !== c.y || was.w !== c.w || was.h !== c.h);
        });
        const before = new Map(changed.map(c => [c.id, nodes.get(c.id).getBoundingClientRect()]));
        shown = preview;
        draw(preview);
        show(at);
        measure();
        glide(before);
      }
      follow();
    };
    // at most one update per frame, however fast the pointer events come; the page scrolls near the window's edges
    const tick = () => {
      const dy = edgeScroll(pointer.y);
      if (dy) {
        scrollBy(0, Math.max(-18, Math.min(18, dy / 3)));
        moved = true;
      }
      if (moved) {
        moved = false;
        update();
      }
      frame = requestAnimationFrame(tick);
    };
    const move = ev => {
      pointer.x = ev.clientX;
      pointer.y = ev.clientY;
      moved = true;
    };
    const finish = keep => {
      if (finished) {
        return;
      }
      finished = true;
      dragging = false;
      if (holder) {
        holder.removeEventListener('lostpointercapture', lost);
      }
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', esc, true);
      cancelAnimationFrame(frame);
      spot.remove();
      grid.classList.remove('dragging');
      node.classList.remove('dg-lift', 'dg-sizing');
      node.style.transform = '';
      if (keep) {
        commit(place(start, id, at, cols));
      } else {
        draw(start);
      }
    };
    const up = () => {
      // a move that came after the last frame still counts: drop where the pointer really is
      if (moved) {
        update();
      }
      finish(true);
    };
    const cancel = () => finish(false);
    // pointerup releases the capture too, but it has finished the drag by then, so this only cancels a lost pointer
    const lost = () => finish(false);
    const esc = ev => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    };
    show(at);
    measure();
    follow();
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', esc, true);
    if (holder) {
      holder.addEventListener('lostpointercapture', lost);
    }
    frame = requestAnimationFrame(tick);
  };

  grid.addEventListener('pointerdown', e => {
    const handle = e.target.closest('.dg-grip, .dg-shield, .dg-resize');
    if (!handle || e.button !== 0 || dragging || narrow()) {
      return;
    }
    const id = handle.closest('.dg-item').dataset.id;
    const mode = handle.classList.contains('dg-resize') ? 'size' : 'move';
    if (e.pointerType !== 'touch' || !handle.classList.contains('dg-shield')) {
      e.preventDefault();
      drag(e, id, mode);
      return;
    }
    // a finger on the card itself: lift it after a short rest, so that swiping still scrolls the page
    const timer = setTimeout(() => {
      stop();
      drag(e, id, 'move');
    }, LONG_PRESS);
    const check = ev => {
      if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 8) {
        stop();
      }
    };
    const stop = () => {
      clearTimeout(timer);
      document.removeEventListener('pointermove', check);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
    document.addEventListener('pointermove', check);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  });
  // once a card is lifted by touch, the finger moves the card, not the page
  grid.addEventListener(
    'touchmove',
    e => {
      if (dragging) {
        e.preventDefault();
      }
    },
    { passive: false },
  );
  grid.addEventListener('contextmenu', e => {
    if (e.target.closest('.dg-shield')) {
      e.preventDefault();
    }
  });

  const reset = () =>
    confirmModal(
      $t('Reset the layout?'),
      $t('Every card goes back to its usual place and size.'),
      $t('Reset layout'),
      () => {
        const next = { ...Store.db.layouts };
        delete next[layoutKey];
        Store.setPref('layouts', next, $t('Reset the layout of the page “{0}”', pageName(key)));
      },
    );
  const resetBtn = btn($t('Reset layout'), reset, 'sm');
  resetBtn.disabled = !saved;
  wrap.append(
    h(
      'div',
      { class: 'dg-bar note info' },
      icon('info'),
      h('div', {
        class: 'grow',
        text:
          $t(
            'Drag a card to move it, or drag its corner to resize it. Cards in the way move along to make room. Changes are saved as you go.',
          ) + (note ? ' ' + note : ''),
      }),
      resetBtn,
    ),
    h('p', {
      class: 'dg-narrow note warn',
      text: $t('The window is too narrow to arrange the cards. Make it wider, or use a larger screen.'),
    }),
    grid,
  );
  return wrap;
}

/**
 * The size picker: `cols` × GRID_MAX_H cells. Pointing at a cell (or moving to it with the arrow keys) highlights the
 * block from the top-left corner to it and shows "4 × 2"; a click or Enter chooses that size. Sizes outside the card's
 * limits are dimmed and pick the nearest allowed size.
 * @param {GridCard} spec the card (for its size limits)
 * @param {{w:number,h:number}} current its size now
 * @param {number} cols columns of the grid
 * @param {(w:number, h:number) => void} choose called with the chosen size
 */
function sizePicker(spec, current, cols, choose) {
  const label = h('div', { class: 'dg-sizer-l', 'aria-live': 'polite' });
  const cells = [];
  const paint = (w, hh) => {
    const size = fitSize(spec, w, hh, cols);
    for (const cell of cells) {
      cell.classList.toggle('on', Number(cell.dataset.w) <= size.w && Number(cell.dataset.h) <= size.h);
    }
    label.textContent = $t('{0} × {1} ({2}, {3})', size.w, size.h, plural(size.w, 'column'), plural(size.h, 'row'));
  };
  const grid = h('div', {
    class: 'dg-sizer',
    role: 'grid',
    'aria-label': $t('Width and height'),
    style: `grid-template-columns: repeat(${cols}, 1fr)`,
  });
  for (let row = 1; row <= GRID_MAX_H; row++) {
    for (let col = 1; col <= cols; col++) {
      const allowed = fitSize(spec, col, row, cols);
      const isCurrent = col === current.w && row === current.h;
      const cell = h('button', {
        type: 'button',
        class: 'dg-sizer-c' + (allowed.w === col && allowed.h === row ? '' : ' out'),
        role: 'gridcell',
        tabindex: isCurrent ? 0 : -1,
        'aria-pressed': String(isCurrent),
        'aria-label': $t('{0} by {1}', plural(col, 'column'), plural(row, 'row')),
        onclick: () => choose(allowed.w, allowed.h),
        onpointerenter: () => paint(col, row),
        onfocus: () => paint(col, row),
      });
      cell.dataset.w = col;
      cell.dataset.h = row;
      cells.push(cell);
      grid.append(cell);
    }
  }
  // arrow keys move between cells (one tab stop for the whole grid)
  grid.addEventListener('keydown', e => {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const from = e.target.closest('.dg-sizer-c');
    if (!step || !from) {
      return;
    }
    e.preventDefault();
    const w = clamp(Number(from.dataset.w) + step[0], 1, cols);
    const hh = clamp(Number(from.dataset.h) + step[1], 1, GRID_MAX_H);
    const to = cells[(hh - 1) * cols + (w - 1)];
    from.tabIndex = -1;
    to.tabIndex = 0;
    to.focus();
  });
  grid.addEventListener('pointerleave', () => paint(current.w, current.h));
  paint(current.w, current.h);
  return h(
    'div',
    null,
    grid,
    label,
    h('p', { class: 'small muted', text: $t('Cards in the way move along to make room.') }),
  );
}

/** A card's cell in Design mode: the card itself (not usable while arranging), a surface to drag, and its tools. */
function designCell(spec) {
  const body =
    spec.el ||
    h(
      'section',
      { class: 'card dg-standin' },
      h(
        'div',
        { class: 'card-h' },
        h(
          'div',
          null,
          h('h2', { text: spec.title }),
          h('p', { text: $t('Hidden while it has nothing to show. Its place is kept.') }),
        ),
      ),
    );
  body.inert = true;
  return h(
    'div',
    { class: 'dg-item ' + (spec.cls || ''), 'data-id': spec.id, role: 'group', 'aria-label': spec.title },
    body,
    h('div', { class: 'dg-shield', title: spec.title, 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'dg-tools' },
      h('button', { type: 'button', class: 'dg-grip', title: $t('Drag to move, or use the arrow keys') }, icon('grip')),
      h('button', {
        type: 'button',
        class: 'dg-size',
        'aria-haspopup': 'dialog',
        title: $t('Change the size'),
        'aria-label': $t('Change the size of “{0}”', spec.title),
      }),
    ),
    h('div', { class: 'dg-resize', title: $t('Drag to resize'), 'aria-hidden': 'true' }),
  );
}
