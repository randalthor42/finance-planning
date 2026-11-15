/**
 * @file Calendar: dated money on a month grid. One component, four layouts:
 *   full     a page-wide month: each day lists its lines with amounts, trips with dates are bars across the days
 *   tablet   the same grid, tighter: names only, and the day's net at the bottom
 *   mobile   a small grid with coloured dots; underneath, the lines of the chosen day (or of the whole month)
 *   compact  a mini month for a card or a side column: dots and the colour of each day only
 *   auto     (default) full, tablet or mobile by the width the calendar itself gets, not the screen's: in a narrow
 *            card on a wide screen it still fits
 * It knows nothing about the plan: a page hands it events. calendarData.js has ready-made events for the plan.
 * The arithmetic (weeks, spans, totals) is in logic/calendar.js; this file only draws.
 *
 * Usage:
 *   calendar({
 *     id: 'bills-cal',                      // remembers month, day, layout and filters for this visit
 *     events: [{ id: 'rent', title: 'Rent', date: '2026-11-02', amount: -820, group: 'bill' }],
 *     groups: [{ key: 'bill', label: $t('Bills'), tone: 'bad' }],
 *     onEvent: ev => …,
 *   })
 *   calendar({ ...planCalendar(), id: 'overview-cal', mode: 'compact' })   // the plan (calendarData.js)
 *
 * Options (only `id` is required; use one id per calendar on screen, it keys the state in UI.calendars):
 *   mode         'auto' | 'full' | 'tablet' | 'mobile' | 'compact'. Default 'auto'.
 *   modes        layouts the person may switch between, e.g. ['auto', 'full', 'compact']. Omit for no switch.
 *   events       an array of events (types.js CalendarEvent), or a function of the days drawn that returns one:
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
 *   legend       show the groups as on/off filters. Default true, false in compact.
 *   summary      show money in, out and net of the month (only the figures that are not zero). Default true.
 *   monthList    mobile: list the whole month under the grid while no day is chosen. Default true.
 *   listPage     that list draws whole days up to about this many lines, then "Show 150 more". Default 150.
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
import { ctxMenu } from './popover.js';

/** Every layout, in the order of the switch. */
export const CAL_MODES = ['auto', 'full', 'tablet', 'mobile', 'compact'];
const MODE_LABELS = {
  auto: $t('Auto'),
  full: $t('Full page'),
  tablet: $t('Tablet'),
  mobile: $t('Mobile'),
  compact: $t('Compact'),
};
const TONES = new Set(['good', 'bad', 'warn', 'acc', 'cash', 'save', 'debt', 'trip', 'wish', 'muted']);
/** A colour from the page goes into a style attribute: allow colour syntax only, never a second declaration. */
const COLOR = /^[#a-zA-Z0-9(),.%\s-]{1,60}$/;
/** What "auto" becomes at a width (px) of the calendar itself. */
const FIT = [
  [860, 'full'],
  [560, 'tablet'],
  [0, 'mobile'],
];
const fitFor = width => FIT.find(([min]) => width >= min)[1];

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

/** Amounts in a small cell: exact below 10 000, "12K" above. */
const short = n => (Math.abs(n) >= 10000 ? (n > 0 ? '+' : '') + compact(n) : signed(n));
const weekday = (n, width) => D.fmt(n, { weekday: width });
const longDay = n => D.label(n, { weekday: 'long', month: 'long' });

/**
 * Draws a calendar. Returns its element; month, day and layout changes redraw only the calendar, not the page.
 * @param {object} options see the top of this file
 */
export function calendar(options) {
  const o = {
    mode: 'auto',
    weekStart: 1,
    maxChips: 3,
    header: true,
    summary: true,
    monthList: true,
    listPage: 150,
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

  const chosenMode = () => state.mode || o.mode;
  /** The layout comes from a guess, not from a width measured earlier: it is checked as soon as it is on the page. */
  let guessed = false;
  const currentMode = () => {
    const chosen = chosenMode();
    if (chosen !== 'auto') {
      return CAL_MODES.includes(chosen) ? chosen : 'full';
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
    if (chosenMode() === 'auto' && root.dataset.mode && root.dataset.mode !== state.fit) {
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
    return h('i', { class: 'cal-dot' + l.class, style: l.style, 'aria-hidden': 'true' });
  };
  const tip = ev =>
    [ev.title, ev.amount !== null ? signed(ev.amount) : '', ev.sub, (groups.get(ev.group) || {}).label]
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
    const to = moves[e.key]
      ? n + moves[e.key]
      : e.key === 'Home'
        ? n - weekPos(n, o.weekStart)
        : e.key === 'End'
          ? n + 6 - weekPos(n, o.weekStart)
          : null;
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

    /* header: title, layout switch, ‹ Today › */
    const prev = ibtn($t('Previous month'), () => navigate(k - 1), '', 'left');
    const next = ibtn($t('Next month'), () => navigate(k + 1), '', 'right');
    prev.disabled = !inBounds(k - 1);
    next.disabled = !inBounds(k + 1);
    prev.dataset.focus = 'prev';
    next.dataset.focus = 'next';
    const todayK = periodOf(today);
    const todayBtn =
      mode === 'compact'
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
    const head = !o.header
      ? null
      : h(
          'div',
          { class: 'cal-head' },
          h(
            'div',
            { class: 'cal-title', 'aria-live': 'polite' },
            h('b', { text: titleText }),
            dates ? h('span', { class: 'muted small', text: dates }) : null,
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
      (o.legend ?? mode !== 'compact') && legendGroups.length > 1
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

    /* money in, out and net of the month (lines without a day belong to it) */
    const sum = totals(eventsIn(shown, range.start, range.end));
    const figure = (label, value, className) =>
      h('span', null, h('span', { class: 'l', text: label }), h('b', { class: className || '', text: value }));
    // only what says something: no "Money in 0" on a calendar of spending, no net when it repeats the one figure
    const both = sum.in && sum.out;
    const summary =
      o.summary && (sum.in || sum.out)
        ? h(
            'div',
            { class: 'cal-sum' },
            sum.in && !(both && mode === 'compact') ? figure($t('Money in'), signed(sum.in), 'good') : null,
            sum.out && !(both && mode === 'compact') ? figure($t('Money out'), money(-sum.out)) : null,
            both ? figure($t('Net'), signed(sum.net), sum.net < 0 ? 'bad' : 'good') : null,
          )
        : null;

    /* a line in a day of the grid */
    const chipOf = (ev, n) => {
      const l = look(ev);
      const content = o.eventContent
        ? o.eventContent(ev, mode)
        : [
            h('span', { class: 'cal-et', text: ev.title }),
            mode === 'full' && ev.amount !== null ? h('span', { class: 'cal-ea', text: short(ev.amount) }) : null,
          ];
      return h(
        'button',
        {
          type: 'button',
          tabindex: -1,
          class: 'cal-e' + l.class + (ev.done ? ' done' : '') + (ev.amount > 0 ? ' pos' : ''),
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
          class: 'cal-e cal-span' + l.class + (lane.first ? ' s' : '') + (lane.last ? ' e' : ''),
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
      const label = [
        longDay(n),
        n === today ? $t('today') : null,
        list.length ? plural(list.length, 'item') : null,
        t.in || t.out ? signed(t.net) : null,
        info ? info.title || info.text : null,
      ]
        .filter(Boolean)
        .join(', ');
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
              onclick: e => {
                e.stopPropagation();
                if (state.sel !== n) {
                  select(n);
                }
              },
            }),
          );
        }
        if (mode === 'tablet' && (t.in || t.out)) {
          body.push(h('span', { class: 'cal-net' + (t.net > 0 ? ' good' : ''), text: short(t.net) }));
        }
      } else if (list.length) {
        // mobile and compact: one dot per group, so a busy day does not look like a different colour each time
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
            (info && info.tone ? ' t-' + info.tone : ''),
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
          h('span', { class: 'cal-n', text: wide && first ? D.label(n) : String(D.js(n).getUTCDate()) }),
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
      const when = span
        ? n !== null && n !== undefined
          ? $t('Day {0} of {1}', n - ev.date + 1, lastDay(ev) - ev.date + 1)
          : D.label(ev.date) + ' – ' + D.label(lastDay(ev))
        : null;
      const menu = o.eventMenu ? o.eventMenu(ev).filter(Boolean) : [];
      const line = row({
        left: h('i', { class: 'cal-dot' + l.class, style: l.style, 'aria-hidden': 'true' }),
        title: ev.title,
        desc: [when, ev.sub, (groups.get(ev.group) || {}).label].filter(Boolean).join(' · '),
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
        cls: ev.done ? 'done' : '',
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
      if (mode === 'compact') {
        const list = day !== null ? eventsOn(layout, day) : [];
        return day !== null
          ? h(
              'div',
              { class: 'cal-cap' },
              h('b', { text: D.label(day, { weekday: 'short' }) }),
              ' · ',
              list.length ? plural(list.length, 'item') + ' · ' + signed(totals(list).net) : $t('Nothing on this day.'),
            )
          : null;
      }
      if (day !== null) {
        return dayPanel(day);
      }
      return mode === 'mobile' && o.monthList ? monthList() : null;
    };
    const below = belowFor(sel);

    root.dataset.mode = mode;
    // unlike h(), replaceChildren would write a missing part as the text "null"
    root.replaceChildren(...[head, legend, summary, undated, grid, below].filter(Boolean));
    onScreen = { from, to, below, belowFor };
  }

  if (o.defer && !state.drawn) {
    // the first time in this visit, draw once the page has been painted (a calendar further down the page should not
    // hold up the top of it); keep about its height meanwhile, so nothing below it moves when it appears
    const weeks = calendarWeeks(rangeOf(state.k).start, rangeOf(state.k).end, o.weekStart, !!o.fixedWeeks).length;
    const row = { full: 113, tablet: 93, mobile: 51, compact: 36 }[currentMode()];
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
  if (chosenMode() === 'auto' || o.modes) {
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
