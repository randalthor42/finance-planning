/**
 * @file Card grid arithmetic for Design mode: where each card sits on a grid of columns and rows, and how the other
 * cards make room when one is moved or resized, like widgets on a phone home screen. Pure: no DOM, no state.
 *
 * A layout is a list of cells { id, x, y, w, h }: column and row of the top-left corner (from 0), width in columns,
 * height in rows. Cards never overlap. Gaps inside a row are allowed (a card can sit anywhere); empty rows are removed.
 *
 * The rules for making room: the card being moved or resized goes exactly where it was put. A card in its way first
 * uses free space in its own row (shifting along with the cards after it, or taking a free place left or right), so no
 * card leaves a row that still has room for it. Only when its row is full does it move forward in reading order (left
 * to right, then down), and the cards after it flow on the same way. So with two cards of 6 columns side by side, dropping a 2-column card between
 * them pushes the right one to the next row; but dropping a card on a neighbour in a row with room swaps the two.
 */
import { clamp } from './util.js';

/** Columns of a design grid. */
export const GRID_COLS = 12;
/** Tallest a card can be made, in rows. */
export const GRID_MAX_H = 6;

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const isFree = (placed, cell) => placed.every(p => !overlaps(p, cell));
/** Reading order: by row, then by column. Array sort is stable, so equal cells keep their order. */
export const byReading = (a, b) => a.y - b.y || a.x - b.x;
const sorted = layout => [...layout].sort(byReading);

/** The width and height a card may have: its own limits (minW, maxW, minH, maxH), within the grid. */
export function fitSize(spec, w, h, cols = GRID_COLS) {
  const minW = clamp(Math.round(spec.minW) || 1, 1, cols);
  const maxW = clamp(Math.round(spec.maxW) || cols, minW, cols);
  const minH = clamp(Math.round(spec.minH) || 1, 1, GRID_MAX_H);
  const maxH = clamp(Math.round(spec.maxH) || GRID_MAX_H, minH, GRID_MAX_H);
  return { w: clamp(Math.round(w) || minW, minW, maxW), h: clamp(Math.round(h) || minH, minH, maxH) };
}

/** A cell made whole: whole numbers, at least 1 × 1, inside the columns, not above the first row. */
function tidy(cell, cols) {
  const w = clamp(Math.round(cell.w) || 1, 1, cols);
  const h = Math.max(1, Math.round(cell.h) || 1);
  return { id: cell.id, x: clamp(Math.round(cell.x) || 0, 0, cols - w), y: Math.max(0, Math.round(cell.y) || 0), w, h };
}

/**
 * Which cells are taken, row by row, so "is this place free?" looks at the cells it covers instead of at every card.
 * Cards must be inside the columns (see tidy).
 */
function occupancy(cols, cards = []) {
  const rows = new Map();
  const occ = {
    add(c) {
      for (let r = c.y; r < c.y + c.h; r++) {
        let row = rows.get(r);
        if (!row) {
          row = new Uint8Array(cols);
          rows.set(r, row);
        }
        row.fill(1, c.x, c.x + c.w);
      }
    },
    free(c) {
      for (let r = c.y; r < c.y + c.h; r++) {
        const row = rows.get(r);
        if (row && row.subarray(c.x, c.x + c.w).includes(1)) {
          return false;
        }
      }
      return true;
    },
  };
  cards.forEach(occ.add);
  return occ;
}

/** The first place at or after (x, y) in reading order where a w × h card passes `fits`. `fits` must accept any
 * place below all the cards, so a place is always found. */
function firstSpot(fits, w, h, x, y, cols) {
  w = clamp(w, 1, cols);
  for (let row = Math.max(0, y); ; row++) {
    for (let col = row === y ? Math.max(0, x) : 0; col + w <= cols; col++) {
      if (fits({ x: col, y: row, w, h })) {
        return { x: col, y: row };
      }
    }
  }
}

/** The first place at or after (x, y) in reading order where a w × h card fits next to `placed`. Always finds one. */
export function findSpot(placed, w, h, x, y, cols = GRID_COLS) {
  return firstSpot(occupancy(cols, placed).free, w, h, x, y, cols);
}

/** Number of rows a layout uses. */
export const rowCount = layout => layout.reduce((n, c) => Math.max(n, c.y + c.h), 0);

/** Drops rows that no card covers, so the cards below move up. Gaps inside a row stay. */
export function removeEmptyRows(layout) {
  const used = new Set();
  for (const c of layout) {
    for (let r = c.y; r < c.y + c.h; r++) {
      used.add(r);
    }
  }
  const shift = [];
  let empty = 0;
  for (let r = 0; r < rowCount(layout); r++) {
    shift[r] = empty;
    if (!used.has(r)) {
      empty++;
    }
  }
  return sorted(layout.map(c => ({ ...c, y: c.y - (shift[c.y] || 0) })));
}

/** The free place in row `y` nearest to column `x` where a w × h card passes `fits`, or null. */
function spotInRow(fits, w, h, x, y, cols) {
  let best = null;
  for (let col = 0; col + w <= cols; col++) {
    if (fits({ x: col, y, w, h }) && (best === null || Math.abs(col - x) < Math.abs(best - x))) {
      best = col;
    }
  }
  return best === null ? null : { x: best, y };
}

/**
 * Lays out a displaced card and the cards after it in its row again, in the same order, each keeping its place when
 * it still can and otherwise taking the first free place after the card before it. Null when they do not all fit.
 */
function reflowRow(fits, row, cols) {
  const out = [];
  const clear = cell => fits(cell) && isFree(out, cell);
  let from = 0;
  for (const c of row) {
    let x = c.x >= from && clear(c) ? c.x : null;
    for (let col = from; x === null && col + c.w <= cols; col++) {
      if (clear({ ...c, x: col })) {
        x = col;
      }
    }
    if (x === null) {
      return null;
    }
    out.push({ ...c, x });
    from = x + c.w;
  }
  return out;
}

/** The first place inside `hole` (the place a moved card left) where card `c` passes `fits` in its own row, or null. */
function spotInHole(fits, c, hole) {
  if (!hole || c.y < hole.y || c.y >= hole.y + hole.h) {
    return null;
  }
  for (let x = hole.x; x + c.w <= hole.x + hole.w; x++) {
    if (fits({ ...c, x })) {
      return { x, y: c.y };
    }
  }
  return null;
}

/**
 * Settles cards next to the ones already `placed`, in reading order. A card keeps its place if it is free. If not:
 * 1. when a card was moved away from this row, it takes the place that card left (so the two swap);
 * 2. when its row still has room, the card and the ones after it in the row shift along, keeping their order;
 * 3. otherwise it takes the nearest free place in its row, keeping clear of the others;
 * 4. only when its row has no room at all does it move on to the next place it fits, and the cards after it flow on.
 * Only the cards still to come that reach into the rows concerned are looked at, so long lists stay quick.
 */
function settle(cards, cols, placed = [], hole = null) {
  const out = [...placed];
  const occ = occupancy(cols, placed);
  const put = c => {
    out.push(c);
    occ.add(c);
  };
  const queue = sorted(cards);
  const done = new Set();
  queue.forEach((c, i) => {
    if (done.has(c)) {
      return;
    }
    if (occ.free(c)) {
      put(c);
      return;
    }
    // the cards still to come in this card's row, then every card still to come that reaches into the rows they cover
    // (the queue is in reading order, so these are the next ones)
    let j = i + 1;
    const row = [];
    for (; j < queue.length && queue[j].y === c.y; j++) {
      if (!done.has(queue[j])) {
        row.push(queue[j]);
      }
    }
    const end = Math.max(c.y + c.h, ...row.map(n => n.y + n.h));
    const band = [...row];
    for (; j < queue.length && queue[j].y < end; j++) {
      if (!done.has(queue[j])) {
        band.push(queue[j]);
      }
    }
    const staying = band.filter(n => occ.free(n));
    const clear = cell => occ.free(cell) && isFree(staying, cell);
    const swap = spotInHole(clear, c, hole);
    if (swap) {
      put({ ...c, ...swap });
      return;
    }
    const others = staying.filter(n => n.y !== c.y);
    const shifted = reflowRow(cell => occ.free(cell) && isFree(others, cell), [c, ...row], cols);
    if (shifted) {
      shifted.forEach(put);
      row.forEach(n => done.add(n));
      return;
    }
    put({ ...c, ...(spotInRow(clear, c.w, c.h, c.x, c.y, cols) || firstSpot(occ.free, c.w, c.h, c.x, c.y, cols)) });
  });
  return sorted(out);
}

/**
 * Puts card `id` at `cell` ({ x, y, w, h }) and makes room: every card in its way moves forward.
 * `tight` false keeps rows that became empty (used while dragging, so the rows under the pointer stay put).
 */
export function place(layout, id, cell, cols = GRID_COLS, tight = true) {
  const moved = tidy({ ...cell, id }, cols);
  // the place the card left, when it moved right away from it (not when it only grew or shrank)
  const before = layout.find(c => c.id === id);
  const hole = before && !overlaps(before, moved) ? before : null;
  const out = settle(
    layout.filter(c => c.id !== id),
    cols,
    [moved],
    hole,
  );
  return tight ? removeEmptyRows(out) : out;
}

/**
 * Where card `id`, dropped at `cell` ({ x, y, w, h }: its left edge on column x of row y), should go, the way an icon
 * dropped on a home screen slots in instead of lying half over another one:
 * - in a free place, or mostly over one (within half its width), it goes there and nothing moves;
 * - otherwise it goes to the card under its middle: in that card's place (which then moves to free space in the row,
 *   so the two swap), or after it when its left edge is past that card's middle and it fits in the row.
 */
export function snapDrop(layout, id, cell, cols = GRID_COLS) {
  const w = clamp(Math.round(cell.w) || 1, 1, cols);
  const h = Math.max(1, Math.round(cell.h) || 1);
  const y = Math.max(0, Math.round(cell.y) || 0);
  const x = clamp(Math.round(cell.x) || 0, 0, cols - w);
  const others = layout.filter(c => c.id !== id);
  const free = spotInRow(occupancy(cols, others).free, w, h, x, y, cols);
  if (free && Math.abs(free.x - x) <= Math.max(1, Math.floor(w / 2))) {
    return free;
  }
  const span = { x, y, w, h };
  const hits = others.filter(c => overlaps(c, span));
  const middle = x + w / 2;
  const width = c => Math.min(c.x + c.w, x + w) - Math.max(c.x, x);
  const under =
    hits.find(c => c.x <= middle && middle < c.x + c.w) || hits.reduce((a, b) => (width(b) > width(a) ? b : a));
  const after = under.x + under.w;
  return { x: x - under.x >= under.w / 2 && after + w <= cols ? after : under.x, y };
}

/**
 * Keyboard move by one step (dx or dy is -1 or 1). Stepping onto a neighbour of the same height in the same row swaps
 * the two; otherwise the card moves one cell and whatever is in its way moves forward.
 */
export function nudge(layout, id, dx, dy, cols = GRID_COLS) {
  const me = layout.find(c => c.id === id);
  if (!me) {
    return layout;
  }
  const to = { ...me, x: me.x + dx, y: me.y + dy };
  if (to.x < 0 || to.x + to.w > cols || to.y < 0) {
    return layout;
  }
  if (dy) {
    return place(layout, id, to, cols);
  }
  const hit = layout.filter(c => c.id !== id && overlaps(c, to));
  const other = hit.length === 1 && hit[0].y === me.y && hit[0].h === me.h ? hit[0] : null;
  if (other && (dx < 0 ? other.x + other.w === me.x : me.x + me.w === other.x)) {
    const first = dx < 0 ? me : other;
    const second = dx < 0 ? other : me;
    const x0 = Math.min(me.x, other.x);
    const swapped = c => {
      if (c === first) {
        return { ...c, x: x0 };
      }
      if (c === second) {
        return { ...c, x: x0 + first.w };
      }
      return c;
    };
    return sorted(layout.map(swapped));
  }
  return place(layout, id, to, cols);
}

/** Changes the size of card `id`, keeping its top-left corner where possible; cards in the way move forward. */
export function resize(layout, id, w, h, cols = GRID_COLS) {
  const me = layout.find(c => c.id === id);
  if (!me) {
    return layout;
  }
  return place(layout, id, { x: Math.min(me.x, cols - w), y: me.y, w, h }, cols);
}

/** arrange without removing empty rows (see arrange). */
function arrangeLoose(specs, saved, cols) {
  const cells = [];
  const fresh = [];
  for (const spec of specs) {
    const s = saved && saved[spec.id];
    if (s) {
      cells.push(tidy({ id: spec.id, x: s.x, y: s.y, ...fitSize(spec, s.w, s.h, cols) }, cols));
    } else {
      fresh.push({ id: spec.id, ...fitSize(spec, spec.w, spec.h, cols) });
    }
  }
  const out = settle(cells, cols);
  const occ = occupancy(cols, out);
  let from = { x: 0, y: 0 };
  for (const c of fresh) {
    const spot = firstSpot(occ.free, c.w, c.h, from.x, from.y, cols);
    out.push({ ...c, ...spot });
    occ.add({ ...c, ...spot });
    // with nothing saved, keep the default order: each card goes after the previous one
    from = saved ? from : { x: spot.x + c.w, y: spot.y };
  }
  return out;
}

/**
 * The layout of a page of cards.
 * @param {Array<{id:string,w?:number,h?:number,minW?:number,maxW?:number,minH?:number,maxH?:number}>} specs the cards,
 *   in their default order with their default size
 * @param {Object<string,{x:number,y:number,w:number,h:number}>|null} saved the places the person chose, by card id
 * Without a saved layout the cards simply flow in order. With one, each card takes its saved place (settling any
 * overlap), and a card that has no saved place yet takes the first free place that fits.
 */
export function arrange(specs, saved, cols = GRID_COLS) {
  return removeEmptyRows(arrangeLoose(specs, saved, cols));
}

/**
 * The layout of a list the person has searched, filtered or sorted. The cards marked `item` (one trip, one wish…) are
 * shown in the order given, so they flow one after the other, each keeping its saved size, starting where the list
 * starts in the saved layout; the other cards (totals, planners) keep their saved places. No holes are left by hidden
 * items. `fixed` names every card of the page that is not an item, also those not shown now: every other saved place
 * belongs to an item, shown or hidden by the search, and the first of them is where the list starts.
 */
export function arrangeOrdered(specs, saved, cols = GRID_COLS, fixed = []) {
  if (!saved) {
    return arrange(specs, null, cols);
  }
  const items = specs.filter(spec => spec.item);
  const out = arrangeLoose(
    specs.filter(spec => !spec.item),
    saved,
    cols,
  );
  const occ = occupancy(cols, out);
  const notItems = new Set([...fixed, ...specs.filter(spec => !spec.item).map(spec => spec.id)]);
  const starts = Object.entries(saved)
    .filter(([id]) => !notItems.has(id))
    .map(([, place]) => place);
  let from = starts.length ? [...starts].sort(byReading)[0] : { x: 0, y: 0 };
  for (const spec of items) {
    const s = saved[spec.id];
    const size = s ? fitSize(spec, s.w, s.h, cols) : fitSize(spec, spec.w, spec.h, cols);
    const spot = firstSpot(occ.free, size.w, size.h, from.x, from.y, cols);
    out.push({ id: spec.id, ...spot, ...size });
    occ.add({ ...spot, ...size });
    from = { x: spot.x + size.w, y: spot.y };
  }
  return removeEmptyRows(out);
}

/** A layout as it is stored: { id: { x, y, w, h } }. */
export const toSaved = layout => Object.fromEntries(layout.map(c => [c.id, { x: c.x, y: c.y, w: c.w, h: c.h }]));

/** True when two layouts put every card in the same place with the same size. */
export const sameLayout = (a, b) =>
  a.length === b.length &&
  a.every(c => {
    const d = b.find(x => x.id === c.id);
    return d && d.x === c.x && d.y === c.y && d.w === c.w && d.h === c.h;
  });
