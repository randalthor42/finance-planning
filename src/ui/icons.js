/**
 * @file Inline SVG icons. icon(name) returns an <svg> element; paths live in ICONS.
 */
import { sv } from './dom.js';

const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  repeat: 'M4 10V8a2 2 0 012-2h12l-3-3M20 14v2a2 2 0 01-2 2H6l3 3',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
  plane: 'M3 11l18-7-6 17-3-7-9-3z',
  bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8z',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  gear: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  plus: 'M12 5v14M5 12h14',
  undo: 'M8 5L3 10l5 5M3 10h11a5 5 0 010 10h-3',
  redo: 'M16 5l5 5-5 5M21 10H10a5 5 0 000 10h3',
  x: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  check: 'M5 12l5 5 9-10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  alert: 'M12 4l9 16H3L12 4zM12 10v4M12 17h.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8h.01',
  copy: 'M8 8h11v12H8zM5 16V4h11',
  menu: 'M4 6h16M4 12h16M4 18h16',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  star: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1L12 17.2 6.5 20l1-6.1L3 9.5l6.3-.9z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
};
export const icon = n =>
  sv(
    'svg',
    { class: 'ico', viewBox: '0 0 24 24', 'aria-hidden': 'true', 'stroke-width': n === 'grip' ? 2.6 : null },
    sv('path', { d: ICONS[n] }),
  );
