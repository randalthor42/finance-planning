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
import { bar, card, cardDel, chip, empty, keep, page, tile } from '../components/layout.js';
import { moneyInp } from '../components/moneyInput.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loanModal } from '../modals/loan.js';
import { UI, curK } from '../state.js';
import { V } from './registry.js';

function payoffCard() {
  const plan = Store.plan;
  const currentMonth = curK();
  const base = payoffPlan(plan, currentMonth, 0, null);
  if (!base.count) {
    return null;
  }
  const res = h('div');
  const th = [$t('Plan'), $t('Debt-free'), $t('Interest from now'), $t('You save')].map(t => h('th', { text: t }));
  const upd = () => {
    const x = UI.payExtra || 0;
    const a = payoffPlan(plan, currentMonth, x, 'avalanche');
    const sn = payoffPlan(plan, currentMonth, x, 'snowball');
    const ln = (name, description, r) =>
      h(
        'tr',
        null,
        h(
          'td',
          null,
          h('b', { text: name }),
          description ? h('div', { class: 'muted small', text: description }) : null,
        ),
        h('td', { text: M.label(r.endK) }),
        h('td', { text: money(r.interest) }),
        h('td', {
          class: r === base ? '' : 'good',
          text:
            r === base
              ? '–'
              : $t('{0} · {1} sooner', money(base.interest - r.interest), plural(base.endK - r.endK, 'month')),
        }),
      );
    res.replaceChildren(
      h(
        'div',
        { class: 'tblw' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, th)),
          h(
            'tbody',
            null,
            ln($t('As planned'), $t('Normal payments only'), base),
            base.count > 1
              ? [
                  ln($t('Highest interest first'), $t('Extra goes to ') + a.order.join($t(', then ')), a),
                  ln($t('Smallest debt first'), $t('Extra goes to ') + sn.order.join($t(', then ')), sn),
                ]
              : ln($t('With {0} extra a month', money(x)), '', a),
          ),
        ),
      ),
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
    const schedule = () =>
      h(
        'div',
        { class: 'tblw', style: 'max-height:420px' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              [$t('Month'), $t('Payment'), $t('Interest'), $t('Principal'), $t('Extra payment'), $t('Left to pay')].map(
                t => h('th', { text: t }),
              ),
            ),
          ),
          h(
            'tbody',
            null,
            c.sch.map(r => {
              const monthKey = M.key(r.k);
              let val = has(L.extras, monthKey) ? L.extras[monthKey] : null;
              const input = moneyInp({
                value: val,
                blank: true,
                ph: fmtNum(L.extra),
                label: $t('Extra payment in ') + M.label(r.k),
                onInput: n => {
                  val = n;
                },
              });
              input.addEventListener('change', () => setExtra(monthKey, val));
              return h(
                'tr',
                { class: r.k === currentMonth ? 'sel' : '' },
                h('td', { text: `${r.m}. ${M.label(r.k)}` }),
                h('td', { text: money(r.pay) }),
                h('td', { text: money(r.i) }),
                h('td', { text: money(r.p) }),
                h('td', null, input),
                h('td', { text: money(r.b) }),
              );
            }),
          ),
        ),
      );
    const compare = () =>
      h(
        'div',
        { class: 'tblw' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              [$t('Length'), $t('Monthly'), $t('Total interest'), $t('Total repaid'), ''].map(t =>
                h('th', { text: t }),
              ),
            ),
          ),
          h(
            'tbody',
            null,
            [...new Set([12, 24, 36, 48, 60, 72, 84, 96, 120, L.term])]
              .sort((a, b) => a - b)
              .map(n => {
                const pay = pmt(c.P, L.rate / 1200, n);
                return h(
                  'tr',
                  { class: n === L.term ? 'sel' : '' },
                  h('td', { text: plural(n, 'month') }),
                  h('td', { text: money(pay) }),
                  h('td', { text: money(pay * n - c.P) }),
                  h('td', { text: money(pay * n) }),
                  h(
                    'td',
                    null,
                    n === L.term
                      ? chip($t('current'), 'acc')
                      : btn(
                          $t('Use'),
                          () => Actions.patch('loans', L.id, { term: n }, $t('“{0}” set to {1} months', L.name, n)),
                          'sm',
                        ),
                  ),
                );
              }),
          ),
        ),
      );
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
            text: $t(
              '{0} at {1}% over {2} months · first payment {3}{4}',
              money(c.P),
              fmtNum(L.rate),
              L.term,
              M.label(c.f0),
              L.day ? $t(' · paid on the ') + ordinal(L.day) : '',
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
            text:
              $t('Replaces: ') +
              linked.map(b => `${b.name} (${money(b.amount)})`).join(', ') +
              '. These bills stop when the first payment is due.',
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
  return page(
    $t('Loans'),
    $t(
      'New loans you are considering and debts you already have. Every payment shows up in its month and on its day. Switch one off to see your plan without it.',
    ),
    [btn($t('Add a loan'), () => loanModal(), 'primary', 'plus')],
    cards.filter(Boolean).length
      ? h('div', { class: 'stack' }, cards, payoffCard())
      : card(
          null,
          null,
          null,
          empty(
            $t('No loans'),
            $t('Add a loan to see the monthly payment, the interest, and what it does to every month of your plan.'),
            $t('Add a loan'),
            () => loanModal(),
          ),
        ),
  );
};
