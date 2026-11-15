/**
 * @file Month and day pickers, and monthField, the form control that opens them.
 */
import { D, M } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { btn } from './button.js';
import { POP, closePop, popover } from './popover.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { nowK } from '../state.js';

const navRow = (title, prev, next) =>
  h(
    'div',
    { class: 'mpop-h' },
    h('button', { type: 'button', class: 'btn ghost icon', 'aria-label': $t('Earlier'), onclick: prev }, icon('left')),
    h('span', { text: title }),
    h('button', { type: 'button', class: 'btn ghost icon', 'aria-label': $t('Later'), onclick: next }, icon('right')),
  );
function monthPop(anchor, value, empty, pick) {
  popover(anchor, $t('Choose a month'), pop => {
    const sel = M.parse(value);
    const now = nowK();
    let year = Math.floor((sel === null ? now : sel) / 12);
    const choose = v => {
      closePop();
      pick(v);
      anchor.focus();
    };
    const draw = () =>
      pop.replaceChildren(
        navRow(
          year,
          () => {
            year = Math.max(1970, year - 1);
            draw();
          },
          () => {
            year = Math.min(2200, year + 1);
            draw();
          },
        ),
        h(
          'div',
          { class: 'mpop-g' },
          Array.from({ length: 12 }, (_, i) => {
            const k = year * 12 + i;
            return h('button', {
              type: 'button',
              class: (k === sel ? 'sel ' : '') + (k === now ? 'now' : ''),
              text: M.short(k),
              onclick: () => choose(M.key(k)),
            });
          }),
        ),
        h(
          'div',
          { class: 'mpop-f' },
          btn($t('This month'), () => choose(M.key(now)), 'sm ghost'),
          empty ? btn(empty, () => choose(null), 'sm ghost') : null,
        ),
      );
    draw();
  });
}
function dayPop(anchor, value, empty, pick, min) {
  popover(anchor, $t('Choose a day'), pop => {
    const sel = D.parse(value);
    const today = D.today();
    const lo = D.parse(min);
    let k = D.month(sel !== null ? sel : lo !== null ? lo : today);
    const choose = v => {
      closePop();
      pick(v);
      anchor.focus();
    };
    const draw = () => {
      const y = Math.floor(k / 12);
      const m = k % 12;
      const first = D.of(y, m, 1);
      const dim = D.of(y, m + 1, 1) - first;
      const lead = (D.dow(first) + 6) % 7;
      pop.replaceChildren(
        navRow(
          M.label(k, true),
          () => {
            k = Math.max(1970 * 12, k - 1);
            draw();
          },
          () => {
            k = Math.min(2200 * 12, k + 1);
            draw();
          },
        ),
        h(
          'div',
          { class: 'dpop-g' },
          [$t('Mo'), $t('Tu'), $t('We'), $t('Th'), $t('Fr'), $t('Sa'), $t('Su')].map(t => h('span', { text: t })),
          Array.from({ length: lead }, () => h('span')),
          Array.from({ length: dim }, (_, i) => {
            const n = first + i;
            return h('button', {
              type: 'button',
              class: (n === sel ? 'sel ' : '') + (n === today ? 'now ' : '') + (D.weekend(n) ? 'we' : ''),
              text: i + 1,
              disabled: lo !== null && n < lo,
              onclick: () => choose(D.key(n)),
            });
          }),
        ),
        h(
          'div',
          { class: 'mpop-f' },
          btn($t('Today'), () => choose(D.key(today)), 'sm ghost'),
          empty ? btn(empty, () => choose(null), 'sm ghost') : null,
        ),
      );
    };
    draw();
  });
}
/** A button that shows a month (or a day, with day:true) and opens the picker. `empty` labels "no value" and enables clearing. */
export function monthField({ value, onChange, empty, sm, day, min }) {
  const lab = h('span');
  const b = h(
    'button',
    { type: 'button', class: 'mbtn' + (sm ? ' sm' : ''), 'aria-haspopup': 'dialog' },
    lab,
    icon('calendar'),
  );
  const set = v => {
    value = v;
    lab.textContent = v
      ? day
        ? D.label(D.parse(v), { weekday: 'short', year: 'numeric' })
        : M.label(M.parse(v), true)
      : empty || (day ? $t('Pick a day') : $t('Pick a month'));
    b.classList.toggle('unset', !v);
  };
  set(value || null);
  b.setValue = set;
  b.addEventListener('click', () =>
    POP && POP.anchor === b
      ? closePop()
      : (day ? dayPop : monthPop)(
          b,
          value,
          empty,
          v => {
            set(v);
            onChange(v);
          },
          typeof min === 'function' ? min() : min,
        ),
  );
  return b;
}

/* --- 6.4 money input with a live number mask ---
   Shows 1.234,56 or 1,234.56 while typing (per the plan's number style). The value handed to the app is always a plain number.
   Typing either . or , starts the decimals; sums like 120+35 work. */
