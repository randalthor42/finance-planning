/**
 * @file Money input: formats as you type using the plan number format and reports a number (or null) to onInput.
 */
import { FMT, fmtNum, parseMoney } from '../../core/format.js';
import { clamp, r2 } from '../../core/util.js';
import { h } from '../dom.js';

export function moneyInp(o) {
  const i = h('input', {
    class: 'inp num ' + (o.cls || ''),
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    placeholder: o.ph == null ? '0' : o.ph,
    'aria-label': o.label,
  });
  const show = n => (n == null || (!n && !o.blank) ? '' : fmtNum(n));
  const canon = s => {
    let out = '';
    let dec = -1;
    for (const ch of s) {
      if (ch >= '0' && ch <= '9') {
        if (dec >= 2) {
          continue;
        }
        if (dec >= 0) {
          dec++;
        }
        out += ch;
      } else if ((ch === 'D' || ch === FMT.dec) && dec < 0) {
        dec = 0;
        out += 'D';
      } else if (ch === '+' && out && !out.endsWith('+')) {
        out += '+';
        dec = -1;
      } else if (ch === '-' && o.neg && out === '') {
        out += '-';
      }
    }
    return out;
  };
  const pretty = c =>
    c
      .split('+')
      .map(p => {
        const neg = p[0] === '-' ? '-' : '';
        const [a, b] = p.replace('-', '').split('D');
        return neg + a.replace(/\B(?=(\d{3})+(?!\d))/g, FMT.grp) + (b === undefined ? '' : FMT.dec + b);
      })
      .join('+');
  const value = c => {
    if (c === '' || c === '-') {
      return o.blank ? null : 0;
    }
    const n = c.split('+').reduce((s, p) => s + (parseFloat(p.replace('D', '.')) || 0), 0);
    return clamp(r2(n), o.neg ? -1e9 : 0, 1e9);
  };
  let current = o.value == null ? null : o.value;
  i.value = show(current);
  i.setNum = n => {
    current = n;
    i.value = show(n);
  };
  i.addEventListener('input', e => {
    if (e.inputType === 'insertFromPaste') {
      current = parseMoney(i.value);
      i.value = show(current);
      return o.onInput(current);
    }
    let v = i.value;
    const p = i.selectionStart == null ? v.length : i.selectionStart;
    if ((e.data === '.' || e.data === ',') && p > 0) {
      v = v.slice(0, p - 1) + 'D' + v.slice(p);
    }
    const c = canon(v);
    const keep = canon(v.slice(0, p)).length;
    const out = pretty(c);
    let pos = 0;
    let seen = 0;
    while (pos < out.length && seen < keep) {
      if (out[pos] !== FMT.grp) {
        seen++;
      }
      pos++;
    }
    i.value = out;
    try {
      i.setSelectionRange(pos, pos);
    } catch (x) {}
    current = value(c);
    o.onInput(current);
  });
  i.addEventListener('blur', () => {
    if (i.value.trim()) {
      i.value = show(current);
    }
  });
  return i;
}
