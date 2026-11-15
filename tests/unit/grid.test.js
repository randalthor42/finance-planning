/**
 * @file Unit tests for the Design mode card grid (placing, making room, snapping, keyboard moves). Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrange,
  arrangeOrdered,
  removeEmptyRows,
  findSpot,
  fitSize,
  nudge,
  place,
  resize,
  rowCount,
  snapDrop,
} from '../../src/core/grid.js';

/** A layout as short text, row by row: 'A0.6 B6.6 | C0.12' (id, column, width). */
const text = layout =>
  Array.from({ length: rowCount(layout) }, (_, r) =>
    layout
      .filter(c => c.y === r)
      .map(c => `${c.id}${c.x}.${c.w}` + (c.h > 1 ? `x${c.h}` : ''))
      .join(' '),
  ).join(' | ');
const cell = (id, x, y, w, h = 1) => ({ id, x, y, w, h });

test('dropping a 2-column card between two 6-column cards pushes the right one to the next row', () => {
  const layout = [cell('A', 0, 0, 6), cell('B', 6, 0, 6), cell('C', 0, 1, 2)];
  const target = snapDrop(layout, 'C', { x: 6, y: 0, w: 2, h: 1 });
  assert.deepEqual(target, { x: 6, y: 0 });
  assert.equal(text(place(layout, 'C', { ...target, w: 2, h: 1 })), 'A0.6 C6.2 | B0.6');
});

test('the rest of the grid flows on: each pushed card pushes the next one', () => {
  const layout = [cell('A', 0, 0, 6), cell('B', 6, 0, 6), cell('D', 0, 1, 6), cell('E', 6, 1, 6), cell('N', 0, 2, 2)];
  assert.equal(text(place(layout, 'N', { x: 6, y: 0, w: 2, h: 1 })), 'A0.6 N6.2 | B0.6 D6.6 | E0.6');
});

test('a card can sit anywhere: dropped in an empty place it stays there and nothing moves', () => {
  const layout = [cell('A', 0, 0, 4), cell('B', 0, 1, 3)];
  assert.equal(text(place(layout, 'B', { x: 8, y: 0, w: 3, h: 1 })), 'A0.4 B8.3');
});

test('dropped inside a card, it goes before it (left half) or after it (right half)', () => {
  const layout = [cell('A', 0, 0, 6), cell('C', 0, 1, 2)];
  assert.deepEqual(snapDrop(layout, 'C', { x: 2, y: 0, w: 2, h: 1 }), { x: 0, y: 0 });
  assert.deepEqual(snapDrop(layout, 'C', { x: 4, y: 0, w: 2, h: 1 }), { x: 6, y: 0 });
  // after does not fit in the row: it goes before instead
  const full = [cell('A', 0, 0, 6), cell('B', 6, 0, 6), cell('C', 0, 1, 2)];
  assert.deepEqual(snapDrop(full, 'C', { x: 10, y: 0, w: 2, h: 1 }), { x: 6, y: 0 });
  // taking a card's place pushes it along the row when it still fits
  assert.equal(text(place(layout, 'C', { x: 0, y: 0, w: 2, h: 1 })), 'C0.2 A2.6');
});

test('bug: swapping a card with one in its own row never sends a card to another row', () => {
  const layout = [cell('S', 0, 0, 3), cell('E', 3, 0, 3), cell('L', 6, 0, 3), cell('D', 9, 0, 3), cell('Z', 0, 1, 12)];
  const dropAt = x => text(place(layout, 'S', { ...snapDrop(layout, 'S', { x, y: 0, w: 3, h: 1 }), w: 3, h: 1 }));
  // a little off its own place: nothing moves
  assert.equal(dropAt(1), 'S0.3 E3.3 L6.3 D9.3 | Z0.12');
  // over a neighbour: the two swap, the neighbour takes the free space
  assert.equal(dropAt(3), 'E0.3 S3.3 L6.3 D9.3 | Z0.12');
  assert.equal(dropAt(6), 'L0.3 E3.3 S6.3 D9.3 | Z0.12');
  assert.equal(dropAt(9), 'D0.3 E3.3 L6.3 S9.3 | Z0.12');
  // the same the other way: the last card dropped on the first swaps with it
  const back = x => text(place(layout, 'D', { ...snapDrop(layout, 'D', { x, y: 0, w: 3, h: 1 }), w: 3, h: 1 }));
  assert.equal(back(0), 'D0.3 E3.3 L6.3 S9.3 | Z0.12');
  assert.equal(back(3), 'S0.3 D3.3 L6.3 E9.3 | Z0.12');
  // a wide card dropped on two small ones: they take its place together, in order
  const pair = [cell('A', 0, 0, 3), cell('B', 3, 0, 3), cell('W', 6, 0, 6)];
  assert.equal(text(place(pair, 'W', { x: 0, y: 0, w: 6, h: 1 })), 'W0.6 A6.3 B9.3');
  // every position along the way keeps the row whole
  for (let x = 0; x <= 9; x++) {
    assert.ok(dropAt(x).endsWith(' | Z0.12') && dropAt(x).split(' | ')[0].split(' ').length === 4, 'at ' + x);
  }
});

test('bug: a wider card makes the card beside it use free space in the row before going to the next row', () => {
  const layout = [cell('A', 4, 0, 4), cell('B', 8, 0, 4), cell('Z', 0, 1, 12)];
  assert.equal(text(resize(layout, 'B', 8, 1)), 'A0.4 B4.8 | Z0.12');
  // also for tall cards
  const tall = [cell('A', 4, 0, 4), cell('B', 8, 0, 4, 4), cell('Z', 0, 4, 12)];
  assert.equal(text(resize(tall, 'B', 8, 6)), 'A0.4 B4.8x6 |  |  |  |  |  | Z0.12');
  // no room left in the row: then it goes to the next row
  const full = [cell('A', 0, 0, 4), cell('B', 4, 0, 4), cell('C', 8, 0, 4)];
  assert.equal(text(resize(full, 'C', 8, 1)), 'A0.4 C4.8 | B0.4');
});

test('a card pushed into a row with room makes the others shift along in order, not jump over each other', () => {
  const layout = [
    cell('P', 0, 0, 4),
    cell('Q', 4, 0, 4),
    cell('R', 8, 0, 4),
    cell('G', 0, 1, 4),
    cell('C', 4, 1, 4),
    cell('X', 0, 2, 3),
  ];
  assert.equal(text(place(layout, 'X', { x: 0, y: 0, w: 3, h: 1 })), 'X0.3 P3.4 Q7.4 | R0.4 G4.4 C8.4');
});

test('a card that lands in a free row gap moves in without pushing anything', () => {
  const layout = [cell('A', 0, 0, 4), cell('B', 8, 0, 4), cell('C', 0, 1, 4)];
  assert.deepEqual(snapDrop(layout, 'C', { x: 5, y: 0, w: 4, h: 1 }), { x: 4, y: 0 });
  assert.equal(text(place(layout, 'C', { x: 4, y: 0, w: 4, h: 1 })), 'A0.4 C4.4 B8.4');
});

test('rows left empty are removed; gaps inside a row stay', () => {
  assert.equal(text(removeEmptyRows([cell('A', 0, 0, 4), cell('B', 8, 3, 4)])), 'A0.4 | B8.4');
  assert.equal(text(place([cell('A', 0, 0, 12), cell('B', 0, 1, 6)], 'B', { x: 0, y: 2, w: 6, h: 1 })), 'A0.12 | B0.6');
});

test('a tall card keeps its rows free: cards beside it fit around it', () => {
  const layout = [cell('T', 0, 0, 6, 2), cell('A', 6, 0, 6), cell('B', 6, 1, 6), cell('C', 0, 2, 12)];
  const spot = findSpot(layout, 6, 1, 0, 0, 12);
  assert.deepEqual(spot, { x: 0, y: 3 });
  // growing A to two rows pushes B down past it, and C after B
  assert.equal(text(resize(layout, 'A', 6, 2)), 'T0.6x2 A6.6x2 |  | B0.6 | C0.12');
});

test('making a card wider pushes what no longer fits to the next row', () => {
  const layout = [cell('A', 0, 0, 4), cell('B', 4, 0, 4), cell('C', 8, 0, 4)];
  assert.equal(text(resize(layout, 'A', 6, 1)), 'A0.6 B6.4 | C0.4');
  // at the right edge, a wider card grows to the left and the card it now covers moves on
  assert.equal(text(resize(layout, 'C', 6, 1)), 'A0.4 C6.6 | B0.4');
});

test('sizes respect each card’s limits and the grid', () => {
  assert.deepEqual(fitSize({ minW: 3, maxW: 8 }, 1, 1), { w: 3, h: 1 });
  assert.deepEqual(fitSize({ minW: 3, maxW: 8 }, 11, 9), { w: 8, h: 6 });
  assert.deepEqual(fitSize({}, 20, 0), { w: 12, h: 1 });
});

test('arrow keys swap with a neighbour of the same size, or move one cell', () => {
  const layout = [cell('A', 0, 0, 6), cell('B', 6, 0, 4), cell('C', 0, 1, 3)];
  assert.equal(text(nudge(layout, 'B', -1, 0)), 'B0.4 A4.6 | C0.3');
  assert.equal(text(nudge(layout, 'A', 1, 0)), 'B0.4 A4.6 | C0.3');
  assert.equal(text(nudge(layout, 'C', 1, 0)), 'A0.6 B6.4 | C1.3');
  // up into a full row: the card takes the place and the cards in the way flow on
  assert.equal(text(nudge(layout, 'C', 0, -1)), 'C0.3 A3.6 | B0.4');
  // at an edge nothing happens
  assert.equal(nudge(layout, 'A', -1, 0), layout);
  assert.equal(nudge(layout, 'A', 0, -1), layout);
});

test('without a saved layout the cards flow in order; a saved one is kept', () => {
  const specs = [
    { id: 'k1', w: 3 },
    { id: 'k2', w: 3 },
    { id: 'hero', w: 8 },
    { id: 'side', w: 4 },
    { id: 'wide', w: 12 },
  ];
  assert.equal(text(arrange(specs, null)), 'k10.3 k23.3 | hero0.8 side8.4 | wide0.12');
  const saved = { wide: { x: 0, y: 0, w: 12, h: 1 }, hero: { x: 0, y: 1, w: 6, h: 2 } };
  // cards without a saved place fill the first free places that fit
  assert.equal(text(arrange(specs, saved)), 'wide0.12 | hero0.6x2 k16.3 k29.3 | side6.4');
});

test('a damaged saved layout (overlaps, out of range) is settled, never overlapping', () => {
  const specs = [{ id: 'a' }, { id: 'b' }, { id: 'c', minW: 4 }];
  const saved = { a: { x: 0, y: 0, w: 8, h: 1 }, b: { x: 4, y: 0, w: 8, h: 1 }, c: { x: 40, y: -3, w: 1, h: 99 } };
  const out = arrange(specs, saved);
  for (const p of out) {
    assert.ok(p.x >= 0 && p.x + p.w <= 12 && p.y >= 0, JSON.stringify(p));
    for (const q of out) {
      const hit = p !== q && p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
      assert.ok(!hit, `${p.id} overlaps ${q.id}`);
    }
  }
  assert.deepEqual(
    out.find(p => p.id === 'c'),
    { id: 'c', x: 8, y: 0, w: 4, h: 6 },
  );
});

test('saved layouts are cleaned when read from storage', async () => {
  const { normDB } = await import('../../src/models/db.js');
  const db = normDB({
    layouts: {
      overview: { due: { x: 11, y: 2.4, w: 6, h: 0 }, 'bad id!': { x: 0, y: 0, w: 1, h: 1 }, kpi: 'nonsense' },
      __proto__x: { a: { x: 0, y: 0, w: 1, h: 1 } },
      empty: {},
      other: { a: { x: 'x', y: -5, w: 99, h: 99 } },
    },
  });
  assert.deepEqual(db.layouts, {
    overview: { due: { x: 6, y: 2, w: 6, h: 1 } },
    other: { a: { x: 0, y: 0, w: 12, h: 6 } },
  });
  assert.deepEqual(normDB({ layouts: 'nope' }).layouts, {});
  assert.deepEqual(normDB(null).layouts, {});
});

test('a searched, filtered or sorted list flows in its order, keeping sizes; other cards keep their places', () => {
  const specs = [
    { id: 'total', w: 12 },
    { id: 'c', item: true, w: 4 },
    { id: 'a', item: true, w: 4 },
    { id: 'planner', w: 6 },
  ];
  const saved = {
    total: { x: 0, y: 0, w: 12, h: 1 },
    a: { x: 0, y: 1, w: 6, h: 1 },
    b: { x: 6, y: 1, w: 6, h: 1 },
    c: { x: 0, y: 2, w: 3, h: 1 },
    planner: { x: 6, y: 2, w: 6, h: 1 },
  };
  // b is filtered out and the order is c, a: no hole where b was, the planner stays put
  assert.equal(text(arrangeOrdered(specs, saved)), 'total0.12 | c0.3 a3.6 | planner6.6');
  // a search leaves only the last item: it moves to where the list starts, even though the first item is hidden
  assert.equal(text(arrangeOrdered([specs[0], { id: 'b', item: true }], saved, 12, ['planner'])), 'total0.12 | b0.6');
  // nothing saved: the same as the usual flow
  assert.equal(text(arrangeOrdered(specs, null)), text(arrange(specs, null)));
});

test('the Design mode switch is off unless turned on', async () => {
  const { normDB } = await import('../../src/models/db.js');
  assert.equal(normDB(null).designMode, false);
  assert.equal(normDB({}).designMode, false);
  assert.equal(normDB({ designMode: 'yes' }).designMode, false);
  assert.equal(normDB({ designMode: 1 }).designMode, false);
  assert.equal(normDB({ designMode: true }).designMode, true);
});
