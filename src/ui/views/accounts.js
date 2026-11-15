/**
 * @file Accounts page: balances, credit cards, and the check against real money.
 */
import { D, M } from '../../core/dates.js';
import { fmtNum, money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { info } from '../components/info.js';
import { card, chip, empty, page, row } from '../components/layout.js';
import { fixNote } from '../components/monthNotes.js';
import { grip, sortable } from '../components/sortable.js';
import { h } from '../dom.js';
import { remove } from '../helpers.js';
import { ACC_TYPES, accountModal, spendable } from '../modals/account.js';
import { balancesModal } from '../modals/balances.js';
import { recModal } from '../modals/recurring.js';
import { curK, monthAt } from '../state.js';
import { V } from './registry.js';

V.accounts = () => {
  const plan = Store.plan;
  const a = plan.accounts;
  const m = monthAt(curK());
  const spend = spendable(a);
  const avail = x => Math.max(0, x.limit - x.owed);
  const emergency = a.reduce((s, x) => s + (x.type === 'credit' ? avail(x) : x.type === 'savings' ? x.balance : 0), 0);
  const owed = a.reduce((s, x) => s + x.owed, 0);
  const use = id =>
    [
      ...plan.incomes.filter(x => x.account === id).map(x => x.name + $t(' comes in')),
      ...plan.bills.filter(x => x.account === id).map(x => x.name),
      ...plan.bills.filter(x => x.payTo === id).map(x => $t('paid off by “{0}”, {1} a month', x.name, money(x.amount))),
    ].join(', ');
  const box = h(
    'div',
    { class: 'rows' },
    a.map(x =>
      row({
        left: grip(),
        cls: 'srow wrap',
        title: x.name,
        chips: [
          x.note ? info(x.note) : null,
          x.main ? chip($t('main'), 'acc') : null,
          chip(ACC_TYPES.find(t => t[0] === x.type)[1], x.type === 'credit' ? 'warn' : ''),
        ],
        desc: [
          x.type === 'credit'
            ? $t('{0} owed of {1}', money(x.owed), money(x.limit)) + (x.apr ? ` · ${fmtNum(x.apr)}%` : '')
            : '',
          use(x.id),
        ]
          .filter(Boolean)
          .join(' · '),
        right: h(
          'div',
          { class: 'amt' },
          money(x.type === 'credit' ? avail(x) : x.balance),
          x.type === 'credit' ? h('div', { class: 'd', text: $t('available') }) : null,
        ),
        onclick: () => accountModal(x.id),
        del: () => remove('accounts', x.id),
        menu: [
          x.type === 'debit' || x.type === 'cash'
            ? [$t('Make it the main account'), () => Actions.setMain(x.id)]
            : null,
        ],
      }),
    ),
  );
  sortable(box, '.srow', (f, t) => Actions.move('accounts', f, t), 'accounts');
  const cards = a.filter(x => x.type === 'credit');
  const noPay = cards.filter(c => c.owed > 0 && !plan.bills.some(b => b.payTo === c.id));
  return page(
    $t('Accounts'),
    $t('Where your money is. Tell the planner what you have today and it works out the rest of the month from that.'),
    [
      btn($t('Add an account'), () => accountModal(), '', 'plus'),
      btn($t('What I have today'), balancesModal, 'primary', 'edit'),
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
          text: m.fix && m.fix.d !== null ? $t('checked on ') + D.label(m.fix.d) : $t('not checked this month yet'),
        }),
      ),
      h(
        'div',
        { class: 'kpi' },
        h(
          'div',
          { class: 'l' },
          $t('Emergency money'),
          info($t('Savings accounts plus what is still available on credit cards. Never counted as money to spend.')),
        ),
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
        h('div', { class: 's', text: m.fix ? $t('from what you really have') : $t('from the plan only') }),
      ),
    ),
    h(
      'div',
      { class: 'cols lead' },
      card(
        $t('Your accounts'),
        null,
        null,
        a.length
          ? box
          : empty(
              $t('No accounts yet'),
              $t(
                'Add your bank account, your cash and your credit card. You can also skip this and enter one total with “What I have today”.',
              ),
              $t('Add an account'),
              () => accountModal(),
            ),
      ),
      h(
        'div',
        { class: 'stack' },
        card(
          $t('This month from what you really have'),
          null,
          null,
          fixNote(m) ||
            h('p', {
              class: 'muted',
              text: $t(
                'Not checked this month. Press “What I have today”: you enter your balances, tick what is already paid, and the planner matches your real money.',
              ),
            }),
          m.fix
            ? h(
                'div',
                { class: 'acts', style: 'margin-top:10px' },
                btn($t('Check again'), balancesModal, 'sm'),
                btn($t('Open the month'), () => App.go('months', { month: m.k }), 'sm'),
                btn($t('Remove the correction'), () => Actions.clearFix(m.key), 'sm ghost'),
              )
            : null,
        ),
        noPay.length
          ? card(
              $t('Paying off ') + noPay[0].name,
              null,
              null,
              h('p', {
                class: 'muted',
                text: $t(
                  'You owe {0} on it, and no bill pays it off yet. Open the bill you pay the card with and set “Pays off” to this card. Each payment then lowers what you owe and frees the same amount again.',
                  money(noPay[0].owed),
                ),
              }),
              h(
                'div',
                { class: 'acts', style: 'margin-top:10px' },
                btn(
                  $t('Add a card payment bill'),
                  () =>
                    recModal('bills', null, { name: noPay[0].name + $t(' payment'), cat: 'debt', payTo: noPay[0].id }),
                  'sm',
                  'plus',
                ),
              ),
            )
          : null,
      ),
    ),
  );
};
