/**
 * @file The toolbar above a list or table: search, filter chips, sort, "12 of 64 · −431,20 €", Clear (v0.9 audit, C12).
 * The rows themselves are filtered and sorted by applyQuery in logic/listQuery.js; this file only draws the controls.
 *
 * Usage (one config object per list):
 *   const query = listState('bills', { sort: null });
 *   const result = applyQuery(rows, query, FIELDS);
 *   listToolbar({ id: 'bills', query, fields: FIELDS, result, filters: ['cat'], sorts: ['name', 'amount'], sumKey: 'amount' })
 */
import { signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { isFiltered, optionLabel } from '../../logic/listQuery.js';
import { App } from '../app.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { UI } from '../state.js';
import { btn } from './button.js';
import { popover } from './popover.js';

/** The query of one list for this visit, created with `defaults` the first time. */
export function listState(id, defaults = {}) {
  if (!UI.lists[id]) {
    UI.lists[id] = { text: '', filters: {}, sort: null, ...defaults };
  }
  return UI.lists[id];
}

/** Redraws the page and puts the focus back where it was (the search field, or a filter chip whose pop-up stays open). */
function redraw(id, focusKey, reopen) {
  App.render();
  const target = document.querySelector(`[data-list="${id}"] [data-focus="${focusKey}"]`);
  if (!target) {
    return;
  }
  target.focus();
  if (target.tagName === 'INPUT') {
    target.setSelectionRange(target.value.length, target.value.length);
  }
  if (reopen) {
    reopen(target);
  }
}

/** One filter chip: shows how many values are picked and opens a pop-up with a box per value. */
function filterChip(id, query, field, values) {
  const picked = query.filters[field.key] || [];
  const open = anchor =>
    popover(anchor, field.label, pop => {
      pop.classList.add('listfilter');
      pop.append(
        ...values.map(value =>
          h(
            'label',
            { class: 'listfilter-o' },
            h('input', {
              type: 'checkbox',
              checked: picked.includes(value),
              onchange: event => {
                const next = new Set(query.filters[field.key] || []);
                if (event.target.checked) {
                  next.add(value);
                } else {
                  next.delete(value);
                }
                query.filters = { ...query.filters, [field.key]: [...next] };
                redraw(id, 'filter:' + field.key, open);
              },
            }),
            h('span', { text: String(optionLabel(field, value) ?? $t('None')) || $t('None') }),
          ),
        ),
      );
    });
  return h(
    'button',
    {
      type: 'button',
      class: 'chip listchip' + (picked.length ? ' acc' : ''),
      'data-focus': 'filter:' + field.key,
      'aria-haspopup': 'dialog',
      onclick: event => open(event.currentTarget),
    },
    picked.length ? $t('{0}: {1}', field.label, picked.length) : field.label,
    icon('right'),
  );
}

/**
 * @param {object} options
 * @param {string} options.id list id (state in UI.lists[id])
 * @param {object} options.query from listState
 * @param {object[]} options.fields the list's fields (see logic/listQuery.js)
 * @param {{total: number, shown: number, sums: object}} options.result from applyQuery
 * @param {string[]} [options.filters] keys of enum fields to offer as filter chips
 * @param {string[]} [options.sorts] keys offered in the sort menu
 * @param {?string} [options.customSort] label of the "no sort" entry (e.g. "Custom (drag)"); omit when there is none
 * @param {?string} [options.sumKey] money field whose total of the shown rows is printed
 * @param {any[]} [options.rows] all rows, to list the values of each filter
 */
export function listToolbar({
  id,
  query,
  fields,
  result,
  filters = [],
  sorts = [],
  customSort = null,
  sumKey = null,
  rows = [],
}) {
  const byKey = Object.fromEntries(fields.map(field => [field.key, field]));
  let timer = 0;
  const search = h('input', {
    type: 'search',
    class: 'inp',
    value: query.text,
    placeholder: $t('Search…'),
    'aria-label': $t('Search this list'),
    'data-focus': 'search',
    oninput: event => {
      clearTimeout(timer);
      const text = event.target.value;
      timer = setTimeout(() => {
        query.text = text;
        redraw(id, 'search');
      }, 150);
    },
  });
  const chips = filters
    .filter(key => byKey[key])
    .map(key => {
      const field = byKey[key];
      const values = field.options
        ? field.options.map(option => option[0])
        : [...new Set(rows.map(row => field.value(row)))].filter(value => value !== undefined);
      return values.length > 1 ? filterChip(id, query, field, values) : null;
    });
  const sortOptions = [
    ...(customSort ? [['', customSort]] : []),
    ...sorts
      .filter(key => byKey[key])
      .flatMap(key => [
        [key + ':asc', byKey[key].label + ' ↑'],
        [key + ':desc', byKey[key].label + ' ↓'],
      ]),
  ];
  const currentSort = query.sort ? query.sort.key + (query.sort.descending ? ':desc' : ':asc') : '';
  const sortSelect = sortOptions.length
    ? h(
        'select',
        {
          class: 'inp',
          'aria-label': $t('Sort'),
          'data-focus': 'sort',
          onchange: event => {
            const [key, direction] = event.target.value.split(':');
            query.sort = key ? { key, descending: direction === 'desc' } : null;
            redraw(id, 'sort');
          },
        },
        sortOptions.map(([value, label]) => h('option', { value, selected: value === currentSort, text: label })),
      )
    : null;
  const filtered = isFiltered(query);
  const sum = sumKey && result.sums[sumKey] !== undefined ? ' · ' + signed(result.sums[sumKey]) : '';
  return h(
    'div',
    { class: 'listbar', 'data-list': id },
    search,
    chips,
    sortSelect,
    h('span', {
      class: 'muted small listcount',
      text: filtered ? $t('{0} of {1}', result.shown, result.total) + sum : String(result.total) + sum,
    }),
    filtered
      ? btn(
          $t('Clear'),
          () => {
            query.text = '';
            query.filters = {};
            App.render();
          },
          'ghost sm',
        )
      : null,
  );
}
