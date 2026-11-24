/**
 * @file A bottom sheet, as on phones (Google Calendar's day card): it peeks up from the bottom over a dimmed page;
 * press and drag it up (or flick it) and it opens to nearly the whole screen with more details; drag it down and it
 * goes back to the peek, then away. A sideways swipe on it is handed to its owner (the calendar: the day before or
 * after). One sheet at a time. Every gesture has a button or key too: the owner draws them, Esc closes.
 *
 * Usage (components/calendar.js is the one user today):
 *   showSheet({
 *     owner: root,                 // the element it belongs to: when the page no longer has it, the sheet closes
 *     label: 'Tuesday 10 November',
 *     state: 'peek',               // 'peek' or 'full'
 *     render: state => ({ head, body }),  // what it shows in that state (drawn again when the state changes)
 *     onState: state => …,         // it moved to 'peek', 'full' or 'closed' (closed: it is gone)
 *     onSwipe: step => …,          // a sideways swipe: 1 the next (to the left), -1 the one before
 *     returnFocus: () => element,  // where the keyboard focus goes when it closes
 *   })
 * Calling it again while it is open updates it in place (no animation), so a page drawn again keeps its sheet.
 * From outside, a finger can pull it up: sheetFollow(height) while dragging, sheetRelease(speed) when let go.
 * The arithmetic (which way, where it settles) is core/gesture.js.
 */
import { $t } from '../../core/i18n.js';
import { axisOf, sheetSnap, swipeStep, velocity } from '../../core/gesture.js';
import { h } from '../dom.js';

let S = null;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Heights the sheet shows: the peek (under half the screen) and full (nearly all of it). */
function stops() {
  const vh = innerHeight;
  return { peek: Math.round(Math.max(240, Math.min(vh * 0.46, 420))), full: Math.round(vh * 0.9) };
}
/** Shows `height` px of the sheet (0: hidden below the screen). With `animate`, it glides there. */
function place(height, animate) {
  const full = stops().full;
  S.el.style.setProperty('--sheet-full', full + 'px');
  S.el.classList.toggle('dragging', !animate);
  S.el.style.transform = `translateY(${Math.max(0, full - Math.max(0, height))}px)`;
  S.scrim.style.opacity = String(Math.min(1, height / Math.max(1, stops().peek)));
}
function draw() {
  const { head, body } = S.o.render(S.state);
  S.head.replaceChildren(h('i', { class: 'sheet-handle', 'aria-hidden': 'true' }), ...[head].flat().filter(Boolean));
  // a new list starts at the top: a fresh element does, where setting scrollTop would force a layout on every draw
  const fresh = h('div', { class: 'sheet-body' }, ...[body].flat().filter(Boolean));
  S.body.replaceWith(fresh);
  S.body = fresh;
  S.el.dataset.state = S.state;
  S.el.setAttribute('aria-label', S.o.label);
}
/**
 * Moves the open sheet to 'peek', 'full' or 'closed', with its glide.
 * @returns {void}
 */
export function setSheet(state) {
  if (!S) {
    return;
  }
  if (state === 'closed') {
    closeSheet();
    return;
  }
  const changed = state !== S.state;
  S.state = state;
  if (changed) {
    draw();
    S.o.onState?.(state);
  }
  place(stops()[state], true);
}

/**
 * Opens the sheet, or updates the open one. See the top of this file.
 * @returns {void}
 */
export function showSheet(o) {
  if (S) {
    S.o = o;
    S.state = o.state === 'full' ? 'full' : 'peek';
    draw();
    if (!S.dragging) {
      place(stops()[S.state], false);
      requestAnimationFrame(() => S && S.el.classList.remove('dragging'));
    }
    return;
  }
  const scrim = h('div', { class: 'sheet-scrim', onclick: () => closeSheet() });
  const head = h('div', { class: 'sheet-grab' });
  const body = h('div', { class: 'sheet-body' });
  const el = h(
    'section',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: -1, onkeydown: onKey },
    h('div', { class: 'sheet-in' }, head, body),
  );
  S = { o, el, scrim, head, body, state: o.state === 'full' ? 'full' : 'peek', dragging: false };
  draw();
  document.body.append(scrim, el);
  document.documentElement.classList.add('sheet-lock');
  // it rises from below the screen (an animation from there: no layout has to be forced to start a transition)
  place(stops()[S.state], false);
  if (!reduced() && el.animate) {
    const easing = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
    el.animate([{ transform: 'translateY(100%)' }, { transform: el.style.transform }], { duration: 240, easing });
    scrim.animate([{ opacity: 0 }, { opacity: scrim.style.opacity }], { duration: 240 });
  }
  requestAnimationFrame(() => S && S.el === el && !S.dragging && el.classList.remove('dragging'));
  el.addEventListener('pointerdown', onDown);
  el.focus({ preventScroll: true });
  watchOwner();
  addEventListener('resize', onResize);
}

/**
 * Closes the sheet (it slides down), gives the focus back and tells the owner.
 * @returns {void}
 */
export function closeSheet() {
  if (!S) {
    return;
  }
  const { el, scrim, o } = S;
  S = null;
  document.documentElement.classList.remove('sheet-lock');
  removeEventListener('resize', onResize);
  if (ownerWatch) {
    ownerWatch.disconnect();
    ownerWatch = null;
  }
  const gone = () => {
    el.remove();
    scrim.remove();
  };
  // while it slides away, taps go to the page again (a quick tap on another day is not lost)
  el.classList.add('closing');
  scrim.classList.add('closing');
  if (reduced()) {
    gone();
  } else {
    el.classList.remove('dragging');
    el.style.transform = 'translateY(100%)';
    scrim.style.opacity = '0';
    setTimeout(gone, 220);
  }
  const target = o.returnFocus ? o.returnFocus() : null;
  if (target && target.isConnected) {
    target.focus({ preventScroll: true });
  }
  o.onState?.('closed');
}
/**
 * The state of the open sheet ('peek' or 'full'), or null.
 * @returns {'peek'|'full'|null}
 */
export const sheetState = () => (S ? S.state : null);

/**
 * From outside (a finger that pressed a day and swipes up): the sheet shows `height` px, following the finger.
 * @returns {void}
 */
export function sheetFollow(height) {
  if (S) {
    S.dragging = true;
    place(Math.min(height, stops().full), false);
  }
}
/**
 * The finger that pulled it from outside is let go at `height` px with `speed` (px/ms, up positive): it settles, at
 * least at the peek: whoever held a day and pulled it up asked to see it (a tap on the dimmed page closes it).
 * @returns {void}
 */
export function sheetRelease(height, speed) {
  if (!S) {
    return;
  }
  S.dragging = false;
  const to = sheetSnap(height, speed, stops());
  setSheet(to === 'closed' ? 'peek' : to);
}

/* --- the page drawn again without its owner (another page): the sheet goes with it --- */
let ownerWatch = null;
function watchOwner() {
  const main = document.getElementById('main');
  if (!main || ownerWatch) {
    return;
  }
  ownerWatch = new MutationObserver(() =>
    queueMicrotask(() => {
      if (S && !S.o.owner.isConnected) {
        closeSheet();
      }
    }),
  );
  ownerWatch.observe(main, { childList: true });
}
function onResize() {
  if (S && !S.dragging) {
    place(stops()[S.state], false);
  }
}

/* --- keys: Esc closes; Tab stays inside while it is open --- */
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeSheet();
  } else if (e.key === 'Tab') {
    const items = [...S.el.querySelectorAll('button, [href], input, select, textarea, [tabindex="0"]')].filter(
      x => !x.disabled && x.offsetParent !== null,
    );
    if (!items.length) {
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === S.el)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

/* --- a finger (or a mouse, on the grab bar) on the sheet --- */
function onDown(e) {
  if (!S || (e.pointerType === 'mouse' && (e.button !== 0 || !S.head.contains(e.target)))) {
    return;
  }
  const sheet = S;
  const fromHead = sheet.head.contains(e.target);
  const x0 = e.clientX;
  const y0 = e.clientY;
  const t0 = performance.now();
  const h0 = stops()[sheet.state];
  const samples = [{ t: t0, v: h0 }];
  let axis = null;
  const width = sheet.el.clientWidth;
  const move = ev => {
    if (ev.pointerId !== e.pointerId || S !== sheet) {
      return;
    }
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!axis) {
      axis = axisOf(dx, dy);
      // in full, the list scrolls: only the grab bar pulls the sheet down
      if (axis === 'y' && sheet.state === 'full' && !fromHead) {
        return stop();
      }
      if (axis) {
        sheet.el.setPointerCapture?.(e.pointerId);
        sheet.dragging = true;
      }
    }
    if (axis === 'y') {
      const height = h0 - dy;
      samples.push({ t: performance.now(), v: height });
      place(Math.min(height, stops().full + 24), false);
    } else if (axis === 'x') {
      sheet.el.querySelector('.sheet-in').style.transform = `translateX(${dx}px)`;
    }
  };
  const up = ev => {
    if (ev.pointerId !== e.pointerId) {
      return;
    }
    stop();
    if (S !== sheet || !axis) {
      return;
    }
    // a drag is not a click on what it started on
    addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener('click', swallow, { capture: true }), 0);
    sheet.dragging = false;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (axis === 'y') {
      setSheet(sheetSnap(h0 - dy, velocity(samples), stops()));
      return;
    }
    const inner = sheet.el.querySelector('.sheet-in');
    const step = swipeStep(dx, performance.now() - t0, width);
    inner.style.transform = '';
    if (step) {
      slideIn(inner, step);
      sheet.o.onSwipe?.(step);
    }
  };
  const stop = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}
const swallow = e => {
  e.stopPropagation();
  e.preventDefault();
};
/** What comes after a sideways swipe slides in from that side. */
function slideIn(el, step) {
  if (!reduced() && el.animate) {
    el.animate(
      [
        { transform: `translateX(${step * 30}%)`, opacity: 0.2 },
        { transform: 'none', opacity: 1 },
      ],
      {
        duration: 200,
        easing: 'ease-out',
      },
    );
  }
}

/**
 * The label of the grab bar's button for people who cannot drag: more or fewer details.
 * @returns {string}
 */
export const sheetToggleLabel = state => (state === 'full' ? $t('Fewer details') : $t('More details'));
