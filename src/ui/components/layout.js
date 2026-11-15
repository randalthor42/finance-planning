/**
 * @file Page building blocks: page, card, row, tile, chip, bar, segmented control, empty state.
 */
import { money, signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { btn, ibtn } from './button.js';
import { designGrid, designToggle } from './designGrid.js';
import { ctxMenu } from './popover.js';
import { h } from '../dom.js';
import { remove } from '../helpers.js';
import { icon } from '../icons.js';
import { UI } from '../state.js';

/* --- 6.8 shared view pieces --- */
export const page = (title, sub, acts, ...body) => [
  h(
    'div',
    { class: 'head' },
    h('div', null, h('h1', { text: title }), sub ? h('p', { text: sub }) : null),
    h('div', { class: 'acts' }, acts),
  ),
  ...body,
];
/**
 * A page whose cards can be arranged: the usual head with a "Design mode" checkbox beside `acts`, and the cards on a
 * grid of 12 columns. `key` names the page for its saved layout; `cards` are GridCard objects (see designGrid.js):
 * { id, title, el, w, h }, in their default order. `options` go to designGrid (layoutKey, ordered, note), and
 * `options.before` (a search bar, say) is shown between the head and the cards.
 */
export const designPage = (key, title, sub, acts, cards, options = {}) =>
  page(title, sub, [acts, designToggle(key)], options.before, designGrid(key, cards, options));
export const card = (title, sub, right, ...body) =>
  h(
    'section',
    { class: 'card' },
    title
      ? h(
          'div',
          { class: 'card-h' },
          h('div', null, h('h2', { text: title }), sub ? h('p', { text: sub }) : null),
          right,
        )
      : null,
    ...body,
  );
export const empty = (title, text, label, fn) =>
  h(
    'div',
    { class: 'empty' },
    h('b', { text: title }),
    text,
    label ? h('div', null, btn(label, fn, 'primary', 'plus')) : null,
  );
export const amt = (n, plain) =>
  h('span', { class: 'amt' + (n > 0 && !plain ? ' good' : ''), text: plain ? money(n) : signed(n) });
export const chip = (text, tone) => h('span', { class: 'chip ' + (tone || ''), text });
export const tile = (l, v, className, s) =>
  h(
    'div',
    { class: 'tile' },
    h('div', { class: 'l', text: l }),
    h('div', { class: 'v ' + (className || ''), text: v }),
    s ? h('div', { class: 's', text: s }) : null,
  );
export const bar = (pct, className) =>
  h('div', { class: 'bar ' + (className || '') }, h('i', { style: `width:${clamp(pct, 0, 100)}%` }));
export const prow = (name, right, pct, className, onclick) => {
  const r = h(
    'div',
    { class: 'prow' },
    h('div', { class: 'top' }, h('span', { text: name }), h('span', { text: right })),
    bar(pct, className),
  );
  if (onclick) {
    r.style.cursor = 'pointer';
    r.addEventListener('click', onclick);
  }
  return r;
};
export const segc = (opts, current, fn) =>
  h(
    'div',
    { class: 'seg' },
    opts.map(o =>
      h('button', { type: 'button', 'aria-pressed': String(current === o[0]), text: o[1], onclick: () => fn(o[0]) }),
    ),
  );
export function row({ title, desc: description, right, onclick, cls: className, left, chips, extra, del, menu }) {
  const r = h(
    'div',
    { class: 'row ' + (onclick ? 'click ' : '') + (className || '') },
    left,
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 't' }, title, ' ', chips),
      description ? h('div', { class: 'd', text: description }) : null,
      extra,
    ),
    right,
    del
      ? h(
          'button',
          {
            type: 'button',
            class: 'rowdel',
            'aria-label': $t('Delete {0}', typeof title === 'string' ? title : ''),
            title: $t('Delete'),
            onclick: e => {
              e.stopPropagation();
              del();
            },
          },
          icon('trash'),
        )
      : null,
  );
  if (onclick) {
    r.tabIndex = 0;
    r.setAttribute('role', 'button');
    r.addEventListener('click', onclick);
    r.addEventListener('keydown', e => {
      if (e.target === r && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onclick();
      } else if (e.target === r && e.key === 'Delete' && del) {
        del();
      }
    });
  }
  if (menu || del) {
    r.addEventListener('contextmenu', e =>
      ctxMenu(e, [onclick ? [$t('Edit'), onclick] : null, ...(menu || []), del ? [$t('Delete'), del, 'danger'] : null]),
    );
  }
  return r;
}
export const mono = name => {
  let hue = 0;
  for (const ch of name) {
    hue = (hue * 31 + ch.codePointAt(0)) % 360;
  }
  return h('span', {
    class: 'mono',
    style: `background:hsl(${hue} 42% 42%)`,
    'aria-hidden': 'true',
    text: (name.trim()[0] || '?').toUpperCase(),
  });
};
/** A ⋯ button that opens a menu of [label, action, class] items (Edit, Delete…), keeping card headers to one line. */
export const moreMenu = items =>
  h(
    'button',
    {
      type: 'button',
      class: 'btn icon ghost sm',
      'aria-label': $t('More actions'),
      title: $t('More actions'),
      'aria-haspopup': 'menu',
      onclick: event => ctxMenu(event, items),
    },
    icon('menu'),
  );
export const cardDel = (list, id) => ibtn($t('Delete'), () => remove(list, id), 'ghost sm', 'trash');
export const keep = (key, summary, build) => {
  const d = h('details', { class: 'more', open: UI.open.has(key) }, h('summary', { text: summary }));
  const fill = () => {
    if (d.open && d.children.length === 1) {
      d.append(build());
    }
  };
  d.addEventListener('toggle', () => {
    d.open ? UI.open.add(key) : UI.open.delete(key);
    fill();
  });
  fill();
  return d;
};
export const budgetText = b =>
  b.reserve === false
    ? // a tracked budget sets nothing aside: its amount is only a limit to watch
      $t('{0} spent · limit {1} · ', money(b.spent), money(b.planned)) +
      (b.left >= 0 ? $t('{0} under', money(b.left)) : $t('{0} over', money(-b.left)))
    : $t('{0} spent of {1} · ', money(b.spent), money(b.planned)) +
      (b.left >= 0 ? $t('{0} left', money(b.left)) : $t('{0} over', money(-b.left)));
