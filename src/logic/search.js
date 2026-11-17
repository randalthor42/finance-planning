/**
 * @file Search across everything in a plan: income, bills, subscriptions, purchases, trips, wishlist, goals, loans, accounts,
 * and My calendar (appointments and drafts). Pure.
 *
 * To make a new kind of record searchable, add one entry to SOURCES.
 */

/** Lower case, without accents, so "cafe" finds "Café". */
export const normaliseText = text =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Where to look. `type` is what the UI uses to open the right window; `amount` is shown next to the result.
 * Trip costs are found through their trip. A source outside the plan's top-level lists says where its records are
 * (`records`), and may name them differently (`name`) and give a day (`date`): My calendar's appointments and drafts.
 */
const SOURCES = [
  { type: 'income', list: 'incomes', amount: record => record.amount, texts: record => [record.name, record.note] },
  {
    type: record => (record.cat === 'subs' ? 'subscription' : record.budget ? 'budget' : 'bill'),
    list: 'bills',
    amount: record => record.amount,
    texts: record => [record.name, record.note],
  },
  { type: 'purchase', list: 'items', amount: record => record.amount, texts: record => [record.name, record.note] },
  {
    type: 'trip',
    list: 'trips',
    amount: record => record.items.reduce((sum, cost) => sum + cost.amount, 0),
    texts: record => [record.name, record.note, ...record.items.flatMap(cost => [cost.name, cost.note])],
  },
  {
    type: 'wish',
    list: 'wishes',
    amount: record => record.price,
    texts: record => [record.name, record.note, record.link],
  },
  { type: 'goal', list: 'goals', amount: record => record.target, texts: record => [record.name, record.note] },
  { type: 'loan', list: 'loans', amount: record => record.amount, texts: record => [record.name, record.note] },
  { type: 'account', list: 'accounts', amount: record => record.balance, texts: record => [record.name, record.note] },
  {
    type: 'appointment',
    list: 'agenda',
    records: plan => (plan.agenda ? plan.agenda.entries : []),
    name: record => record.title,
    date: record => record.date,
    amount: record => (record.amount > 0 ? record.amount : null),
    texts: record => [record.title, record.note],
  },
  {
    type: 'draft',
    list: 'drafts:items',
    records: plan => (plan.agenda ? plan.agenda.drafts.items : []),
    date: record => record.date,
    amount: record => record.amount,
    texts: record => [record.name, record.note],
  },
  {
    type: 'draft',
    list: 'drafts:trips',
    records: plan => (plan.agenda ? plan.agenda.drafts.trips : []),
    date: record => record.from,
    amount: record => record.items.reduce((sum, cost) => sum + cost.amount, 0),
    texts: record => [record.name, record.note, ...record.items.flatMap(cost => [cost.name, cost.note])],
  },
];

/**
 * @param {import('../types.js').Plan} plan
 * @param {string} query What the user typed. Every word must be found somewhere in the record.
 * @param {number} [limit] Most results to return.
 * @returns {{type: string, list: string, id: string, name: string, amount: ?number, month: ?string, date: ?string}[]}
 *   Results whose name starts with the query come first. `amount` is null for an appointment without money.
 */
export function searchPlan(plan, query, limit = 30) {
  const words = normaliseText(query).split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [];
  }
  const results = [];
  for (const source of SOURCES) {
    for (const record of (source.records ? source.records(plan) : plan[source.list]) || []) {
      const haystack = normaliseText(source.texts(record).filter(Boolean).join(' '));
      if (!words.every(word => haystack.includes(word))) {
        continue;
      }
      const name = source.name ? source.name(record) : record.name;
      results.push({
        type: typeof source.type === 'function' ? source.type(record) : source.type,
        list: source.list,
        id: record.id,
        name,
        amount: source.amount(record),
        month: record.month || null,
        date: (source.date && source.date(record)) || null,
        startsWith: normaliseText(name).startsWith(words[0]),
      });
    }
  }
  results.sort((first, second) => Number(second.startsWith) - Number(first.startsWith));
  return results.slice(0, limit).map(({ startsWith, ...result }) => result);
}
