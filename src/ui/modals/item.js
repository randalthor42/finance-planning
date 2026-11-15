/**
 * @file "Add transaction": the one window for everything that happens once. Spent or received, from a budget or not,
 * today, on another day, or planned for a later month. Opened by every "Add transaction" / "Log a spend" button.
 */
import { D, M, Period } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { quickPicks } from '../../logic/quickPicks.js';
import { clamp, uid } from '../../core/util.js';
import { CATS, INCATS } from '../../models/categories.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { find, need, remove, upsert } from '../helpers.js';
import { h } from '../dom.js';
import { UI, curK, selK } from '../state.js';

/** One-tap picks from what you log most (Estanc 15,75…). Filling one only fills the form; nothing is saved yet. */
function quickPickField(plan) {
  const picks = quickPicks(plan.items);
  const budgetIds = new Set(plan.bills.filter(b => b.budget).map(b => b.id));
  return {
    k: 'picks',
    type: 'custom',
    show: v => v.kind === 'out' && picks.length > 0,
    render: (v, apply) =>
      h(
        'div',
        { class: 'fld quickpicks', role: 'group', 'aria-label': $t('Often logged') },
        h('span', { class: 'fld-l', text: $t('Often logged') }),
        h(
          'div',
          { class: 'acts' },
          picks.map(pick =>
            h('button', {
              type: 'button',
              class: 'chip acc qpick',
              text: pick.amount === null ? pick.name : $t('{0} · {1}', pick.name, money(pick.amount)),
              onclick: () =>
                apply({
                  name: pick.name,
                  budget: pick.budget && budgetIds.has(pick.budget) ? pick.budget : null,
                  cat: pick.cat,
                  ...(pick.amount === null ? {} : { amount: pick.amount }),
                }),
            }),
          ),
        ),
      ),
  };
}

export function itemModal(id, preset, title) {
  const current = id && find('items', id);
  const plan = Store.plan;
  const budgets = plan.bills.filter(b => b.budget);
  const names = () => [...new Set(plan.items.map(i => i.name).filter(Boolean))].slice(-60);
  // a new transaction in the month you are living in starts on today's date; in another month it has no day yet
  const inCurrentMonth = selK() === curK();
  formModal({
    preview: v => {
      const d = D.parse(v.date);
      if (d === null || !plan.settings.payDay) {
        return '';
      }
      const k = Period.of(plan.settings, d);
      return $t(
        'Counts in {0} ({1}–{2}).',
        M.label(k, true),
        D.label(Period.start(plan.settings, k)),
        D.label(Period.end(plan.settings, k)),
      );
    },
    auto: true,
    title: title || (current ? $t('Edit transaction') : $t('Add transaction')),
    values: current || {
      id: uid(),
      name: '',
      amount: 0,
      kind: 'out',
      month: M.key(selK()),
      date: inCurrentMonth ? D.key(Store.day) : null,
      cat: 'other',
      budget: null,
      note: '',
      ...preset,
    },
    fields: [
      {
        k: 'kind',
        type: 'seg',
        label: $t('Type'),
        options: [
          ['out', $t('Spent')],
          ['in', $t('Received')],
        ],
        live: true,
      },
      ...(current ? [] : [quickPickField(plan)]),
      ...(budgets.length
        ? [
            {
              k: 'budget',
              type: 'select',
              live: true,
              show: v => v.kind === 'out',
              label: $t('Budget'),
              options: [['', $t('None (extra cost)')], ...budgets.map(b => [b.id, b.name])],
              info: $t('Uses up that budget instead of adding a new cost.'),
            },
          ]
        : []),
      { k: 'name', type: 'text', label: $t('Description'), ph: $t('Water, trousers, concert tickets…'), list: names() },
      { k: 'amount', type: 'money', label: $t('Amount'), half: true },
      {
        k: 'date',
        type: 'date',
        label: $t('Day'),
        empty: $t('No exact day'),
        half: true,
        live: true,
        hint: v => (D.parse(v.date) !== null && D.parse(v.date) > Store.day ? $t('A later day makes it planned.') : ''),
      },
      { k: 'month', type: 'month', label: $t('Month it belongs to'), show: v => !v.date },
      ...(plan.accounts.some(a => a.type === 'credit')
        ? [
            {
              k: 'account',
              type: 'select',
              show: v => v.kind === 'out',
              label: $t('Paid with'),
              options: [
                ['', $t('My own money')],
                ...plan.accounts.filter(a => a.type === 'credit').map(a => [a.id, a.name]),
              ],
              info: $t('Card purchases add to what you owe, not to today’s spending.'),
            },
          ]
        : []),
      { k: 'cat', type: 'select', label: $t('Category'), options: CATS, show: v => v.kind === 'out' && !v.budget },
      { k: 'cat', type: 'select', label: $t('Category'), options: INCATS, show: v => v.kind === 'in' },
      NOTE,
    ],
    onSave: v => {
      const b = v.kind === 'out' && v.budget ? find('bills', v.budget) : null;
      if (b && !String(v.name).trim()) {
        v.name = b.name;
      }
      return (
        need(v) ||
        (!(v.amount > 0)
          ? $t('Enter an amount above zero.')
          : !v.date && !v.month
            ? $t('Pick a day or a month.')
            : ((UI.lastBudget = b ? b.id : UI.lastBudget),
              upsert('items', {
                ...v,
                budget: b ? b.id : null,
                cat: b ? b.cat : v.cat,
                account: v.kind === 'out' && v.account ? v.account : null,
              }),
              ''))
      );
    },
    onDelete: current && (() => remove('items', id)),
  });
}
/** "Log a spend" from a budget: the same window with that budget picked. */
export const logSpend = (billId, m) =>
  itemModal(null, { budget: billId, date: D.key(clamp(Store.day, m.start, m.end)) });
/** "Add transaction" for month m: dated today (inside m), no budget picked. */
export const logPurchase = m => itemModal(null, { date: D.key(clamp(Store.day, m.start, m.end)), month: m.key });
/** The budget logged against most recently in this visit, if it still exists; otherwise the first budget. */
export function lastBudget(budgetEntries) {
  return budgetEntries.find(entry => entry.id === UI.lastBudget) || budgetEntries[0];
}
