/**
 * @file Declarative forms: formModal({ fields, values, onSave }) builds an editing window from a list of field descriptions.
 */
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { btn, ibtn } from './button.js';
import { info } from './info.js';
import { autosaver, modal } from './modal.js';
import { moneyInp } from './moneyInput.js';
import { monthField } from './pickers.js';
import { h } from '../dom.js';

export const NOTE = {
  k: 'note',
  type: 'area',
  label: $t('Notes'),
  ph: $t('Optional. Anything worth remembering: what it is for, prices, a link…'),
};
function fieldEl(f, v, ctx) {
  if (f.type === 'sec') {
    return h('div', { class: 'form-sec', text: f.label });
  }
  // a block drawn by the caller; apply(changes) sets values, redraws the form and counts as an edit
  if (f.type === 'custom') {
    const apply = changes => {
      Object.assign(v, changes);
      ctx.redraw();
      ctx.touch();
    };
    return f.render(v, apply);
  }
  const changed = () => {
    if (f.then) {
      for (const k of f.then(v) || []) {
        if (ctx.refs[k]) {
          ctx.refs[k]();
        }
      }
    }
    ctx.touch();
    if (f.live) {
      ctx.redraw();
    }
  };
  let c;
  let tag = 'label';
  let extra = null;
  if (f.type === 'text' || f.type === 'pass') {
    const lid = f.list && f.list.length ? 'l' + uid() : null;
    c = h('input', {
      class: 'inp',
      type: f.type === 'pass' ? 'password' : 'text',
      value: v[f.k] || '',
      maxlength: f.max || 80,
      placeholder: f.ph || '',
      autocomplete: f.type === 'pass' ? 'new-password' : 'off',
      list: lid,
    });
    c.addEventListener('input', () => {
      v[f.k] = c.value;
      changed();
    });
    if (lid) {
      extra = h(
        'datalist',
        { id: lid },
        f.list.map(o => h('option', { value: o })),
      );
    }
  } else if (f.type === 'area') {
    c = h('textarea', { class: 'inp', rows: 2, maxlength: f.max || 400, placeholder: f.ph || '' });
    c.value = v[f.k] || '';
    c.addEventListener('input', () => {
      v[f.k] = c.value;
      changed();
    });
  } else if (f.type === 'money') {
    c = moneyInp({
      value: v[f.k],
      blank: f.blank,
      neg: f.neg,
      ph: f.ph,
      onInput: n => {
        v[f.k] = n;
        changed();
      },
    });
    ctx.refs[f.k] = () => c.setNum(v[f.k]);
  } else if (f.type === 'num') {
    c = h('input', {
      class: 'inp num',
      type: 'number',
      value: v[f.k] == null || (f.blank && !v[f.k]) ? '' : v[f.k],
      min: f.min,
      max: f.max,
      step: f.step || 'any',
      placeholder: f.ph || '',
    });
    c.addEventListener('input', () => {
      const x = parseFloat(c.value);
      v[f.k] = isFinite(x) ? x : f.blank ? null : 0;
      changed();
    });
  } else if (f.type === 'time') {
    // a time of day, 'HH:MM', or '' when left empty (the browser's own time picker)
    c = h('input', { class: 'inp num', type: 'time', value: v[f.k] || '', step: 60 });
    c.addEventListener('input', () => {
      v[f.k] = c.value;
      changed();
    });
  } else if (f.type === 'select') {
    c = h(
      'select',
      { class: 'inp' },
      f.options.map(o => h('option', { value: String(o[0]), text: o[1] })),
    );
    c.value = String(v[f.k] == null ? '' : v[f.k]);
    if (c.selectedIndex < 0) {
      c.selectedIndex = 0;
      v[f.k] = f.numeric ? +c.value : c.value;
    }
    c.addEventListener('change', () => {
      v[f.k] = f.numeric ? +c.value : c.value;
      changed();
    });
  } else if (f.type === 'month' || f.type === 'date') {
    tag = 'div';
    c = monthField({
      value: v[f.k],
      empty: f.empty,
      day: f.type === 'date',
      onChange: x => {
        v[f.k] = x;
        changed();
      },
    });
    ctx.refs[f.k] = () => c.setValue(v[f.k] || null);
  } else if (f.type === 'seg') {
    tag = 'div';
    c = h(
      'div',
      { class: 'seg' },
      f.options.map(o =>
        h('button', {
          type: 'button',
          'aria-pressed': String(v[f.k] === o[0]),
          text: o[1],
          onclick: () => {
            v[f.k] = o[0];
            if (f.then) {
              f.then(v);
            }
            ctx.touch();
            ctx.redraw();
          },
        }),
      ),
    );
  } else if (f.type === 'lines') {
    // a short list of rows (name, optional category, amount) that can grow: v[f.k] is an array of { name, cat, amount }
    tag = 'div';
    const rows = v[f.k];
    c = h(
      'div',
      { class: 'lines' },
      rows.map((row, index) =>
        h(
          'div',
          { class: 'lines-row' + (f.cats ? ' with-cat' : '') },
          (() => {
            const name = h('input', {
              class: 'inp',
              type: 'text',
              value: row.name,
              maxlength: 60,
              placeholder: f.ph || '',
              'aria-label': f.label,
            });
            name.addEventListener('input', () => {
              row.name = name.value;
              changed();
            });
            return name;
          })(),
          f.cats
            ? (() => {
                const cat = h(
                  'select',
                  { class: 'inp', 'aria-label': $t('Category') },
                  f.cats.map(o => h('option', { value: o[0], text: o[1], selected: o[0] === row.cat })),
                );
                cat.addEventListener('change', () => {
                  row.cat = cat.value;
                  changed();
                });
                return cat;
              })()
            : null,
          moneyInp({
            value: row.amount,
            label: $t('Amount'),
            onInput: n => {
              row.amount = n || 0;
              changed();
            },
          }),
          ibtn(
            $t('Remove'),
            () => {
              rows.splice(index, 1);
              ctx.touch();
              ctx.redraw();
            },
            'sm ghost',
            'trash',
          ),
        ),
      ),
      btn(
        f.add || $t('Add a line'),
        () => {
          rows.push({ name: '', cat: f.cats ? f.cats[0][0] : '', amount: 0 });
          ctx.touch();
          ctx.redraw();
        },
        'sm ghost',
        'plus',
      ),
    );
  } else if (f.type === 'toggle') {
    tag = 'div';
    const cb = h('input', { type: 'checkbox', checked: !!v[f.k] });
    cb.addEventListener('change', () => {
      v[f.k] = cb.checked;
      changed();
    });
    c = h('label', { class: 'switch' }, cb, h('span', { text: f.text || '' }));
  }
  const hint = typeof f.hint === 'function' ? f.hint(v) : f.hint;
  return h(
    tag,
    { class: 'fld' + (f.half ? ' half' : '') },
    h('span', { class: 'fld-l' }, f.label, f.info ? info(f.info) : null),
    c,
    extra,
    hint ? h('span', { class: 'fld-h', text: hint }) : null,
  );
}
/**
 * Declarative form in a modal. onSave(values) returns an error string to keep the modal open.
 * auto:true lets the form follow the autosave setting. Types: text, pass, area, money, num, select, month, date,
 * time ('HH:MM' or ''), seg, lines, toggle, sec, custom. Field options: show(v), live (redraw on change), then(v) -> keys of other fields to refresh,
 * hint (short line under the field), info (longer explanation behind an "i" button).
 * type 'custom': render(values, apply) returns an element; apply({ key: value }) fills fields (e.g. quick picks).
 */
export function formModal({ title, fields, values, onSave, onDelete, saveLabel, preview, extra, wide, auto }) {
  const v = { ...values };
  const fid = 'f' + uid();
  const form = h('form', { class: 'form', id: fid, novalidate: true });
  const err = h('div', { class: 'form-err', role: 'alert' });
  const pv = preview ? h('div', { class: 'preview' }) : null;
  const A = autosaver(
    () => {
      const m = onSave(v);
      err.textContent = m || '';
      return !m;
    },
    !!auto,
    () => v,
  );
  const isAuto = A.on;
  const prev = () => {
    if (pv) {
      const t = preview(v);
      pv.textContent = t || '';
      pv.hidden = !t;
    }
  };
  const ctx = {
    refs: {},
    touch: () => {
      prev();
      A.touch();
    },
    redraw: () => draw(),
  };
  const draw = () => {
    ctx.refs = {};
    form.replaceChildren(...fields.filter(f => !f.show || f.show(v)).map(f => fieldEl(f, v, ctx)));
    if (pv) {
      form.append(pv);
    }
    prev();
  };
  draw();
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (A.submit()) {
      d.close();
    }
  });
  const d = modal({
    title,
    wide,
    body: form,
    err,
    onClose: () => A.flush(),
    guard: () => A.dirty,
    foot: [
      onDelete
        ? btn(
            $t('Delete'),
            () => {
              A.discard();
              d.close();
              onDelete();
            },
            'danger ghost',
            'trash',
          )
        : isAuto
          ? btn(
              $t('Discard'),
              () => {
                A.discard();
                d.close();
              },
              'ghost',
            )
          : null,
      (extra || []).map(x =>
        btn(
          x[0],
          () => {
            d.close();
            x[1]();
          },
          'ghost',
        ),
      ),
      h('span', { class: 'sp' }),
      A.foot(),
      isAuto ? null : btn($t('Cancel'), () => d.close(), 'ghost'),
      h('button', {
        type: 'submit',
        form: fid,
        class: 'btn primary',
        text: isAuto ? $t('Done') : saveLabel || $t('Save'),
      }),
    ],
  });
  const first = form.querySelector('input,select');
  if (first) {
    first.focus();
    if (first.select && !values.id) {
      first.select();
    }
  }
  return d;
}
