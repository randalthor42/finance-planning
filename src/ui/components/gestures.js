/**
 * @file Touch gestures on a calendar grid, as on a phone calendar (Google Calendar):
 *   - swipe sideways: the grid follows the finger, then the next or previous month comes (or it springs back);
 *   - press and hold a day, then swipe up: that day's details rise from the bottom with the finger (sheet.js).
 * A vertical swipe without holding scrolls the page as usual (touch-action: pan-y), and a tap stays a tap. Only
 * fingers and pens: a mouse has the buttons. The arithmetic is core/gesture.js; what happens is the caller's.
 *
 *   gridGestures(el, {
 *     canStep: step => boolean,            // is there a month that way (1 next, -1 before)?
 *     onSwipe: (dx, width) => …,           // the finger moved sideways by dx: move the grid
 *     onSwipeEnd: (step, width) => …,      // let go: step 1, -1 or 0 (spring back)
 *     hold: target => day | null,          // the day under a finger that holds (null: nothing to hold there)
 *     onHold: day => …,                    // the day is held (give it a lift)
 *     onPull: (day, height) => …,          // held and swiped up by `height` px
 *     onPullEnd: (day, height, speed) => …,// let go (speed in px/ms, up positive)
 *     onHoldCancel: day => …,              // held, then moved away or let go without swiping up
 *   })
 */
import { SLOP, axisOf, resist, swipeStep, velocity } from '../../core/gesture.js';

/** How long a finger stays still before it holds (shorter than the browser's long press, which opens the menu). */
export const HOLD_MS = 260;

/**
 * Adds the swipe and hold-then-pull gestures to the calendar grid `el` (the options are at the top of this file).
 * @param {HTMLElement} el the grid
 * @param {object} o what to do on each gesture
 * @returns {void} nothing: the listeners stay on `el` (and on the window only while a finger is down)
 */
export function gridGestures(el, o) {
  let g = null; // the gesture in progress
  const end = () => {
    clearTimeout(g && g.timer);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', cancel);
    g = null;
  };
  const down = e => {
    if (e.pointerType === 'mouse' || !e.isPrimary || g) {
      return;
    }
    const day = o.hold ? o.hold(e.target) : null;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), axis: null, held: false, day };
    g.samples = [{ t: g.t0, v: 0 }];
    if (day !== null && day !== undefined) {
      g.timer = setTimeout(() => {
        if (g && !g.axis) {
          g.held = true;
          o.onHold?.(day);
          navigator.vibrate?.(8);
        }
      }, HOLD_MS);
    }
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  };
  const move = e => {
    if (!g || e.pointerId !== g.id) {
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (g.held) {
      // held: swiping up pulls the day's details; any other way lets it go
      if (!g.pulling && Math.hypot(dx, dy) > SLOP) {
        if (dy < 0 && Math.abs(dy) > Math.abs(dx)) {
          g.pulling = true;
        } else {
          o.onHoldCancel?.(g.day);
          return end();
        }
      }
      if (g.pulling) {
        g.samples.push({ t: performance.now(), v: -dy });
        o.onPull?.(g.day, Math.max(0, -dy));
      }
      return;
    }
    if (!g.axis) {
      g.axis = axisOf(dx, dy);
      if (g.axis) {
        clearTimeout(g.timer);
      }
      if (g.axis === 'y') {
        return end(); // the page scrolls
      }
      if (g.axis === 'x') {
        g.width = el.clientWidth || 1;
        el.setPointerCapture?.(g.id);
      }
    }
    if (g.axis === 'x') {
      o.onSwipe?.(resist(dx, o.canStep(dx < 0 ? 1 : -1)), g.width);
    }
  };
  const up = e => {
    if (!g || e.pointerId !== g.id) {
      return;
    }
    const gesture = g;
    end();
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;
    if (gesture.held) {
      swallowClick();
      if (gesture.pulling) {
        o.onPullEnd?.(gesture.day, Math.max(0, -dy), velocity(gesture.samples));
      } else {
        o.onHoldCancel?.(gesture.day);
      }
      return;
    }
    if (gesture.axis === 'x') {
      swallowClick();
      const step = swipeStep(dx, performance.now() - gesture.t0, gesture.width);
      o.onSwipeEnd?.(step && o.canStep(step) ? step : 0, gesture.width);
    }
  };
  const cancel = e => {
    if (!g || e.pointerId !== g.id) {
      return;
    }
    const gesture = g;
    end();
    if (gesture.axis === 'x') {
      o.onSwipeEnd?.(0, gesture.width);
    } else if (gesture.held) {
      o.onHoldCancel?.(gesture.day);
    }
  };
  el.addEventListener('pointerdown', down);
  // The moves of a gesture of ours are ours: a held day must not scroll the page under the finger that pulls it,
  // and a sideways swipe must not leave the browser a fling of its own, which would swallow the next tap (a day
  // tapped right after changing month). A vertical swipe is never cancelled: the page scrolls as usual.
  el.addEventListener(
    'touchmove',
    e => {
      if (g && (g.held || g.axis === 'x') && e.cancelable) {
        e.preventDefault();
      }
    },
    { passive: false },
  );
  // a long press opens the day's menu on some phones: not when the press became a pull
  el.addEventListener(
    'contextmenu',
    e => {
      if (g && (g.pulling || g.axis)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}
/** The click that ends a swipe or a pull is not a tap on the day under it. */
function swallowClick() {
  const swallow = e => {
    e.stopPropagation();
    e.preventDefault();
  };
  addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => removeEventListener('click', swallow, { capture: true }), 0);
}
