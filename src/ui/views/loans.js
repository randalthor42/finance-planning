/**
 * @file Loans page: schedules, extra payments, payoff planner.
 */
import { M } from '../../core/dates.js';
import { fmtNum, money } from '../../core/format.js';
import { $t, ordinal, plural } from '../../core/i18n.js';
import { has, pmt } from '../../core/util.js';
import { payoffPlan } from '../../logic/loans.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { dataTable } from '../components/dataTable.js';
import { bar, card, cardDel, chip, designPage, empty, keep, tile } from '../components/layout.js';
import { moneyInp } from '../components/moneyInput.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loanModal } from '../modals/loan.js';
import { UI, curK } from '../state.js';
import { designable } from '../components/designPages.js';
import { V } from './registry.js';

function payoffCard() {
  const plan = Store.plan;
  const currentMonth = curK();
  const base = payoffPlan(plan, currentMonth, 0, null);
  if (!base.count) {
    return null;
  }
  const res = h('div');
  const upd = () => {
    const x = UI.payExtra || 0;
    const a = payoffPlan(plan, currentMonth, x, 'avalanche');
    const sn = payoffPlan(plan, currentMonth, x, 'snowball');
    const rows = [{ name: $t('As planned'), description: $t('Normal payments only'), result: base }];
    if (base.count > 1) {
      rows.push(
        {
          name: $t('Highest interest first'),
          description: $t('Extra goes to {0}', a.order.join($t(', then '))),
          result: a,
        },
        {
          name: $t('Smallest debt first'),
          description: $t('Extra goes to {0}', sn.order.join($t(', then '))),
          result: sn,
        },
      );
    } else {
      rows.push({ name: $t('With {0} extra a month', money(x)), description: '', result: a });
    }
    res.replaceChildren(
      dataTable({
        id: 'loan-payoff',
        rows,
        columns: [
          {
            label: $t('Plan'),
            value: row => row.name,
            cell: row => [
              h('b', { text: row.name }),
              row.description ? h('div', { class: 'muted small', text: row.description }) : null,
            ],
          },
          { label: $t('Debt-free'), value: row => row.result.endK, cell: row => M.label(row.result.endK) },
          {
            label: $t('Interest from now'),
            value: row => row.result.interest,
            cell: row => money(row.result.interest),
          },
          {
            label: $t('You save'),
            value: row => base.interest - row.result.interest,
            cellProps: row => ({ class: row.result === base ? '' : 'good' }),
            cell: row =>
              row.result === base
                ? '–'
                : $t(
                    '{0} · {1} sooner',
                    money(base.interest - row.result.interest),
                    plural(base.endK - row.result.endK, 'month'),
                  ),
          },
        ],
      }),
    );
  };
  upd();
  return card(
    $t('Debt payoff planner'),
    $t(
      'How much sooner you are debt-free if you put a bit extra towards your loans. When one loan is finished, its payment moves on to the next.',
    ),
    null,
    h(
      'label',
      { class: 'fld', style: 'max-width:240px;margin-bottom:10px' },
      h('span', { class: 'fld-l', text: $t('Extra per month') }),
      moneyInp({
        value: UI.payExtra,
        onInput: n => {
          UI.payExtra = n;
          upd();
        },
      }),
    ),
    res,
    h('p', {
      class: 'small muted',
      style: 'margin-top:8px',
      text: $t(
        'This is a what-if and changes nothing. It leaves out early repayment fees. To act on it, edit the loan it names first and set its extra payment.',
      ),
    }),
  );
}
/** This page offers Design mode (see components/designPages.js). */
const DESIGN = designable('loans', $t('Loans'));
V.loans = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const currentMonth = curK();
  const cards = plan.loans.map(L => {
    const c = projection.loans[L.id];
    if (!c) {
      return null;
    }
    const owed = c.balAt(currentMonth);
    const done = c.end < currentMonth;
    const linked = plan.bills.filter(b => b.untilLoan === L.id);
    const sw = h('input', {
      type: 'checkbox',
      checked: L.on,
      'aria-label': $t('Count this loan in my plan'),
      onchange: () => Actions.toggle('loans', L.id, sw.checked),
    });
    const setExtra = (monthKey, val) => Actions.setLoanExtra(L.id, monthKey, val);
    const extraInput = r => {
      const monthKey = M.key(r.k);
      let val = has(L.extras, monthKey) ? L.extras[monthKey] : null;
      const input = moneyInp({
        value: val,
        blank: true,
        ph: fmtNum(L.extra),
        label: $t('Extra payment in {0}', M.label(r.k)),
        onInput: n => {
          val = n;
        },
      });
      input.addEventListener('change', () => setExtra(monthKey, val));
      return input;
    };
    const schedule = () =>
      dataTable({
        id: 'loan-schedule:' + L.id,
        rows: c.sch,
        maxHeight: '420px',
        rowProps: r => ({ class: r.k === currentMonth ? 'sel' : '' }),
        columns: [
          { label: $t('Month'), value: r => r.k, cell: r => $t('{0}. {1}', r.m, M.label(r.k)) },
          { label: $t('Payment'), value: r => r.pay, cell: r => money(r.pay) },
          { label: $t('Interest'), value: r => r.i, cell: r => money(r.i) },
          { label: $t('Principal'), value: r => r.p, cell: r => money(r.p) },
          { label: $t('Extra payment'), cell: extraInput },
          { label: $t('Left to pay'), value: r => r.b, cell: r => money(r.b) },
        ],
      });
    const lengths = () =>
      [...new Set([12, 24, 36, 48, 60, 72, 84, 96, 120, L.term])]
        .sort((a, b) => a - b)
        .map(n => {
          const pay = pmt(c.P, L.rate / 1200, n);
          return { n, pay, interest: pay * n - c.P, total: pay * n };
        });
    const compare = () =>
      dataTable({
        id: 'loan-compare:' + L.id,
        rows: lengths(),
        rowProps: row => ({ class: row.n === L.term ? 'sel' : '' }),
        columns: [
          { label: $t('Length'), value: row => row.n, cell: row => plural(row.n, 'month') },
          { label: $t('Monthly'), value: row => row.pay, cell: row => money(row.pay) },
          { label: $t('Total interest'), value: row => row.interest, cell: row => money(row.interest) },
          { label: $t('Total repaid'), value: row => row.total, cell: row => money(row.total) },
          {
            label: '',
            cell: row =>
              row.n === L.term
                ? chip($t('current'), 'acc')
                : btn(
                    $t('Use'),
                    () => Actions.patch('loans', L.id, { term: row.n }, $t('“{0}” set to {1} months', L.name, row.n)),
                    'sm',
                  ),
          },
        ],
      });
    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-h' },
        h(
          'div',
          null,
          h(
            'h2',
            null,
            L.name,
            ' ',
            !L.on ? chip($t('not counted in the plan'), 'warn') : done ? chip($t('paid off'), 'good') : null,
          ),
          h('p', {
            text: L.day
              ? $t(
                  '{0} at {1}% over {2} · first payment {3} · paid on the {4}',
                  money(c.P),
                  fmtNum(L.rate),
                  plural(L.term, 'month'),
                  M.label(c.f0),
                  ordinal(L.day),
                )
              : $t(
                  '{0} at {1}% over {2} · first payment {3}',
                  money(c.P),
                  fmtNum(L.rate),
                  plural(L.term, 'month'),
                  M.label(c.f0),
                ),
          }),
        ),
        h(
          'div',
          { class: 'acts' },
          h('label', { class: 'switch' }, sw),
          btn($t('Edit'), () => loanModal(L.id), 'sm', 'edit'),
          cardDel('loans', L.id),
        ),
      ),
      h(
        'div',
        { class: 'tiles' },
        tile($t('Monthly payment'), money(c.pay)),
        tile($t('Left to pay, {0}', M.label(currentMonth)), money(owed)),
        tile($t('Paid off'), M.label(c.end)),
        tile($t('Total interest'), money(c.int)),
        c.fee > 0 ? tile(L.feeFin ? $t('Opening fee (in the loan)') : $t('Opening fee (cash)'), money(c.fee)) : null,
      ),
      bar((1 - owed / c.P) * 100, 'good'),
      c.saved > 0
        ? h(
            'div',
            { class: 'note good', style: 'margin-top:12px' },
            icon('check'),
            h('div', {
              class: 'grow',
              text: $t(
                'Your extra payments finish the loan {0} early and save {1} after {2} in early repayment fees.',
                plural(c.saved, 'month'),
                money(c.baseInt - c.int - c.fees),
                money(c.fees),
              ),
            }),
          )
        : null,
      linked.length
        ? h('p', {
            class: 'small muted',
            style: 'margin-top:10px',
            text: $t(
              'Replaces: {0}. These bills stop when the first payment is due.',
              linked.map(b => `${b.name} (${money(b.amount)})`).join(', '),
            ),
          })
        : null,
      h(
        'div',
        { style: 'margin-top:10px' },
        L.on
          ? btn(
              $t('See it in {0}', M.label(Math.max(c.f0, currentMonth))),
              () => App.go('months', { month: Math.max(c.f0, currentMonth) }),
              'sm ghost',
              'calendar',
            )
          : null,
        keep(L.id + ':c', $t('Compare loan lengths'), compare),
        keep(L.id + ':s', $t('Payment schedule and extra payments'), schedule),
      ),
    );
  });
  const loanCards = plan.loans
    .map((L, i) => ({ id: 'loan-' + L.id, title: L.name, el: cards[i], w: 12, minW: 4, item: true }))
    .filter(loan => loan.el);
  // The cards of the page, in their usual order. Design mode lets the person move them and change their size.
  return designPage(
    DESIGN,
    $t('Loans'),
    $t('Loans you have or are considering. Switch one off to compare.'),
    [btn($t('Add a loan'), () => loanModal(), 'primary', 'plus')],
    loanCards.length
      ? [...loanCards, { id: 'payoff', title: $t('Debt payoff planner'), el: payoffCard(), w: 12, minW: 4 }]
      : [
          {
            id: 'empty',
            title: $t('Loans'),
            w: 12,
            el: card(
              null,
              null,
              null,
              empty(
                $t('No loans'),
                $t(
                  'Add a loan to see the monthly payment, the interest, and what it does to every month of your plan.',
                ),
                $t('Add a loan'),
                () => loanModal(),
              ),
            ),
          },
        ],
  );
};
