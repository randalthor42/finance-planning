/**
 * @file DOM helpers. All user text goes through textContent, never innerHTML.
 */
/* --- 6.1 DOM helpers. All user text goes through textContent, never innerHTML. --- */
export const $ = (s, r = document) => r.querySelector(s);
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'open', 'selected']);
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in attrs || {}) {
    const v = attrs[k];
    if (v == null || v === false) {
      continue;
    }
    if (k === 'text') {
      e.textContent = v;
    } else if (k === 'class') {
      e.className = v;
    } else if (k.startsWith('on')) {
      e.addEventListener(k.slice(2), v);
    } else if (PROPS.has(k)) {
      e[k] = v;
    } else {
      e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) {
    if (c != null && c !== false) {
      e.append(c);
    }
  }
  return e;
}
const SVG = 'http://www.w3.org/2000/svg';
export function sv(tag, attrs, ...kids) {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs || {}) {
    if (attrs[k] != null) {
      e.setAttribute(k, attrs[k]);
    }
  }
  for (const c of kids.flat()) {
    if (c != null) {
      e.append(c);
    }
  }
  return e;
}
