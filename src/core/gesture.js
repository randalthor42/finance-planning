/**
 * @file The arithmetic of touch gestures: which way a finger goes, whether a swipe changes the month, where a bottom
 * sheet settles. Pure: the pages' pointer and touch code (ui/components/gestures.js, sheet.js) asks these.
 * Distances are CSS pixels, times milliseconds, velocities pixels per millisecond.
 */

/** How far a finger moves before its direction is decided (a tap wobbles a few pixels). */
export const SLOP = 10;

/**
 * 'x' or 'y' once the finger has moved more than SLOP, null before. Sideways only when clearly sideways: a diagonal
 * move stays vertical, so the page keeps scrolling as the person expects.
 * @returns {'x'|'y'|null} the axis of the move, or null while it is within `slop`
 */
export function axisOf(dx, dy, slop = SLOP) {
  if (Math.hypot(dx, dy) < slop) {
    return null;
  }
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
}

/**
 * Where a sideways swipe of `dx` over `dt` ms on something `width` wide goes: 1 the next (a swipe to the left), -1
 * the one before, 0 back. Far enough (a quarter of the width) or fast enough (a flick) decides.
 * @returns {1|-1|0} the step to take: next, before, or back
 */
export function swipeStep(dx, dt, width) {
  const far = Math.abs(dx) > width * 0.25;
  const quick = Math.abs(dx) > 24 && Math.abs(dx) / Math.max(dt, 1) > 0.45;
  if (!far && !quick) {
    return 0;
  }
  return dx < 0 ? 1 : -1;
}

/**
 * A drag towards something that is not there (before the first month): it follows the finger a third as much.
 * @returns {number} how far it moves: `d`, or a third of it when there is nothing that way
 */
export const resist = (d, canGo) => (canGo ? d : d / 3);

/**
 * Speed at the end of a drag, from samples [{ t, v }] (time and position): over the last 100 ms, so a drag that
 * stopped before it was let go has no speed left. 0 with fewer than two samples.
 * @returns {number} px per ms (positive when the position grows), 0 without enough samples
 */
export function velocity(samples) {
  if (samples.length < 2) {
    return 0;
  }
  const last = samples[samples.length - 1];
  const first = samples.find(s => last.t - s.t <= 100) || samples[0];
  const dt = last.t - first.t;
  return dt > 0 ? (last.v - first.v) / dt : 0;
}

/**
 * Where a bottom sheet let go at `height` (px shown) with `speed` (px/ms, up is positive) settles: 'closed', 'peek'
 * or 'full' (`stops`: the heights of peek and full). A fling goes one stop that way; otherwise the nearest stop,
 * closing only when it is pulled well below the peek.
 * @returns {'closed'|'peek'|'full'} where the sheet settles
 */
export function sheetSnap(height, speed, stops) {
  const h = Math.min(height, stops.full);
  if (speed > 0.5) {
    return h >= stops.peek * 0.9 ? 'full' : 'peek';
  }
  if (speed < -0.5) {
    return h > stops.peek * 1.1 ? 'peek' : 'closed';
  }
  if (h < stops.peek * 0.6) {
    return 'closed';
  }
  return h - stops.peek > (stops.full - stops.peek) / 2 ? 'full' : 'peek';
}
