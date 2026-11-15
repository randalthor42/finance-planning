/**
 * @file Global search window: type a few letters, pick a result, and its editing window opens.
 */
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { M } from '../../core/dates.js';
import { searchPlan } from '../../logic/search.js';
import { Store } from '../../state/store.js';
import { chip } from '../components/layout.js';
import { modal } from '../components/modal.js';
import { h } from '../dom.js';
import { accountModal } from './account.js';
import { goalModal } from './goal.js';
import { itemModal } from './item.js';
import { loanModal } from './loan.js';
import { recModal } from './recurring.js';
import { tripModal } from './trip.js';
import { wishModal } from './wish.js';

/** The label shown on a result, by type. */
const typeLabel = type =>
  ({
    income: $t('Income'),
    bill: $t('Bill'),
    budget: $t('Budget'),
    subscription: $t('Subscription'),
    purchase: $t('Purchase'),
    trip: $t('Trip'),
    wish: $t('Wishlist'),
    goal: $t('Savings goal'),
    loan: $t('Loan'),
    account: $t('Account'),
  })[type] || type;

/** Opens the editing window that belongs to a result. */
function openResult(result) {
  const openers = {
    incomes: () => recModal('incomes', result.id),
    bills: () => recModal('bills', result.id),
    items: () => itemModal(result.id),
    trips: () => tripModal(result.id),
    wishes: () => wishModal(result.id),
    goals: () => goalModal(result.id),
    loans: () => loanModal(result.id),
    accounts: () => accountModal(result.id),
  };
  openers[result.list]();
}

export function searchModal() {
  if (!Store.plan) {
    return;
  }
  const list = h('div', { class: 'rows searchres' });
  const input = h('input', {
    class: 'inp',
    type: 'search',
    placeholder: $t('Rent, Netflix, Lisbon, a note…'),
    'aria-label': $t('Search your plan'),
    autocomplete: 'off',
  });
  let dialog = null;

  const choose = result => {
    dialog.close();
    openResult(result);
  };
  const resultRow = result =>
    h(
      'button',
      { type: 'button', class: 'row click searchrow', onclick: () => choose(result) },
      h(
        'span',
        { class: 'grow' },
        h('span', { class: 't', text: result.name }),
        result.month ? h('span', { class: 'd', text: M.label(M.parse(result.month), true) }) : null,
      ),
      chip(typeLabel(result.type)),
      h('span', { class: 'amt', text: money(result.amount) }),
    );
  const draw = () => {
    const query = input.value.trim();
    if (!query) {
      list.replaceChildren(
        h('p', { class: 'muted small', text: $t('Searches names, notes and trip costs in this plan.') }),
      );
      return;
    }
    const results = searchPlan(Store.plan, query);
    list.replaceChildren(
      ...(results.length
        ? results.map(resultRow)
        : [h('p', { class: 'muted', text: $t('Nothing found for “{0}”.', query) })]),
    );
  };
  input.addEventListener('input', draw);
  // Enter opens the first result, so search-and-open works without the mouse
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const first = searchPlan(Store.plan, input.value.trim())[0];
      if (first) {
        event.preventDefault();
        choose(first);
      }
    }
  });
  draw();
  dialog = modal({ title: $t('Search'), body: h('div', { class: 'searchbox' }, input, list) });
  input.focus();
}
