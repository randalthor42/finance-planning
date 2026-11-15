/**
 * @file Buttons: btn (text, optional icon) and ibtn (icon only, with an accessible label).
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';

export const btn = (label, onclick, className = '', ic) =>
  h('button', { type: 'button', class: 'btn ' + className, onclick }, ic ? icon(ic) : null, label);
export const ibtn = (label, onclick, className, ic) =>
  h(
    'button',
    { type: 'button', class: 'btn icon ' + (className || ''), 'aria-label': label, title: label, onclick },
    icon(ic),
  );
