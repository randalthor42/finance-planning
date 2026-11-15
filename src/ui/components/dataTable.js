/**
 * @file A table whose columns sort when you click their title, like a data table. One arrow shows the sorted column.
 *
 * Usage:
 *   dataTable({
 *     id: 'trips',                       // remembers the sort for this table while the page is open
 *     rows: trips,
 *     columns: [
 *       { label: $t('Name'), value: trip => trip.name, cell: trip => h('b', { text: trip.name }) },
 *       { label: $t('Cost'), value: trip => trip.total, cell: trip => money(trip.total) },
 *       { label: '', cell: trip => buttons(trip) },   // no `value`: this column does not sort
 *     ],
 *     rowProps: trip => ({ class: trip.on ? '' : 'dim' }),
 *     foot: [...cells],                   // optional totals row
 *   })
 * Cells are right-aligned (amounts) except the first column; `align: 'left'` on a column left-aligns a text column.
 * `pageSize: 200` draws only the first 200 rows (after sorting) with a "Show {0} more" button: long ledgers stay fast.
 */
import { $t } from '../../core/i18n.js';
import { App } from '../app.js';
import { h } from '../dom.js';
import { UI } from '../state.js';

/** Order two sort values: numbers by size, text alphabetically, empty values last. */
function compareValues(first, second) {
  const firstEmpty = first === null || first === undefined || first === '';
  const secondEmpty = second === null || second === undefined || second === '';
  if (firstEmpty || secondEmpty) {
    return Number(firstEmpty) - Number(secondEmpty);
  }
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second;
  }
  return String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: 'base' });
}

/** The rows in the order chosen for this table. Pure: the input array is not changed. */
export function sortRows(rows, columns, sort) {
  const column = sort ? columns[sort.column] : null;
  if (!column || !column.value) {
    return rows;
  }
  const direction = sort.descending ? -1 : 1;
  return rows
    .map((row, position) => ({ row, position }))
    .sort((a, b) => {
      const order = compareValues(column.value(a.row), column.value(b.row));
      // equal values keep their original order, so sorting is stable and predictable
      return order === 0 ? a.position - b.position : order * direction;
    })
    .map(item => item.row);
}

export function dataTable({ id, rows, columns, rowProps, foot, maxHeight, pageSize }) {
  const sort = UI.sort[id] || null;
  const allRows = sortRows(rows, columns, sort);
  const limit = pageSize ? UI.tableLimit[id] || pageSize : Infinity;
  const sortedRows = allRows.length > limit ? allRows.slice(0, limit) : allRows;
  const hidden = allRows.length - sortedRows.length;

  const alignClass = column => (column.align === 'left' ? 'tl' : null);
  const headerCell = (column, position) => {
    if (!column.value) {
      return h('th', { class: alignClass(column), text: column.label });
    }
    const isSorted = sort && sort.column === position;
    const arrow = isSorted ? (sort.descending ? ' ▼' : ' ▲') : '';
    const onSort = () => {
      // first click: ascending. Second click on the same column: descending. Third: back to the original order.
      if (!isSorted) {
        UI.sort[id] = { column: position, descending: false };
      } else if (!sort.descending) {
        UI.sort[id] = { column: position, descending: true };
      } else {
        delete UI.sort[id];
      }
      App.render();
    };
    return h(
      'th',
      { class: alignClass(column), 'aria-sort': isSorted ? (sort.descending ? 'descending' : 'ascending') : 'none' },
      h(
        'button',
        {
          type: 'button',
          class: 'thsort' + (isSorted ? ' on' : ''),
          title: $t('Sort by this column'),
          onclick: onSort,
        },
        column.label,
        h('span', { class: 'tharrow', 'aria-hidden': 'true', text: arrow || ' ↕' }),
      ),
    );
  };

  const bodyRow = row => {
    const cells = columns.map(column => {
      const content = column.cell(row);
      const props = { ...(column.cellProps ? column.cellProps(row) : null) };
      if (column.align === 'left') {
        props.class = ((props.class || '') + ' tl').trim();
      }
      return typeof content === 'string' ? h('td', { ...props, text: content }) : h('td', props, content);
    });
    return h('tr', rowProps ? rowProps(row) : null, cells);
  };

  return h(
    'div',
    { class: 'tblw', style: maxHeight ? `max-height:${maxHeight}` : '' },
    h(
      'table',
      { class: 'dtable' },
      h('thead', null, h('tr', null, columns.map(headerCell))),
      h('tbody', null, sortedRows.map(bodyRow)),
      foot ? h('tfoot', null, h('tr', null, foot)) : null,
    ),
    hidden > 0
      ? h(
          'div',
          { class: 'tblmore' },
          h('button', {
            type: 'button',
            class: 'btn sm ghost',
            text: $t('Show {0} more', Math.min(hidden, pageSize)),
            onclick: () => {
              UI.tableLimit[id] = limit + pageSize;
              App.render();
            },
          }),
          h('span', { class: 'muted small', text: $t('{0} of {1} rows', sortedRows.length, allRows.length) }),
        )
      : null,
  );
}
