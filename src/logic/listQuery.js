/**
 * @file Search, filter and sort for any list or table (v0.9 audit, C12). Pure: rows in, rows out.
 *
 * Each list describes its columns once as `fields`:
 *   { key, label, value: row => any, type: 'text' | 'money' | 'number' | 'date' | 'month' | 'enum', options? }
 * and keeps a `query`:
 *   { text: string, filters: { [key]: value[] }, sort: { key, descending } | null }
 */
import { normaliseText } from './search.js';

const isEmpty = value => value === null || value === undefined || value === '';

/** Order two values: numbers by size, text alphabetically (accents and case ignored), empty values always last. */
export function compareValues(first, second) {
  if (isEmpty(first) || isEmpty(second)) {
    return Number(isEmpty(first)) - Number(isEmpty(second));
  }
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second;
  }
  return String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * The rows that match the query, in its order, with counts and the sum of every money field over what is shown.
 * - text: matches any text, enum or money field, accent- and case-insensitive ("mama" finds "Mamă" and "Mamá").
 * - filters: AND across fields, OR within one field (Category = Food or Fun, and Budget = Groceries).
 * - sort: stable (equal values keep their order); empty values last in both directions.
 * @returns {{rows: any[], total: number, shown: number, sums: Object<string, number>}}
 */
export function applyQuery(rows, query, fields) {
  const byKey = Object.fromEntries(fields.map(field => [field.key, field]));
  const text = normaliseText(query && query.text).trim();
  const searchable = fields.filter(field => field.type === 'text' || field.type === 'enum' || field.search);
  const filters = Object.entries((query && query.filters) || {}).filter(
    ([key, values]) => byKey[key] && Array.isArray(values) && values.length,
  );
  let result = rows.filter(row => {
    for (const [key, values] of filters) {
      if (!values.includes(byKey[key].value(row))) {
        return false;
      }
    }
    if (!text) {
      return true;
    }
    return searchable.some(field => {
      const raw = field.value(row);
      const shown = field.options ? optionLabel(field, raw) : raw;
      return normaliseText(shown).includes(text);
    });
  });
  const sort = query && query.sort && byKey[query.sort.key] ? query.sort : null;
  if (sort) {
    const field = byKey[sort.key];
    const direction = sort.descending ? -1 : 1;
    result = result
      .map((row, position) => ({ row, position, value: field.value(row) }))
      .sort((a, b) => {
        if (isEmpty(a.value) || isEmpty(b.value)) {
          return compareValues(a.value, b.value) || a.position - b.position;
        }
        return compareValues(a.value, b.value) * direction || a.position - b.position;
      })
      .map(item => item.row);
  }
  const sums = {};
  for (const field of fields.filter(candidate => candidate.type === 'money')) {
    sums[field.key] = Math.round(result.reduce((sum, row) => sum + (Number(field.value(row)) || 0), 0) * 100) / 100;
  }
  return { rows: result, total: rows.length, shown: result.length, sums };
}

/** The label of an option value of an enum field (what the user sees and searches). */
export function optionLabel(field, value) {
  const option = (field.options || []).find(candidate => candidate[0] === value);
  return option ? option[1] : value;
}

/** True when the query narrows the list (search text or any filter), so the UI can offer "Clear". */
export const isFiltered = query =>
  !!(
    query &&
    ((query.text || '').trim() || Object.values(query.filters || {}).some(values => values && values.length))
  );
