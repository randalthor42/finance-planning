/**
 * @file Calendar: dated money on a month grid. Three densities (v0.9 audit, 6.3); the PAGE chooses one:
 *   full     the Month planner on a wide screen: each day lists its lines with amounts, trips are bars across the days,
 *            the chosen day's lines below the grid
 *   compact  the Month planner on a tablet or phone: from 600 px of calendar width the grid with names and the day's
 *            net, narrower a grid of dots (cells at least 44 px) with the day's or the month's lines underneath
 *   mini     a small month in a card (the Overview): dots and the status colour of each day only
 * Inside, compact is drawn by two renderers ("tablet" and "mobile", by width); the page never picks those.
 * It knows nothing about the plan: a page hands it events. calendarData.js has ready-made events for the plan, and
 * agendaData.js the person's own calendar (appointments with times, tentative drafts).
 * The arithmetic (weeks, spans, totals) is in logic/calendar.js; this file only draws.
 *
 * Usage:
 *   calendar({
 *     id: 'bills-cal',                      // remembers month, day, layout and filters for this visit
 *     events: [{ id: 'rent', title: 'Rent', date: '2026-11-02', amount: -820, group: 'bill' }],
 *     groups: [{ key: 'bill', label: $t('Bills'), tone: 'bad' }],
 *     onEvent: ev => …,
 *   })
 *   calendar({ ...planCalendar(), id: 'overview-cal', mode: 'mini' })      // the plan (calendarData.js)
 *
 * Options (only `id` is required; use one id per calendar on screen, it keys the state in UI.calendars):
 *   mode         'full' | 'compact' | 'mini' (CAL_MODES). Default 'full'. Chosen by the page, never by the calendar.
 *   modes        densities the person may switch between, e.g. ['full', 'compact']. Omit for no switch.
 *   events       an array of events (types.js CalendarEvent), or a function of the days drawn that returns one.
 *                An event with a `time` ('09:30') shows it before its title, and `timeText` ('09:30–10:15') in lists;
 *                a `tentative` one (not certain yet: a draft) is drawn dashed and its money is not added up in
 *                the month's figures or a day's net (logic/calendar.js totals). Either way:
 *                ({ k, start, end, from, to }) => events. k is the month, start…end its days, from…to the whole grid.
 *                It is asked once per month shown and the answer is kept while the calendar is on the page (redraw
 *                the page when the data changes: App.render does, after every change to the plan).
 *   groups       [{ key, label, tone?, color? }]: legend, colours and on/off filters, in this order.
 *                tone: good, bad, warn, acc, cash, save, debt, trip, wish, muted. color: any CSS colour, wins over tone.
 *                An event may carry its own tone or color too.
 *   month        month (M.parse) to show, set by the page: change it in onNavigate. Leave it out and the calendar
 *                remembers its own month.
 *   initial      the month to start on when `month` is left out. Default: the month of `today`.
 *   selected     day number chosen by the page (null for none); otherwise the calendar remembers the day chosen.
 *   min, max     first and last month one can page to.
 *   period       k => ({ start, end }): the days of "month" k, for months that run from payday to payday.
 *   title        (k, range) => text of the header. Default "November 2026", with the dates when they differ.
 *   weekStart    0 Sunday … 6 Saturday. Default 1 (Monday).
 *   fixedWeeks   always six rows, so the height does not jump when paging.
 *   today        day number (D.today()) to mark.
 *   maxChips     lines shown in a day in the full layout before "+2 more" (tablet: at most 2). Default 3.
 *   header       show the title and ‹ Today ›. Default true; false when the page has its own month controls.
 *   legend       show the groups as on/off filters. Default true, false in mini.
 *   summary      show money in, out and net of the month (only the figures that are not zero). Default true.
 *   monthList    mobile: list the whole month under the grid while no day is chosen. Default true.
 *   listPage     that list draws whole days up to about this many lines, then "Show 150 more". Default 150.
 *                With the sheet, the phone keeps this list under the grid while a day is open.
 *   dayInfo      (day, mode, events) => ({ text, tone, title, panel? }) | null: one figure per day (a balance, what
 *                was spent) and its colour. `events` are that day's events still shown after the legend filters.
 *                panel: false leaves it out of the day panel (when it would repeat the day's total there).
 *   dayExtra     (day, mode) => node | null: anything else to draw at the bottom of a day.
 *   eventContent (ev, mode) => node | string: what a line shows in the grid instead of its title and amount.
 *   onEvent      ev => …: a line was clicked. Without it, or when it returns false, the click chooses the line's day.
 *   onSelect     day | null => …: a day was chosen, or unchosen.
 *   onNavigate   k => …: another month is shown.
 *   onAdd        day => …: shows "+" on the days and in the day panel.
 *   dayMenu      day => [[label, fn, className?], …]: the context menu of a day (right click, the menu key or
 *                Shift+F10 on a focused day, a long press on Android). "+" and Add in the day panel open it too, in
 *                place of onAdd. Return [] for days that have no menu. className 'danger' draws a deleting item red.
 *   eventMenu    ev => [[label, fn, className?], …]: the context menu of a line, in the grid and in the day panel,
 *                where each line also gets a "⋯" button for touch screens and the keyboard.
 *   sheet        on a tablet or phone (compact), a chosen day opens in a bottom sheet, as in Google Calendar: it peeks
 *                up with the day's lines; press and drag it up (or "More details") for every detail and action of
 *                each line; swipe it sideways for the day before or after; drag it down to close. Default true.
 *                Without it, the day is listed under the grid as on a wide screen.
 *   swipe        with a finger: swipe the grid sideways to change month; with the sheet, press and hold a day then
 *                swipe up to pull its details up. Default true. (A mouse uses the buttons and menus.)
 *   defer        the first time this calendar is drawn in the visit, draw it just after the page is painted (it keeps
 *                about its height meanwhile). For a calendar further down a page; later redraws are immediate.
 *   label        accessible name of the grid. Default: the title.
 *   className    extra class on the calendar.
 */
import { D, M } from '../../core/dates.js';
import { compact, money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import {
  calendarWeeks,
  eventsIn,
  eventsOn,
  lastDay,
  layoutEvents,
  monthRange,
  normEvents,
  totals,
  weekPos,
} from '../../logic/calendar.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { UI } from '../state.js';
import { btn, ibtn } from './button.js';
import { amt, row } from './layout.js';
import { gridGestures } from './gestures.js';
import { closePop, ctxMenu, popover } from './popover.js';
import { closeSheet, setSheet, sheetFollow, sheetRelease, sheetState, sheetToggleLabel, showSheet } from './sheet.js';

/** The densities a page can choose (audit 6.3), in the order of the switch. */
export const CAL_MODES = ['full', 'compact', 'mini'];
const MODE_LABELS = {
  full: $t('Full'),
  compact: $t('Compact'),
  mini: $t('Mini'),
};
const TONES = new Set(['good', 'bad', 'warn', 'acc', 'cash', 'save', 'debt', 'trip', 'wish', 'muted']);
/** A colour from the page goes into a style attribute: allow colour syntax only, never a second declaration. */
const COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,60}$/;
/** How the compact density is drawn at a width (px) of the calendar: names and nets, or dots and an agenda (6.4). */
const FIT = [
  [600, 'tablet'],
  [0, 'mobile'],
];
const fitFor = width => FIT.find(([min]) => width >= min)[1];

/** Lines drawn in the sheet's peek: about what it shows (it does not scroll; "N more" opens every detail). */
const PEEK_LINES = 6;
/** The id of the calendar whose chosen day is open in the bottom sheet (there is one sheet at a time). */
let sheetCal = null;
/**
 * The sheet is being closed by a calendar itself (the window got wider, the day left the grid), not by the person:
 * the day stays chosen. Shared, because the sheet may still answer to the calendar drawn before this one.
 */
let quietClose = false;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The state of one calendar for this visit, created the first time. */
export function calendarState(id) {
  if (!UI.calendars[id]) {
    UI.calendars[id] = {
      k: null,
      sel: null,
      focus: null,
      mode: null,
      fit: null,
      hidden: new Set(),
      listLimit: null,
      drawn: false, // drawn once in this visit (see the defer option)
      sheet: null, // the chosen day is open in the bottom sheet: 'peek' or 'full' (see the sheet option)
      enter: 0, // the month came from a swipe: the new grid slides in from that side (1 from the right)
    };
  }
  return UI.calendars[id];
}

/* One observer for every calendar in "auto": it reports the width each one gets. */
const fitters = new WeakMap();
let observer = null;
function watchWidth(root, fit) {
  if (typeof ResizeObserver !== 'function') {
    return;
  }
  if (!observer) {
    observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (!entry.target.isConnected) {
          // the page was redrawn without it: stop watching so it can be freed
          observer.unobserve(entry.target);
          fitters.delete(entry.target);
          continue;
        }
        const fn = fitters.get(entry.target);
        const width = entry.contentRect.width;
        // redrawing inside the callback would change the size again in the same frame ("ResizeObserver loop" error)
        if (fn) {
          requestAnimationFrame(() => fn(width));
        }
      }
    });
  }
  fitters.set(root, fit);
  observer.observe(root);
}

/** Amounts in a small cell: exact below 10 000, "+12K" above. */
function short(n) {
  if (Math.abs(n) < 10000) {
    return signed(n);
  }
  return (n > 0 ? '+' : '') + compact(n);
}
const weekday = (n, width) => D.fmt(n, { weekday: width });
/** The day an arrow, Home or End key moves to from day n, or null for any other key. */
function keyTarget(key, n, moves, weekStart) {
  if (moves[key]) {
    return n + moves[key];
  }
  if (key === 'Home') {
    return n - weekPos(n, weekStart);
  }
  if (key === 'End') {
    return n + 6 - weekPos(n, weekStart);
  }
  return null;
}
const longDay = n => D.label(n, { weekday: 'long', month: 'long' });
/**
 * What a screen reader says for a day: whole sentences, each translated on its own, with the status of the day in
 * words as well as in colour ("Below zero.", "Under your cushion."), and the day's markers (payday, lowest day…).
 * It starts with the day as it is shown (`shown`: "2", or "26 Oct" where a month starts). A day's lines are buttons of
 * their own with their own names; the day's label sums them up rather than repeating each (a grid read day by day
 * would otherwise read every line on every arrow key), which axe's "label in name" heuristic reports on days that
 * have lines: reviewed, on purpose (see README, Accessibility).
 */
function dayLabel(n, today, list, t, info, shown) {
  // the label contains what the day shows ("26 Oct" where a month starts), so speech input ("click 26 Oct") finds it
  const parts = [shown.includes(' ') ? $t('{0}, {1}.', shown, D.fmt(n, { weekday: 'long' })) : longDay(n) + '.'];
  if (n === today) {
    parts.push($t('Today.'));
  }
  if (list.length) {
    parts.push($t('{0}: {1} in, {2} out.', plural(list.length, 'item'), money(t.in), money(t.out)));
  }
  if (info && (info.title || info.text)) {
    parts.push(info.title || info.text);
  }
  if (info && info.tone === 'bad') {
    parts.push($t('Below zero.'));
  } else if (info && info.tone === 'warn') {
    parts.push($t('Under your cushion.'));
  }
  for (const mark of (info && info.marks) || []) {
    parts.push(mark.title);
  }
  return parts.join(' ');
}

/**
 * Draws a calendar. Returns its element; month, day and layout changes redraw only the calendar, not the page.
 * @param {object} options see the top of this file
 */
/**
 * The month of a mini calendar in one figure: the net when there is money in and out, else the one that there is.
 * @returns {?{text: string, tone: string}} null when the month moves no money
 */
function oneFigure(sum) {
  if (sum.in && sum.out) {
    return { text: $t('Net {0}', signed(sum.net)), tone: sum.net < 0 ? 'bad' : 'good' };
  }
  if (sum.in) {
    return { text: $t('In {0}', signed(sum.in)), tone: 'good' };
  }
  if (sum.out) {
    return { text: $t('Out {0}', money(-sum.out)), tone: '' };
  }
  return null;
}

export function calendar(options) {
  const o = {
    mode: 'full',
    weekStart: 1,
    maxChips: 3,
    header: true,
    summary: true,
    monthList: true,
    listPage: 150,
    sheet: true,
    swipe: true,
    ...options,
  };
  const state = calendarState(o.id);
  const today = o.today ?? D.today();
  const rangeOf = k => (o.period ? o.period(k) : monthRange(k));
  const inBounds = k => (o.min == null || k >= o.min) && (o.max == null || k <= o.max);
  /** The month whose days include day n (with payday months that can be the month before or after). */
  const periodOf = n => {
    let k = D.month(n);
    for (let i = 0; i < 24 && rangeOf(k).start > n; i++) {
      k--;
    }
    for (let i = 0; i < 24 && rangeOf(k).end < n; i++) {
      k++;
    }
    return k;
  };
  if (o.month != null) {
    if (state.k !== null && state.k !== o.month) {
      state.sel = null;
      state.focus = null;
      state.listLimit = null;
    }
    state.k = o.month;
  } else if (state.k === null) {
    state.k = o.initial ?? periodOf(today);
  }
  if (o.min != null || o.max != null) {
    state.k = clamp(state.k, o.min ?? -Infinity, o.max ?? Infinity);
  }
  if (o.selected !== undefined) {
    state.sel = o.selected;
  }
  const groups = new Map((o.groups || []).map(g => [g.key, g]));
  const root = h('div', { class: ('cal ' + (o.className || '')).trim(), 'data-cal': o.id });

  const chosenMode = () => state.mode || o.mode || 'full';
  /** The layout comes from a guess, not from a width measured earlier: it is checked as soon as it is on the page. */
  let guessed = false;
  /** The renderer for the density the page chose: full and mini as they are, compact by the calendar's width. */
  const currentMode = () => {
    const chosen = chosenMode();
    if (chosen !== 'compact') {
      return chosen === 'mini' ? 'mini' : 'full';
    }
    if (!state.fit) {
      // a first guess from the page width; corrected before the first paint once the calendar is on the page
      guessed = true;
      const main = document.getElementById('main');
      state.fit = fitFor((main && main.clientWidth) || innerWidth);
    }
    return state.fit;
  };
  const fit = width => {
    // a calendar the page has already replaced must not change the state its successor uses
    if (width <= 0 || !root.isConnected) {
      return;
    }
    state.fit = fitFor(width);
    // compare with what this calendar drew, not with the shared state: it may have been drawn with an older guess.
    // Not drawn yet (a deferred first drawing): it will use this width when it is drawn.
    if (chosenMode() === 'compact' && root.dataset.mode && root.dataset.mode !== state.fit) {
      draw();
    }
  };

  /**
   * The events of month k, cleaned, kept for this calendar: choosing a day, a filter or "Show more" redraws it without
   * asking the page again. A change to the data redraws the page, which makes a new calendar (and a new cache). The
   * days drawn around month k only depend on options of this calendar, so k is enough as the key.
   */
  const cache = new Map();
  const eventsFor = (k, days) => {
    if (!cache.has(k)) {
      if (cache.size > 3) {
        cache.delete(cache.keys().next().value); // the oldest month paged through
      }
      cache.set(k, normEvents(typeof o.events === 'function' ? o.events(days) : o.events));
    }
    return cache.get(k);
  };

  /** Colour class and style of an event or a group. */
  const look = ev => {
    const g = groups.get(ev.group) || {};
    const tone = ev.tone || g.tone;
    const color = ev.color || g.color;
    return {
      class: ' cal-c-' + (TONES.has(tone) ? tone : 'acc'),
      style: typeof color === 'string' && COLOR.test(color) ? '--cal-c:' + color : null,
    };
  };
  const dot = ev => {
    const l = look(ev);
    return h('i', {
      class: 'cal-dot' + l.class + (ev.tentative ? ' tentative' : ''),
      style: l.style,
      'aria-hidden': 'true',
    });
  };
  const tip = ev =>
    [
      ev.timeText || ev.time,
      ev.title,
      ev.amount !== null ? signed(ev.amount) : '',
      ev.sub,
      (groups.get(ev.group) || {}).label,
    ]
      .filter(Boolean)
      .join(' · ');

  /** The days on screen and what is under the grid, so that choosing a day only changes those (see choose). */
  let onScreen = null;

  /* --- what the person can do --- */
  const draw = focusKey => {
    const active = document.activeElement;
    const keep = focusKey || (active && root.contains(active) ? active.dataset.focus : null);
    build();
    if (keep) {
      const target = root.querySelector(`[data-focus="${CSS.escape(keep)}"]`);
      if (target) {
        target.focus();
      }
    }
  };
  /** Tells the page about the new month. When the page redraws itself for it, the focus moves to the new calendar. */
  const announce = k => {
    if (!o.onNavigate) {
      return;
    }
    const active = document.activeElement;
    const focusKey = active && root.contains(active) ? active.dataset.focus : null;
    o.onNavigate(k);
    if (focusKey && !root.isConnected) {
      const twin = document.querySelector(`[data-cal="${CSS.escape(o.id)}"] [data-focus="${CSS.escape(focusKey)}"]`);
      if (twin) {
        twin.focus();
      }
    }
  };
  const navigate = (k, focusDay) => {
    if (!inBounds(k)) {
      return;
    }
    state.k = k;
    state.sel = null;
    state.focus = focusDay ?? null;
    state.listLimit = null;
    draw(focusDay != null ? 'day:' + focusDay : null);
    announce(k);
  };
  const select = n => {
    const range = rangeOf(state.k);
    if (n < range.start || n > range.end) {
      // a day of the month before or after: show that month with the day chosen
      const k = periodOf(n);
      if (!inBounds(k)) {
        return;
      }
      state.k = k;
      state.sel = n;
      state.focus = n;
      state.listLimit = null;
      draw('day:' + n);
      announce(k);
    } else {
      choose(state.sel === n ? null : n, n);
    }
    if (o.onSelect) {
      o.onSelect(state.sel);
    }
  };
  /**
   * Chooses day `day` (or none) in the month drawn: only the two days and what is under the grid change, the rest of
   * the calendar stays as it is. `at` is the day that keeps the keyboard focus.
   */
  const choose = (day, at) => {
    const before = state.sel;
    state.sel = day;
    state.focus = at;
    if (!onScreen || at < onScreen.from || at > onScreen.to) {
      draw();
      return;
    }
    const cellOf = n => (n === null ? null : root.querySelector(`.cal-d[data-day="${n}"]`));
    const old = cellOf(before);
    if (old) {
      old.classList.remove('sel');
      old.setAttribute('aria-selected', 'false');
    }
    const now = cellOf(day);
    if (now) {
      now.classList.add('sel');
      now.setAttribute('aria-selected', 'true');
    }
    for (const other of root.querySelectorAll('.cal-d[tabindex="0"]')) {
      other.tabIndex = -1;
    }
    const focusCell = cellOf(at);
    if (focusCell) {
      focusCell.tabIndex = 0;
    }
    // with the sheet, the day opens in it (or it closes); what is under the grid does not follow the chosen day
    if (onScreen.sheet) {
      if (day === null) {
        if (sheetCal === o.id && sheetState()) {
          closeSheet();
        }
        state.sheet = null;
      } else {
        state.sheet = state.sheet || 'peek';
        onScreen.showDay(day);
      }
      return;
    }
    // the focus was in what goes away (Close the day): it goes to the day instead of being lost
    const lost = onScreen.below && onScreen.below.contains(document.activeElement);
    const next = onScreen.belowFor(day);
    if (onScreen.below && next) {
      onScreen.below.replaceWith(next);
    } else if (onScreen.below) {
      onScreen.below.remove();
    } else if (next) {
      root.append(next);
    }
    onScreen.below = next;
    if (lost && focusCell) {
      focusCell.focus();
    }
  };
  /** A click on a line: the page's onEvent, or choosing its day when there is none (or it returns false). */
  const openEvent = (ev, n) => {
    if (o.onEvent && o.onEvent(ev) !== false) {
      return;
    }
    if (n !== null && n !== undefined) {
      select(n);
    }
  };
  /** Opens a context menu when there is something in it; otherwise the browser's own menu stays. */
  const openMenu = (e, items) => {
    const list = (items || []).filter(Boolean);
    // titles and dividing lines alone are not a menu
    if (!list.some(Array.isArray)) {
      return false;
    }
    ctxMenu(e, list);
    return true;
  };
  const eventMenuOf = (e, ev) => {
    if (o.eventMenu && openMenu(e, o.eventMenu(ev))) {
      // the day under the line must not open its own menu as well
      e.stopPropagation();
    }
  };
  /** Arrow keys move between days, Home/End to the ends of the week, Page Up/Down change month, Enter chooses. */
  const onKey = e => {
    const cell = e.target;
    if (!cell.dataset || cell.dataset.day === undefined) {
      return;
    }
    const n = Number(cell.dataset.day);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(n);
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const k = state.k + (e.key === 'PageUp' ? -1 : 1);
      if (inBounds(k)) {
        const from = rangeOf(state.k);
        const range = rangeOf(k);
        navigate(k, clamp(range.start + (n - from.start), range.start, range.end));
      }
      return;
    }
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const to = keyTarget(e.key, n, moves, o.weekStart);
    if (to === null) {
      return;
    }
    e.preventDefault();
    const target = root.querySelector(`[data-day="${to}"]`);
    if (target) {
      for (const other of root.querySelectorAll('.cal-d[tabindex="0"]')) {
        other.tabIndex = -1;
      }
      target.tabIndex = 0;
      target.focus();
      state.focus = to;
    } else if (inBounds(periodOf(to))) {
      navigate(periodOf(to), to);
    }
  };

  /* --- drawing --- */
  function build() {
    root.style.minHeight = ''; // the room kept while a deferred first drawing waited
    // drawn for real: later drawings are immediate (a page drawn twice before its first paint still waits both times)
    state.drawn = true;
    const mode = currentMode();
    const k = state.k;
    const range = rangeOf(k);
    const weeks = calendarWeeks(range.start, range.end, o.weekStart, !!o.fixedWeeks);
    const from = weeks[0][0];
    const to = weeks[weeks.length - 1][6];
    const all = eventsFor(k, { k, start: range.start, end: range.end, from, to });
    const shown = all.filter(ev => !state.hidden.has(ev.group));
    const layout = layoutEvents(shown, from, to);
    const sel = state.sel !== null && state.sel >= from && state.sel <= to ? state.sel : null;
    const focusDay = [state.focus, sel, today, range.start].find(n => n != null && n >= from && n <= to);
    const plain = monthRange(k);
    const titleText = o.title ? o.title(k, range) : M.label(k, true);
    const dates =
      !o.title && (plain.start !== range.start || plain.end !== range.end)
        ? D.label(range.start) + ' – ' + D.label(range.end)
        : null;
    const wide = mode === 'full' || mode === 'tablet';
    // tablet and phone: the chosen day opens in a bottom sheet (the sheet option)
    const useSheet = o.sheet !== false && (mode === 'tablet' || mode === 'mobile');

    /* header: title, layout switch, ‹ Today › */
    const prev = ibtn($t('Previous month'), () => navigate(k - 1), '', 'left');
    const next = ibtn($t('Next month'), () => navigate(k + 1), '', 'right');
    prev.disabled = !inBounds(k - 1);
    next.disabled = !inBounds(k + 1);
    prev.dataset.focus = 'prev';
    next.dataset.focus = 'next';
    const todayK = periodOf(today);
    const todayBtn =
      mode === 'mini'
        ? null
        : h('button', {
            type: 'button',
            class: 'btn',
            text: $t('Today'),
            'data-focus': 'today',
            disabled: !inBounds(todayK),
            onclick: () => navigate(todayK, today),
          });
    const switcher = o.modes
      ? h(
          'div',
          { class: 'seg cal-modes', role: 'group', 'aria-label': $t('Calendar layout') },
          o.modes
            .filter(m => CAL_MODES.includes(m))
            .map(m =>
              h('button', {
                type: 'button',
                'aria-pressed': String(chosenMode() === m),
                'data-focus': 'mode:' + m,
                text: MODE_LABELS[m],
                onclick: () => {
                  state.mode = m;
                  draw();
                },
              }),
            ),
        )
      : null;
    /* money in, out and net of the month (lines without a day belong to it) */
    const sum = totals(eventsIn(shown, range.start, range.end));
    // the mini calendar (a card) says the month in one figure under its name, instead of the pay-period dates (those
    // stay in the title's tooltip) and a row of totals: three lines of text become one
    const miniFigure = mode === 'mini' && o.summary ? oneFigure(sum) : null;
    let subLine = dates ? h('span', { class: 'muted small', text: dates }) : null;
    if (miniFigure) {
      subLine = h('span', { class: 'cal-fig small ' + miniFigure.tone, text: miniFigure.text });
    }
    const head = !o.header
      ? null
      : h(
          'div',
          { class: 'cal-head' },
          h(
            'div',
            { class: 'cal-title', 'aria-live': 'polite', title: dates || null },
            h('b', { text: titleText }),
            subLine,
          ),
          h(
            'div',
            { class: 'cal-tools' },
            switcher,
            h('div', { class: 'monthnav', role: 'group', 'aria-label': $t('Month') }, prev, todayBtn, next),
          ),
        );

    /* legend: one on/off button per group that has events this month */
    const present = new Set(all.map(ev => ev.group).filter(Boolean));
    const legendGroups = [
      ...[...groups.values()].filter(g => present.has(g.key)),
      ...[...present].filter(key => !groups.has(key)).map(key => ({ key, label: key })),
    ];
    const legend =
      (o.legend ?? mode !== 'mini') && legendGroups.length > 1
        ? h(
            'div',
            { class: 'cal-legend', role: 'group', 'aria-label': $t('Show or hide') },
            legendGroups.map(g => {
              const l = look({ group: g.key });
              return h(
                'button',
                {
                  type: 'button',
                  class: 'cal-lg' + l.class,
                  style: l.style,
                  'aria-pressed': String(!state.hidden.has(g.key)),
                  'data-focus': 'lg:' + g.key,
                  onclick: () => {
                    if (state.hidden.has(g.key)) {
                      state.hidden.delete(g.key);
                    } else {
                      state.hidden.add(g.key);
                    }
                    draw();
                  },
                },
                h('i', { class: 'cal-dot', 'aria-hidden': 'true' }),
                h('span', { text: g.label || g.key }),
              );
            }),
          )
        : null;

    const figure = (label, value, className) =>
      h('span', null, h('span', { class: 'l', text: label }), h('b', { class: className || '', text: value }));
    // only what says something: no "Money in 0" on a calendar of spending, no net when it repeats the one figure
    const both = sum.in && sum.out;
    const summary =
      o.summary && !miniFigure && (sum.in || sum.out)
        ? h(
            'div',
            { class: 'cal-sum' },
            sum.in && !(both && mode === 'mini') ? figure($t('Money in'), signed(sum.in), 'good') : null,
            sum.out && !(both && mode === 'mini') ? figure($t('Money out'), money(-sum.out)) : null,
            both ? figure($t('Net'), signed(sum.net), sum.net < 0 ? 'bad' : 'good') : null,
          )
        : null;

    /** What a line in the grid shows when the page does not draw it: its time, title and (full grid) amount. */
    const chipContent = ev => [
      ev.time ? h('span', { class: 'cal-tm', text: ev.time }) : null,
      h('span', { class: 'cal-et', text: ev.title }),
      mode === 'full' && ev.amount !== null ? h('span', { class: 'cal-ea', text: short(ev.amount) }) : null,
    ];
    /* a line in a day of the grid */
    const chipOf = (ev, n) => {
      const l = look(ev);
      const content = o.eventContent ? o.eventContent(ev, mode) : chipContent(ev);
      return h(
        'button',
        {
          type: 'button',
          tabindex: -1,
          class:
            'cal-e' +
            l.class +
            (ev.done ? ' done' : '') +
            (ev.amount > 0 ? ' pos' : '') +
            (ev.tentative ? ' tentative' : ''),
          style: l.style,
          title: tip(ev),
          onclick: e => {
            e.stopPropagation();
            openEvent(ev, n);
          },
          oncontextmenu: e => eventMenuOf(e, ev),
        },
        content,
      );
    };
    /* "+2 more": every line of the day in a pop-up next to the day, where the grid had no room for them */
    const dayPop = (anchor, n) =>
      popover(anchor, longDay(n), pop => {
        pop.classList.add('cal-pop');
        // a line opens its window: the pop-up goes first (capture, before the line's own click)
        pop.addEventListener(
          'click',
          ev => {
            if (ev.target instanceof Element && ev.target.closest('.cal-e')) {
              closePop();
            }
          },
          true,
        );
        pop.append(
          h('div', { class: 'mpop-h' }, h('b', { text: longDay(n) })),
          h(
            'div',
            { class: 'cal-pop-l' },
            eventsOn(layout, n).map(ev => chipOf(ev, n)),
          ),
          h('button', {
            type: 'button',
            class: 'btn sm ghost',
            text: $t('Show this day'),
            onclick: () => {
              closePop();
              if (state.sel !== n) {
                select(n);
              }
              const panel = root.querySelector('.cal-panel');
              if (panel) {
                panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              }
            },
          }),
        );
      });
    /* a day of a multi-day event: a bar that joins the days; the name shows where it starts and on each new week */
    const spanOf = (lane, n) => {
      const ev = lane.event;
      const l = look(ev);
      const named = lane.first || n === from || weekPos(n, o.weekStart) === 0;
      return h(
        'button',
        {
          type: 'button',
          tabindex: -1,
          class:
            'cal-e cal-span' +
            l.class +
            (lane.first ? ' s' : '') +
            (lane.last ? ' e' : '') +
            (ev.tentative ? ' tentative' : ''),
          style: l.style,
          title: tip(ev) + ' · ' + $t('Day {0} of {1}', lane.index, lane.length),
          onclick: e => {
            e.stopPropagation();
            openEvent(ev, n);
          },
          oncontextmenu: e => eventMenuOf(e, ev),
        },
        h('span', { class: 'cal-et', text: named ? ev.title : '' }),
      );
    };

    /** The menu of a day. Where the grid shows dots instead of lines, it starts with a way to list them. */
    const dayMenuOf = n => [
      !wide && state.sel !== n ? [$t('Show this day'), () => select(n)] : null,
      ...(o.dayMenu ? o.dayMenu(n) : []),
    ];
    /** Whether anything can be added on day n (settings may switch every choice off). */
    const canAdd = n => !!o.onAdd || (!!o.dayMenu && o.dayMenu(n).some(Array.isArray));
    /** "+" and Add: the day menu when there is one, otherwise onAdd. */
    const addOn = (e, n) => {
      if (!(o.dayMenu && openMenu(e, o.dayMenu(n))) && o.onAdd) {
        o.onAdd(n);
      }
    };
    const cell = n => {
      const day = layout.days.get(n);
      const list = eventsOn(layout, n);
      const out = n < range.start || n > range.end;
      const info = o.dayInfo ? o.dayInfo(n, mode, list) : null;
      const t = totals(list);
      const first = D.js(n).getUTCDate() === 1 || n === from;
      const shown = wide && first ? D.label(n) : String(D.js(n).getUTCDate());
      const label = dayLabel(n, today, list, t, info, shown);
      const body = [];
      if (wide) {
        const cap = mode === 'full' ? o.maxChips : Math.min(2, o.maxChips);
        const items = day ? day.items : [];
        body.push((day ? day.lanes : []).map(lane => (lane ? spanOf(lane, n) : h('i', { class: 'cal-e cal-gap' }))));
        body.push(items.slice(0, cap).map(ev => chipOf(ev, n)));
        if (items.length > cap) {
          body.push(
            h('button', {
              type: 'button',
              tabindex: -1,
              class: 'cal-more',
              text: $t('+{0} more', items.length - cap),
              'aria-haspopup': 'dialog',
              onclick: e => {
                e.stopPropagation();
                dayPop(e.currentTarget, n);
              },
            }),
          );
        }
        if (mode === 'tablet' && (t.in || t.out)) {
          body.push(h('span', { class: 'cal-net' + (t.net > 0 ? ' good' : ''), text: short(t.net) }));
        }
      } else if (list.length) {
        // mobile and mini: one dot per group, so a busy day does not look like a different colour each time
        const seen = new Set();
        const dots = list.filter(ev => !seen.has(ev.group) && seen.add(ev.group)).slice(0, mode === 'mobile' ? 4 : 3);
        body.push(h('span', { class: 'cal-dots' }, dots.map(dot)));
      }
      if (o.dayExtra) {
        body.push(o.dayExtra(n, mode));
      }
      return h(
        'div',
        {
          role: 'gridcell',
          class:
            'cal-d' +
            (out ? ' out' : '') +
            (D.weekend(n) ? ' we' : '') +
            (n === today ? ' today' : '') +
            (n === sel ? ' sel' : '') +
            (info && info.tone ? ' t-' + info.tone : '') +
            ((info && info.marks) || []).map(mark => ' m-' + mark.kind).join(''),
          tabindex: n === focusDay ? 0 : -1,
          'aria-selected': String(n === sel),
          'aria-label': label,
          'data-day': n,
          'data-focus': 'day:' + n,
          onclick: () => select(n),
          oncontextmenu: e => (o.dayMenu || o.eventMenu ? openMenu(e, dayMenuOf(n)) : null),
        },
        h(
          'div',
          { class: 'cal-dh' },
          h('span', { class: 'cal-n', text: shown }),
          ((info && info.marks) || []).map(mark =>
            h('span', {
              class: 'cal-mark ' + mark.kind,
              title: mark.title,
              'aria-hidden': 'true',
              text: wide ? mark.short : '',
            }),
          ),
          wide && info && info.text
            ? h('span', { class: 'cal-v' + (info.tone ? ' ' + info.tone : ''), text: info.text, title: info.title })
            : null,
        ),
        body,
      );
    };

    // One "+" for the whole grid. It only shows on the day under the pointer (and not at all on touch screens, where
    // Add in the day panel does the same), so it moves to that day instead of being built, labelled and checked for
    // every day of the month on every redraw.
    const addButton =
      wide && (o.onAdd || o.dayMenu)
        ? h(
            'button',
            {
              type: 'button',
              tabindex: -1,
              class: 'cal-add',
              'aria-haspopup': o.dayMenu ? 'menu' : null,
              onclick: e => {
                e.stopPropagation();
                addOn(e, Number(addButton.dataset.day));
              },
            },
            icon('plus'),
          )
        : null;
    const placeAdd = e => {
      const day = e.target.closest && e.target.closest('.cal-d');
      if (!day || day.contains(addButton)) {
        return;
      }
      const n = Number(day.dataset.day);
      if (day.classList.contains('out') || !canAdd(n)) {
        addButton.remove();
        return;
      }
      const label = $t('Add something on {0}', D.label(n));
      addButton.dataset.day = n;
      addButton.title = label;
      addButton.setAttribute('aria-label', label);
      day.querySelector('.cal-dh').append(addButton);
    };
    const grid = h(
      'div',
      { class: 'cal-gw' },
      h(
        'div',
        {
          class: 'cal-grid',
          role: 'grid',
          'aria-label': o.label || titleText,
          onkeydown: onKey,
          onpointerover: addButton ? placeAdd : null,
        },
        h(
          'div',
          { class: 'cal-row cal-wd', role: 'row' },
          weeks[0].map(n =>
            h('div', {
              class: 'cal-wdn',
              role: 'columnheader',
              'aria-label': weekday(n, 'long'),
              title: weekday(n, 'long'),
              text: weekday(n, wide ? 'short' : 'narrow'),
            }),
          ),
        ),
        weeks.map(week => h('div', { class: 'cal-row', role: 'row' }, week.map(cell))),
      ),
    );

    /* one line in the day panel or the month list: the same row as everywhere else in the app */
    const lineOf = (ev, n) => {
      const l = look(ev);
      const span = lastDay(ev) > ev.date && ev.date !== null;
      let when = null;
      if (span && n !== null && n !== undefined) {
        when = $t('Day {0} of {1}', n - ev.date + 1, lastDay(ev) - ev.date + 1);
      } else if (span) {
        when = $t('{0} – {1}', D.label(ev.date), D.label(lastDay(ev)));
      }
      const menu = o.eventMenu ? o.eventMenu(ev).filter(Boolean) : [];
      const line = row({
        left: h('i', {
          class: 'cal-dot' + l.class + (ev.tentative ? ' tentative' : ''),
          style: l.style,
          'aria-hidden': 'true',
        }),
        title: ev.title,
        desc: [ev.timeText || ev.time, when, ev.sub, (groups.get(ev.group) || {}).label].filter(Boolean).join(' · '),
        right: [
          ev.amount !== null ? amt(ev.amount) : null,
          // the same menu as a right click, for touch screens (no right click, often no long press) and the keyboard
          menu.length
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'btn icon ghost sm cal-mbtn',
                  'aria-label': $t('Actions for {0}', ev.title),
                  'aria-haspopup': 'menu',
                  title: $t('More actions'),
                  onclick: e => {
                    e.stopPropagation();
                    openMenu(e, menu);
                  },
                },
                icon('menu'),
              )
            : null,
        ],
        onclick: o.onEvent ? () => o.onEvent(ev) : null,
        cls: (ev.done ? 'done' : '') + (ev.tentative ? ' tentative' : ''),
      });
      if (menu.length) {
        line.addEventListener('contextmenu', e => openMenu(e, menu));
      }
      return line;
    };
    const dayPanel = n => {
      const list = eventsOn(layout, n);
      const info = o.dayInfo ? o.dayInfo(n, mode, list) : null;
      const t = totals(list);
      return h(
        'div',
        { class: 'cal-panel', role: 'region', 'aria-label': longDay(n) },
        h(
          'div',
          { class: 'cal-ph' },
          h('b', { text: longDay(n) }),
          info && info.text && info.panel !== false
            ? h('span', { class: 'chip ' + (info.tone || ''), text: info.text, title: info.title })
            : null,
          h('span', { class: 'grow' }),
          t.in || t.out ? h('span', { class: 'num', text: signed(t.net) }) : null,
          canAdd(n) ? btn($t('Add'), e => addOn(e, n), 'sm', 'plus') : null,
          ibtn($t('Close the day'), () => select(n), 'ghost sm', 'x'),
        ),
        list.length
          ? h(
              'div',
              { class: 'rows' },
              list.map(ev => lineOf(ev, n)),
            )
          : h('p', { class: 'muted small cal-none', text: $t('Nothing on this day.') }),
      );
    };
    /* --- the day in the bottom sheet (tablet and phone): a peek with its lines, or every detail --- */
    /** One line with everything about it, and what can be done with it as buttons (the sheet opened full). */
    const detailOf = (ev, n) => {
      const l = look(ev);
      const span = lastDay(ev) > ev.date && ev.date !== null;
      let doneText = null;
      if (ev.done) {
        doneText = ev.amount > 0 ? $t('Received') : $t('Paid');
      }
      const facts = [
        ev.timeText || ev.time,
        span ? $t('{0} – {1}', D.label(ev.date), D.label(lastDay(ev))) : null,
        span && n !== null ? $t('Day {0} of {1}', n - ev.date + 1, lastDay(ev) - ev.date + 1) : null,
        ev.sub,
        (groups.get(ev.group) || {}).label,
        doneText,
      ].filter(Boolean);
      const menu = (o.eventMenu ? o.eventMenu(ev) : []).filter(Array.isArray);
      let actions = [];
      if (menu.length) {
        actions = menu.map(([label, fn, cls]) =>
          btn(
            label,
            () => {
              fn();
            },
            'sm ' + (cls === 'danger' ? 'danger ghost' : 'ghost'),
          ),
        );
      } else if (o.onEvent) {
        actions = [btn($t('Open'), () => openEvent(ev, n), 'sm ghost')];
      }
      return h(
        'article',
        {
          class: 'sheet-ev' + l.class + (ev.tentative ? ' tentative' : '') + (ev.done ? ' done' : ''),
          style: l.style,
        },
        h(
          'div',
          { class: 'sheet-ev-h' },
          h('i', { class: 'cal-dot' + (ev.tentative ? ' tentative' : ''), 'aria-hidden': 'true' }),
          h('b', { text: ev.title }),
          h('span', { class: 'grow' }),
          ev.amount !== null ? amt(ev.amount) : null,
        ),
        facts.length ? h('div', { class: 'small muted', text: facts.join(' · ') }) : null,
        ev.note ? h('p', { class: 'sheet-note', text: ev.note }) : null,
        actions.length ? h('div', { class: 'acts sheet-acts' }, actions) : null,
      );
    };
    /** What the sheet shows for day n in `view` ('peek' or 'full'): a head to drag, with its buttons, and the lines. */
    const sheetContent = (n, view) => {
      const list = eventsOn(layout, n);
      const info = o.dayInfo ? o.dayInfo(n, mode, list) : null;
      const t = totals(list);
      const flow = [
        t.in ? $t('{0} in', signed(t.in)) : null,
        t.out ? $t('{0} out', money(t.out)) : null,
        t.in && t.out ? $t('net {0}', signed(t.net)) : null,
      ].filter(Boolean);
      const head = [
        h(
          'div',
          { class: 'sheet-h' },
          // short enough for a phone ("Tuesday 10 Nov"); the sheet's name says it in full
          h('b', { class: 'sheet-t', text: D.label(n, { weekday: 'long' }) }),
          info && info.text
            ? h('span', { class: 'chip ' + (info.tone || ''), text: info.text, title: info.title })
            : null,
          h('span', { class: 'grow' }),
          ibtn($t('Previous day'), () => select(n - 1), 'ghost sm', 'left'),
          ibtn($t('Next day'), () => select(n + 1), 'ghost sm', 'right'),
          ibtn($t('Close the day'), () => select(n), 'ghost sm', 'x'),
        ),
        h(
          'div',
          { class: 'sheet-sub' },
          h('span', {
            class: 'muted small grow',
            text: list.length ? [plural(list.length, 'item'), ...flow].join(' · ') : $t('Nothing on this day.'),
          }),
          canAdd(n) ? btn($t('Add'), e => addOn(e, n), 'sm', 'plus') : null,
          h('button', {
            type: 'button',
            class: 'btn sm ghost',
            'aria-expanded': String(view === 'full'),
            text: sheetToggleLabel(view),
            onclick: () => setSheet(view === 'full' ? 'peek' : 'full'),
          }),
        ),
      ];
      if (view !== 'full') {
        // the peek does not scroll: only the lines it can show are drawn (a busy day has dozens), then "N more"
        const shown = list.slice(0, PEEK_LINES);
        const more = list.length - shown.length;
        let moreButton = null;
        if (more > 0) {
          moreButton = h('button', {
            type: 'button',
            class: 'btn sm ghost sheet-more',
            text: $t('{0} more · every detail', more),
            onclick: () => setSheet('full'),
          });
        }
        return {
          head,
          body: list.length
            ? h(
                'div',
                { class: 'rows' },
                shown.map(ev => lineOf(ev, n)),
                moreButton,
              )
            : null,
        };
      }
      // every detail: the day's own facts (its balance, payday, lowest day…), then each line with its actions
      const dayFacts = [info && info.title, ...((info && info.marks) || []).map(mark => mark.title)].filter(Boolean);
      return {
        head,
        body: [
          dayFacts.length ? h('p', { class: 'sheet-day small' }, dayFacts.join(' ')) : null,
          list.length
            ? h(
                'div',
                { class: 'sheet-evs' },
                list.map(ev => detailOf(ev, n)),
              )
            : h('p', { class: 'muted small cal-none', text: $t('Nothing on this day.') }),
        ],
      };
    };
    /** Opens day n in the sheet (or shows it in the open one). */
    const showDay = n => {
      sheetCal = o.id;
      showSheet({
        owner: root,
        label: longDay(n),
        state: state.sheet || 'peek',
        render: view => sheetContent(n, view),
        onState: view => {
          if (view !== 'closed') {
            state.sheet = view;
          } else if (sheetCal === o.id && !quietClose) {
            // closed by the person: the day is no longer chosen
            sheetCal = null;
            state.sheet = null;
            if (state.sel !== null && root.isConnected) {
              choose(null, state.sel);
            } else {
              state.sel = null;
            }
          }
        },
        onSwipe: step => select(n + step),
        returnFocus: () => root.querySelector(`.cal-d[data-day="${state.focus ?? n}"]`),
      });
    };

    /* mobile without a chosen day: the whole month as a list, day by day; a trip is listed once, on its first day */
    const monthList = () => {
      const block = (label, list, n, info) =>
        h(
          'div',
          { class: 'cal-aday' + (n === today ? ' today' : '') },
          h(
            'div',
            { class: 'cal-ah' },
            h('b', { text: label }),
            info && info.text
              ? h('span', { class: 'cal-v' + (info.tone ? ' ' + info.tone : ''), text: info.text })
              : null,
          ),
          h(
            'div',
            { class: 'rows' },
            list.map(ev => lineOf(ev, null)),
          ),
        );
      // whole days until about `limit` lines, then "Show 150 more": a month of daily spending stays fast to draw
      const limit = state.listLimit || o.listPage;
      const blocks = layout.undated.length ? [block($t('No fixed day'), layout.undated, null, null)] : [];
      let shown = layout.undated.length;
      let total = shown;
      for (let n = range.start; n <= range.end; n++) {
        const all = eventsOn(layout, n);
        const list = all.filter(ev => ev.end === null || n === Math.max(ev.date, range.start));
        total += list.length;
        if (list.length && shown < limit) {
          blocks.push(block(D.label(n, { weekday: 'short' }), list, n, o.dayInfo ? o.dayInfo(n, mode, all) : null));
          shown += list.length;
        }
      }
      const hidden = total - shown;
      return h(
        'div',
        { class: 'cal-agenda' },
        blocks.length ? blocks : h('p', { class: 'muted small cal-none', text: $t('Nothing in this month.') }),
        hidden > 0
          ? h(
              'div',
              { class: 'tblmore' },
              h('button', {
                type: 'button',
                class: 'btn sm ghost',
                'data-focus': 'more',
                text: $t('Show {0} more', Math.min(hidden, o.listPage)),
                onclick: () => {
                  state.listLimit = limit + o.listPage;
                  draw();
                },
              }),
              h('span', { class: 'muted small', text: $t('{0} of {1} lines', shown, total) }),
            )
          : null,
      );
    };

    const undated =
      wide && layout.undated.length
        ? h(
            'div',
            { class: 'cal-undated' },
            h('span', { class: 'cal-ul', text: $t('No fixed day') }),
            layout.undated.map(ev => chipOf(ev, null)),
          )
        : null;
    /** What goes under the grid for the chosen day (or none): its lines, its one-line summary, or the month list. */
    const belowFor = day => {
      if (mode === 'mini') {
        if (day === null) {
          return null;
        }
        const list = eventsOn(layout, day);
        const text = list.length
          ? $t(
              '{0}: {1}, {2}',
              D.label(day, { weekday: 'short' }),
              plural(list.length, 'item'),
              signed(totals(list).net),
            )
          : $t('{0}: nothing on this day.', D.label(day, { weekday: 'short' }));
        return h('div', { class: 'cal-cap', text });
      }
      if (day !== null && !useSheet) {
        return dayPanel(day);
      }
      return mode === 'mobile' && o.monthList ? monthList() : null;
    };
    const below = belowFor(sel);

    root.dataset.mode = mode;
    // unlike h(), replaceChildren would write a missing part as the text "null"
    root.replaceChildren(...[head, legend, summary, undated, grid, below].filter(Boolean));
    onScreen = { from, to, below, belowFor, sheet: useSheet, showDay };

    // the chosen day stays open in the sheet when the calendar is drawn again (a change saved, another month)
    if (useSheet && sel !== null && state.sheet) {
      showDay(sel);
    } else if (sheetCal === o.id && sheetState()) {
      // a wider window (the day is listed under the grid instead, still chosen), or no day chosen any more
      quietClose = true;
      closeSheet();
      quietClose = false;
      sheetCal = null;
      state.sheet = null;
    }
    // a month that came from a swipe slides in from that side
    const gridEl = grid.firstChild;
    if (state.enter && !reducedMotion() && gridEl.animate) {
      gridEl.animate(
        [
          { transform: `translateX(${state.enter * 35}%)`, opacity: 0.25 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 220, easing: 'ease-out' },
      );
    }
    state.enter = 0;
    if (o.swipe) {
      touchGrid(grid, gridEl, k, useSheet);
    }
  }
  /** Swipes on the grid (components/gestures.js): months sideways; with the sheet, hold a day and swipe up. */
  function touchGrid(wrap, gridEl, k, withSheet) {
    const slide = (dx, fade) => {
      gridEl.style.transform = dx ? `translateX(${dx}px)` : '';
      gridEl.style.opacity = fade ? String(fade) : '';
    };
    gridGestures(wrap, {
      canStep: step => inBounds(k + step),
      onSwipe: (dx, width) => {
        gridEl.classList.add('swiping');
        slide(dx, 1 - Math.min(0.5, Math.abs(dx) / width / 2));
      },
      onSwipeEnd: step => {
        gridEl.classList.remove('swiping');
        if (!step) {
          slide(0);
          return;
        }
        state.enter = step;
        navigate(k + step);
      },
      hold: target => {
        const cell = withSheet && target.closest ? target.closest('.cal-d') : null;
        return cell ? Number(cell.dataset.day) : null;
      },
      onHold: day => {
        const cell = root.querySelector(`.cal-d[data-day="${day}"]`);
        if (cell) {
          cell.classList.add('held');
        }
      },
      onPull: (day, height) => {
        if (!sheetState()) {
          // the held day is chosen and its sheet opens, then follows the finger
          state.sheet = 'peek';
          const range = rangeOf(state.k);
          if (day >= range.start && day <= range.end) {
            choose(day, day);
            if (o.onSelect) {
              o.onSelect(day);
            }
          } else {
            select(day);
          }
        }
        sheetFollow(height);
      },
      onPullEnd: (day, height, speed) => {
        root.querySelector('.cal-d.held')?.classList.remove('held');
        sheetRelease(height, speed);
      },
      onHoldCancel: () => root.querySelector('.cal-d.held')?.classList.remove('held'),
    });
  }

  if (o.defer && !state.drawn) {
    // the first time in this visit, draw once the page has been painted (a calendar further down the page should not
    // hold up the top of it); keep about its height meanwhile, so nothing below it moves when it appears
    const weeks = calendarWeeks(rangeOf(state.k).start, rangeOf(state.k).end, o.weekStart, !!o.fixedWeeks).length;
    const row = { full: 113, tablet: 93, mobile: 51, mini: 36 }[currentMode()];
    root.style.minHeight = 150 + weeks * row + 'px';
    const later = () => {
      if (root.isConnected && !root.childElementCount) {
        build();
      }
    };
    requestAnimationFrame(() => setTimeout(later, 0));
  } else {
    build();
  }
  if (chosenMode() === 'compact' || o.modes) {
    watchWidth(root, fit);
    // Only a guess is checked at once (the page puts the calendar in place in this task, before the first paint).
    // Reading the width forces a layout, and inside a card below the fold (content-visibility: auto) it would lay out
    // what the browser would otherwise skip; a width measured before is good, and the observer follows any change.
    if (guessed) {
      queueMicrotask(() => fit(root.isConnected ? root.clientWidth : 0));
    }
  }
  return root;
}
