/**
 * @file Editing window for a trip, event or someday idea, with its list of costs.
 */
import { D, M, Period } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { tripSpan } from '../../logic/trips.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { info } from '../components/info.js';
import { autosaver, modal } from '../components/modal.js';
import { moneyInp } from '../components/moneyInput.js';
import { monthField } from '../components/pickers.js';
import { grip, moveIn, sortable } from '../components/sortable.js';
import { h } from '../dom.js';
import { find, remove, upsert } from '../helpers.js';
import { icon } from '../icons.js';
import { selK } from '../state.js';

const TRIP_KINDS = [
  ['trip', $t('Trip')],
  ['event', $t('Event or day out')],
  ['idea', $t('Someday idea')],
];
export function tripModal(id, preset) {
  const current = id && find('trips', id);
  const settings = Store.plan.settings;
  const t = current
    ? JSON.parse(JSON.stringify(current))
    : {
        id: uid(),
        name: '',
        kind: 'trip',
        month: M.key(selK()),
        from: null,
        to: null,
        on: true,
        budget: 0,
        reserve: true,
        note: '',
        items: [
          $t('Getting there'),
          $t('Place to stay'),
          $t('Food and drinks'),
          $t('Getting around'),
          $t('Activities'),
          $t('Gifts'),
        ].map(n => ({ id: uid(), name: n, amount: 0, pay: null, note: '' })),
        ...preset,
      };
  const rows = h('div');
  const total = h('b', { class: 'num' });
  const err = h('div', { class: 'form-err', role: 'alert' });
  const left = h('div', { class: 'preview', hidden: true });
  const opened = new Set(t.items.filter(i => i.note).map(i => i.id));
  const save = () => {
    if (!t.name.trim()) {
      err.textContent = $t('Give it a name.');
      return false;
    }
    if (t.from && t.to && D.parse(t.to) < D.parse(t.from)) {
      err.textContent = $t('The last day is before the first day.');
      return false;
    }
    err.textContent = '';
    upsert('trips', { ...t, items: A.on ? t.items : t.items.filter(i => i.name.trim() || i.amount) });
    return true;
  };
  const A = autosaver(save, true, () => t);
  const name = h('input', {
    class: 'inp',
    type: 'text',
    value: t.name,
    maxlength: 80,
    placeholder: $t('Weekend in Lisbon, concert in Barcelona…'),
    oninput: () => {
      t.name = name.value;
      A.touch();
    },
  });
  const sum = () => {
    const s = t.items.reduce((a, i) => a + i.amount, 0);
    total.textContent = money(s);
    left.hidden = !t.budget;
    left.textContent = t.budget
      ? (s <= t.budget
          ? $t('{0} of your {1} budget is planned. {2} left to plan.', money(s), money(t.budget), money(t.budget - s))
          : $t('You are {0} over your {1} budget.', money(s - t.budget), money(t.budget))) +
        ' ' +
        (s < t.budget && t.reserve
          ? $t(
              'Your plan counts the whole budget, {0}. Switch off “Reserve unplanned budget” below to count only the costs.',
              money(t.budget),
            )
          : $t('Your plan counts the costs: {0}.', money(s)))
      : '';
    left.style.background = !t.budget
      ? ''
      : s > t.budget
        ? 'var(--bad-soft)'
        : s >= t.budget * 0.9
          ? 'var(--warn-soft)'
          : 'var(--good-soft)';
  };
  const split = () => tripSpan(settings, t).length > 1;
  const splitNote = h('div', { class: 'preview', hidden: true });
  const draw = () => {
    const sp = tripSpan(settings, t);
    const nd = sp.reduce((s, x) => s + x[1], 0);
    splitNote.hidden = sp.length < 2 || t.kind === 'idea';
    splitNote.textContent =
      sp.length > 1
        ? $t(
            'This trip crosses a payday, so each cost is shared between the salary months by days: {0}. Pick a month on a cost to pay all of it there (tickets or a place you book ahead).',
            sp.map(([k, d]) => `${M.label(k)} ${Math.round((d / nd) * 100)}%`).join(' · '),
          )
        : '';
    rows.replaceChildren(
      ...t.items.map((item, i) => {
        const n = h('input', {
          class: 'inp',
          type: 'text',
          value: item.name,
          maxlength: 80,
          placeholder: $t('What'),
          'aria-label': $t('Cost name'),
          oninput: () => {
            item.name = n.value;
            A.touch();
          },
        });
        const nt = h('textarea', {
          class: 'inp tnote',
          rows: 2,
          maxlength: 400,
          placeholder: $t('Details: prices, opening times, a link…'),
          'aria-label': $t('Details for ') + (item.name || $t('this cost')),
          hidden: !opened.has(item.id),
          oninput: () => {
            item.note = nt.value;
            A.touch();
          },
        });
        nt.value = item.note || '';
        return h(
          'div',
          { class: 'titem' },
          grip(),
          n,
          moneyInp({
            value: item.amount,
            label: $t('Amount'),
            onInput: x => {
              item.amount = x;
              sum();
              A.touch();
            },
          }),
          monthField({
            value: item.pay,
            empty: split() ? $t('Shared by trip days') : $t('Paid in the trip month'),
            sm: true,
            onChange: v => {
              item.pay = v;
              A.touch();
            },
          }),
          h(
            'button',
            {
              type: 'button',
              class: 'btn ghost icon' + (item.note ? ' has' : ''),
              'aria-label': $t('Details and links'),
              title: $t('Details and links'),
              onclick: () => {
                opened.has(item.id) ? opened.delete(item.id) : opened.add(item.id);
                nt.hidden = !opened.has(item.id);
                if (!nt.hidden) {
                  nt.focus();
                }
              },
            },
            icon('edit'),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn ghost icon',
              'aria-label': $t('Remove cost'),
              onclick: () => {
                t.items.splice(i, 1);
                draw();
                A.touch();
              },
            },
            icon('x'),
          ),
          nt,
        );
      }),
    );
    sum();
  };
  draw();
  sortable(rows, '.titem', (a, b) => {
    moveIn(t.items, a, b);
    draw();
    A.touch();
  });
  const on = h('input', {
    type: 'checkbox',
    checked: t.on,
    onchange: () => {
      t.on = on.checked;
      A.touch();
    },
  });
  const rs = h('input', {
    type: 'checkbox',
    checked: t.reserve,
    onchange: () => {
      t.reserve = rs.checked;
      sum();
      A.touch();
    },
  });
  const note = h('textarea', {
    class: 'inp',
    rows: 2,
    maxlength: 400,
    placeholder: $t('Who is coming, what to book, links…'),
    oninput: () => {
      t.note = note.value;
      A.touch();
    },
  });
  note.value = t.note || '';
  const monthF = monthField({
    value: t.month,
    onChange: v => {
      t.month = v;
      A.touch();
    },
  });
  const opt = h('div', { class: 'form', style: 'grid-column:1/-1' });
  const toF = monthField({
    value: t.to,
    day: true,
    empty: $t('Same day'),
    min: () => t.from,
    onChange: v => {
      t.to = v;
      draw();
      A.touch();
    },
  });
  const fromF = monthField({
    value: t.from,
    day: true,
    empty: $t('Not set'),
    onChange: v => {
      t.from = v;
      if (v) {
        t.month = M.key(Period.of(settings, D.parse(v)));
        monthF.setValue(t.month);
        if (t.to && D.parse(t.to) < D.parse(v)) {
          t.to = null;
          toF.setValue(null);
        }
      }
      draw();
      A.touch();
    },
  });
  const dates = [
    [$t('First day'), fromF],
    [$t('Last day'), toF],
  ].map(([l, f]) => h('div', { class: 'fld half' }, h('span', { class: 'fld-l', text: l }), f));
  const kindSeg = h('div', { class: 'seg' });
  const drawKind = () => {
    kindSeg.replaceChildren(
      ...TRIP_KINDS.map(o =>
        h('button', {
          type: 'button',
          'aria-pressed': String(t.kind === o[0]),
          text: o[1],
          onclick: () => {
            t.kind = o[0];
            drawKind();
            A.touch();
          },
        }),
      ),
    );
    opt.hidden = t.kind === 'idea';
    kindHint.textContent =
      t.kind === 'idea'
        ? $t(
            'Somewhere you would like to go one day. It is not counted in your plan. The Trips page tells you the earliest month you could afford it.',
          )
        : t.kind === 'event'
          ? $t('A concert, a day out, a visit: anything with a date and costs.')
          : '';
  };
  const kindHint = h('span', { class: 'fld-h' });
  opt.append(
    ...dates,
    h(
      'div',
      { class: 'fld half' },
      h(
        'span',
        { class: 'fld-l' },
        $t('Budget month'),
        info(
          $t(
            'The month whose money pays for it. It is set from the first day, and you can change it. Single costs can be paid in other months: set that per cost below. A trip whose days cross a payday stays one trip, and its costs are shared between the two salary months by days.',
          ),
        ),
      ),
      monthF,
    ),
    h(
      'label',
      { class: 'fld half' },
      h('span', { class: 'fld-l', text: $t('Budget (optional)') }),
      moneyInp({
        value: t.budget,
        ph: $t('No budget'),
        onInput: x => {
          t.budget = x;
          sum();
          A.touch();
        },
      }),
    ),
  );
  const body = h(
    'div',
    { class: 'form' },
    h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: $t('Name') }), name),
    h('div', { class: 'fld' }, h('span', { class: 'fld-l', text: $t('Type') }), kindSeg, kindHint),
    opt,
    h(
      'div',
      { class: 'fld' },
      h(
        'span',
        { class: 'fld-l' },
        $t('Costs'),
        info(
          $t(
            'One line per cost. Pick the month a cost is really paid if you book it earlier (flights, tickets). The pencil opens a details box for prices and links. Drag the dots to reorder.',
          ),
        ),
      ),
      rows,
      h(
        'div',
        { class: 'row', style: 'border:0;padding:4px 0' },
        btn(
          $t('Add a cost'),
          () => {
            t.items.push({ id: uid(), name: '', amount: 0, pay: null, note: '' });
            draw();
            rows.lastChild.querySelector('input').focus();
          },
          'sm',
          'plus',
        ),
        h('span', { class: 'grow' }),
        h('span', { class: 'muted', text: $t('Total ') }),
        total,
      ),
    ),
    splitNote,
    left,
    h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: $t('Notes') }), note),
    h(
      'div',
      { class: 'fld half' },
      h(
        'label',
        { class: 'switch' },
        rs,
        h('span', { text: $t('Reserve unplanned budget') }),
        info(
          $t(
            'Keeps the part of the budget you have not planned yet set aside in the budget month, so it is not spent elsewhere.',
          ),
        ),
      ),
    ),
    h('div', { class: 'fld half' }, h('label', { class: 'switch' }, on, h('span', { text: $t('Count in my plan') }))),
  );
  drawKind();
  const d = modal({
    title: current
      ? $t('Edit ') + (current.kind === 'event' ? 'event' : current.kind === 'idea' ? 'idea' : 'trip')
      : $t('Plan a trip or event'),
    wide: true,
    body,
    err,
    onClose: () => A.flush(),
    guard: () => A.dirty,
    foot: [
      current
        ? btn(
            $t('Delete'),
            () => {
              A.discard();
              d.close();
              remove('trips', id);
            },
            'danger ghost',
            'trash',
          )
        : A.on
          ? btn(
              $t('Discard'),
              () => {
                A.discard();
                d.close();
              },
              'ghost',
            )
          : null,
      h('span', { class: 'sp' }),
      A.foot(),
      A.on ? null : btn($t('Cancel'), () => d.close(), 'ghost'),
      btn(
        A.on ? $t('Done') : $t('Save'),
        () => {
          if (A.submit()) {
            d.close();
          }
        },
        'primary',
      ),
    ],
  });
  name.focus();
}
