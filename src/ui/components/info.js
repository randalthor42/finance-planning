/**
 * @file The small "i" button that opens an explanation, and linkify, which turns http(s) URLs in notes into safe links.
 */
import { $t } from '../../core/i18n.js';
import { POP, closePop, popover } from './popover.js';
import { h } from '../dom.js';

/** Small "i" button: hover shows the text as a tooltip, click opens it as a pop-up (works on touch). */
export function info(text) {
  const b = h('button', { type: 'button', class: 'tipbtn', 'aria-label': $t('More information'), title: text }, 'i');
  b.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (POP && POP.anchor === b) {
      return closePop();
    }
    popover(b, $t('Information'), pop => {
      pop.classList.add('tipbox');
      pop.append(h('p', { text }));
    });
  });
  return b;
}
/** Turns plain text into text with clickable http(s) links. Nothing else in the text can become markup. */
export function linkify(text) {
  return String(text)
    .split(/(https?:\/\/[^\s<>"']+)/g)
    .map((p, i) =>
      i % 2
        ? h('a', {
            href: p,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40),
            onclick: e => e.stopPropagation(),
          })
        : p,
    );
}
