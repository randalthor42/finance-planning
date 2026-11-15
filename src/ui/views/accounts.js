/**
 * @file Accounts page: balances, credit cards, and the check against real money.
 */
import { D, M } from '../../core/dates.js';
import { fmtNum, money, signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { info } from '../components/info.js';
import { dataTable } from '../components/dataTable.js';
import { bar, card, cardDel, empty, page, segc } from '../components/layout.js';
import { fixNote } from '../components/monthNotes.js';
import { h } from '../dom.js';
import { ACC_TYPES, accountModal, spendable } from '../modals/account.js';
import { balancesModal } from '../modals/balances.js';
import { recModal } from '../modals/recurring.js';
import { UI, curK, monthAt } from '../state.js';
import { V } from './registry.js';

/**
 * One account as a card. A credit card shows the three numbers that used to disagree between pages, side by side:
 * what you owe today (the account), what this month's plan still adds and pays off, and where that leaves the card.
 */
function accountCard(account, plan, projection, monthPosition, allAccounts) {
  const typeName = ACC_TYPES.find(type => type[0] === account.type)[1];
  const isCredit = account.type === 'credit';
  const canBeMain = account.type === 'debit' || account.type === 'cash';
  const usedBy = [
    ...plan.incomes.filter(income => income.account === account.id).map(income => $t('{0} comes in', income.name)),
    ...plan.bills.filter(bill => bill.account === account.id).map(bill => bill.name),
    ...plan.bills
      .filter(bill => bill.payTo === account.id)
      .map(bill => $t('paid off by “{0}”, {1} a month', bill.name, money(bill.amount))),
  ].join(', ');

  const actions = h(
    'div',
    { class: 'acts' },
    canBeMain
      ? ibtn(
          account.main ? $t('Main account') : $t('Make it the main account'),
          () => (account.main ? null : Actions.setMain(account.id)),
          'sm ghost' + (account.main ? ' on' : ''),
          'star',
        )
      : null,
    ibtn($t('Edit'), () => accountModal(account.id), 'sm ghost', 'edit'),
    cardDel('accounts', account.id),
  );
  const header = h(
    'div',
    { class: 'card-h' },
    h('div', { class: 'grow', style: 'min-width:0' }, h('h2', { text: account.name }), h('p', { text: typeName })),
    actions,
  );

  if (!isCredit) {
    // where this money counts, and how much of the spending money it is: gives the card the same shape as a credit card
    const line = (label, value) =>
      h(
        'div',
        { class: 'aline' },
        h('span', { class: 'muted', text: label }),
        h('span', { class: 'num', text: value }),
      );
    const spends = account.type === 'debit' || account.type === 'cash';
    const share = spends ? spendable(allAccounts) : 0;
    return h(
      'section',
      { class: 'card acard' },
      header,
      h('div', { class: 'abig ' + (account.balance < 0 ? 'bad' : ''), text: money(account.balance) }),
      spends && share > 0 ? bar(Math.max(0, Math.min(100, (account.balance / share) * 100)), 'warn') : null,
      h(
        'div',
        { class: 'alines' },
        line($t('Counted in'), spends ? $t('To spend now') : $t('Available if needed')),
        spends && share > 0
          ? line($t('Share of your spending money'), fmtNum(Math.round((account.balance / share) * 100)) + '%')
          : null,
      ),
      usedBy ? h('p', { class: 'small muted', text: usedBy }) : null,
      account.note ? h('p', { class: 'small muted', text: account.note }) : null,
    );
  }

  const cardPlan = projection.cards[account.id];
  const owedNow = account.owed;
  const addedThisMonth = cardPlan ? cardPlan.added[monthPosition] : 0;
  const paidThisMonth = cardPlan ? cardPlan.paidOff[monthPosition] : 0;
  const owedAtEnd = cardPlan ? cardPlan.series[monthPosition] : owedNow;
  const line = (label, value) =>
    h('div', { class: 'aline' }, h('span', { class: 'muted', text: label }), h('span', { class: 'num', text: value }));
  return h(
    'section',
    { class: 'card acard' },
    header,
    h('div', { class: 'abig', text: money(Math.max(0, account.limit - owedNow)) }),
    bar(account.limit ? (owedNow / account.limit) * 100 : 0, owedNow > account.limit * 0.9 ? 'over' : 'warn'),
    h('p', { class: 'small muted', text: $t('available today, of a {0} limit', money(account.limit)) }),
    h(
      'div',
      { class: 'alines' },
      line($t('Owed today'), money(owedNow)),
      addedThisMonth ? line($t('Still planned on it this month'), signed(addedThisMonth)) : null,
      paidThisMonth ? line($t('Still to pay off this month'), signed(-paidThisMonth)) : null,
      line($t('Owed at the end of the month'), money(owedAtEnd)),
      line($t('Available then'), money(Math.max(0, account.limit - owedAtEnd))),
    ),
    usedBy ? h('p', { class: 'small muted', text: usedBy + (account.apr ? ` · ${fmtNum(account.apr)}%` : '') }) : null,
    account.note ? h('p', { class: 'small muted', text: account.note }) : null,
  );
}

/** The same accounts as a table that sorts by any column. */
function accountTable(accounts, projection, monthPosition) {
  const typeName = account => ACC_TYPES.find(type => type[0] === account.type)[1];
  const isCredit = account => account.type === 'credit';
  const owedAtEnd = account =>
    projection.cards[account.id] ? projection.cards[account.id].series[monthPosition] : account.owed;
  return dataTable({
    id: 'accounts',
    rows: accounts,
    columns: [
      {
        label: $t('Name'),
        value: account => account.name,
        cell: account => h('b', { text: account.name + (account.main ? ' ★' : '') }),
      },
      { label: $t('Type'), value: typeName, cell: typeName },
      {
        label: $t('You have'),
        value: account => (isCredit(account) ? null : account.balance),
        cell: account => (isCredit(account) ? '–' : money(account.balance)),
      },
      {
        label: $t('Owed today'),
        value: account => (isCredit(account) ? account.owed : null),
        cell: account => (isCredit(account) ? money(account.owed) : '–'),
      },
      {
        label: $t('Available today'),
        value: account => (isCredit(account) ? Math.max(0, account.limit - account.owed) : null),
        cell: account => (isCredit(account) ? money(Math.max(0, account.limit - account.owed)) : '–'),
      },
      {
        label: $t('Owed at the end of the month'),
        value: account => (isCredit(account) ? owedAtEnd(account) : null),
        cell: account => (isCredit(account) ? money(owedAtEnd(account)) : '–'),
      },
      {
        label: '',
        cell: account =>
          h(
            'div',
            { class: 'acts', style: 'justify-content:flex-end' },
            account.type === 'debit' || account.type === 'cash'
              ? ibtn(
                  account.main ? $t('Main account') : $t('Make it the main account'),
                  () => (account.main ? null : Actions.setMain(account.id)),
                  'sm ghost' + (account.main ? ' on' : ''),
                  'star',
                )
              : null,
            ibtn($t('Edit'), () => accountModal(account.id), 'sm ghost', 'edit'),
            cardDel('accounts', account.id),
          ),
      },
    ],
  });
}

V.accounts = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const a = plan.accounts;
  const m = monthAt(curK());
  const monthPosition = m.k - projection.summary.s0;
  const spend = spendable(a);
  // credit that is really free: what the card allows, minus what is owed and what this month's plan still puts on it
  const freeCredit = x => {
    const cardPlan = projection.cards[x.id];
    return Math.max(0, x.limit - x.owed - (cardPlan ? cardPlan.added[monthPosition] : 0));
  };
  const emergency = a.reduce(
    (s, x) => s + (x.type === 'credit' ? freeCredit(x) : x.type === 'savings' ? x.balance : 0),
    0,
  );
  const owed = a.reduce((s, x) => s + x.owed, 0);
  const checkCard = card(
    $t('Balance check'),
    null,
    null,
    fixNote(m) || h('p', { class: 'muted', text: $t('Not checked this month.') }),
    m.fix
      ? h(
          'div',
          { class: 'acts', style: 'margin-top:10px' },
          btn($t('Update balances'), balancesModal, 'sm'),
          btn($t('Open the month'), () => App.go('months', { month: m.k }), 'sm'),
          btn($t('Remove the correction'), () => Actions.clearFix(m.key), 'sm ghost'),
        )
      : h('div', { class: 'acts', style: 'margin-top:10px' }, btn($t('Update balances'), balancesModal, 'sm')),
  );
  const cards = a.filter(x => x.type === 'credit');
  const noPay = cards.filter(c => c.owed > 0 && !plan.bills.some(b => b.payTo === c.id));
  const payCard = noPay.length
    ? card(
        $t('Paying off {0}', noPay[0].name),
        null,
        null,
        h('p', {
          class: 'muted',
          text: $t('Nothing pays this card down yet.'),
        }),
        h(
          'div',
          { class: 'acts', style: 'margin-top:10px' },
          btn(
            $t('Add card payment'),
            () => recModal('bills', null, { name: $t('{0} payment', noPay[0].name), cat: 'debt', payTo: noPay[0].id }),
            'sm',
            'plus',
          ),
        ),
      )
    : null;
  return page(
    $t('Accounts'),
    $t('Your balances. Update them and the month recalculates.'),
    [
      segc(
        [
          ['cards', $t('Cards')],
          ['list', $t('List')],
        ],
        UI.accountView,
        view => {
          UI.accountView = view;
          App.render();
        },
      ),
      btn($t('Add an account'), () => accountModal(), '', 'plus'),
      btn($t('Update balances'), balancesModal, 'primary', 'edit'),
    ],
    h(
      'div',
      { class: 'kpis' },
      h(
        'div',
        { class: 'kpi' },
        h(
          'div',
          { class: 'l' },
          $t('To spend now'),
          info(
            $t(
              'Bank accounts plus cash. Ticking something as paid after your last update takes it out of the account it was paid from.',
            ),
          ),
        ),
        h('div', { class: 'v ' + (spend < 0 ? 'bad' : ''), text: money(spend) }),
        h('div', {
          class: 's',
          text: m.fix && m.fix.d !== null ? $t('checked on {0}', D.label(m.fix.d)) : $t('not checked this month yet'),
        }),
      ),
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'l' }, $t('Available if needed'), info($t('Savings + unused credit after this month.'))),
        h('div', { class: 'v', text: money(emergency) }),
        h('div', {
          class: 's',
          text: owed ? $t('{0} owed on cards', money(owed)) : $t('savings and available credit'),
        }),
      ),
      h(
        'div',
        { class: 'kpi' },
        h('div', { class: 'l', text: $t('{0} ends at', M.label(m.k)) }),
        h('div', { class: 'v ' + (m.close < 0 ? 'bad' : ''), text: money(m.close) }),
        h('div', { class: 's', text: m.fix ? $t('after your balance check') : $t('from the plan only') }),
      ),
    ),
    a.length
      ? UI.accountView === 'list'
        ? card(null, null, null, accountTable(a, projection, monthPosition))
        : h(
            'div',
            { class: 'acards' + (a.length >= 3 ? ' fill' : '') },
            a.map(x => accountCard(x, plan, projection, monthPosition, a)),
          )
      : card(
          $t('Your accounts'),
          null,
          null,
          empty(
            $t('No accounts yet'),
            $t(
              'Add your bank account, your cash and your credit card. You can also skip this and enter one total with “Update balances”.',
            ),
            $t('Add an account'),
            () => accountModal(),
          ),
        ),
    h('div', { class: 'rgrid' }, checkCard, payCard),
  );
};
