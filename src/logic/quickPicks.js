/**
 * @file Quick picks for "Add transaction": what you log most often, so a daily spend is one tap. Pure.
 */
import { normaliseText } from './search.js';

/**
 * The most frequent spends in the log: same name (ignoring case and accents) and same budget.
 * The amount is filled in only when it never changed (e.g. the same 15,75 every time).
 * @param {import('../types.js').Item[]} items the purchase log
 * @param {number} [limit] how many picks
 * @returns {{name: string, budget: ?string, cat: string, amount: ?number, count: number}[]}
 *   most used first; ties go to the most recently logged. Only things logged at least twice.
 */
export function quickPicks(items, limit = 5) {
  const groups = new Map();
  items.forEach((item, position) => {
    if (item.kind !== 'out' || !String(item.name || '').trim()) {
      return;
    }
    const key = normaliseText(item.name).trim() + '|' + (item.budget || '');
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        name: item.name,
        budget: item.budget || null,
        cat: item.cat,
        amounts: new Set([item.amount]),
        count: 1,
        last: Math.max(position, dateRank(item)),
      });
      return;
    }
    group.count++;
    group.amounts.add(item.amount);
    group.last = Math.max(group.last, position, dateRank(item));
  });
  return [...groups.values()]
    .filter(group => group.count >= 2)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map(group => ({
      name: group.name,
      budget: group.budget,
      cat: group.cat,
      amount: group.amounts.size === 1 ? [...group.amounts][0] : null,
      count: group.count,
    }));
}

/** A later date ranks higher; undated items rank by their place in the log only. */
const dateRank = item => (item.date ? Number(String(item.date).replace(/-/g, '')) : 0);
