/**
 * @file "What I have today": compare the planner with real balances and record the difference.
 */
import { D, M, Period } from '../../core/dates.js';
import { fmtNum, money, signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { r2 } from '../../core/util.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { info } from '../components/info.js';
import { modal } from '../components/modal.js';
import { moneyInp } from '../components/moneyInput.js';
import { h } from '../dom.js';
import { spendable } from './account.js';
import { curK, monthAt } from '../state.js';

/**
 * "What I have today". One window: what is in each account, which lines of this month are already paid,
 * and how much you still expect to spend from each budget. The month is then worked out from that.
 */
export function balancesModal() {
  const plan = Store.plan;
  const settings = plan.settings;
  const accounts = JSON.parse(JSON.stringify(plan.accounts));
  const m = monthAt(curK());
  const today = Store.day;
  const inside = today >= m.start && today <= m.end;
  const len = m.end - m.start + 1;
  const daysLeft = Math.max(0, m.end - today);
  const v = { direct: null };
  const lines = inside
    ? m.entries.filter(e => e.group !== 'adjust' && !e.of && !e.budget && !e.onCard && !e.paid && e.amount !== 0)
    : [];
  const budgets = inside
    ? m.entries.filter(e => e.budget && e.budget.reserve && !e.paid && !e.budget.closed && e.budget.left > 0)
    : [];
  // a line whose day has passed is probably paid already, so it starts ticked; a budget nobody logged against starts at a guess from the days left
  const done = new Set(lines.filter(e => e.date !== null && e.date <= today).map(e => e.key));
  const left = {};
  budgets.forEach(e => {
    left[e.id] =
      e.budget.spent > 0 ? e.budget.left : Math.min(e.budget.left, Math.round((e.budget.planned * daysLeft) / len));
  });
  const out = h('div', { class: 'preview' });
  const have = () => (accounts.length ? spendable(accounts) : v.direct);
  const known = () => accounts.length > 0 || v.direct != null;
  // today can fall before the first month of the plan (or after its last): then there is no month to work out, and we say why
  const outside =
    today < m.start
      ? $t(
          'Today is before this plan starts: its first month, {0}, runs from {1} to {2}. Only the balances are saved.',
          M.label(m.k),
          D.label(m.start),
          D.label(m.end),
        ) +
        (settings.payDay && settings.payFor === 'same'
          ? ' ' +
            $t(
              'If the salary you are living on right now is the one from {0}, open Settings, This plan, and set “A salary pays for” to “The month after it arrives”. {1} then starts on that payday and today is inside it.',
              D.label(Period.start(settings, m.k - 1)),
              M.label(m.k),
            )
          : '')
      : $t(
          'Today is after the last month of this plan. Only the balances are saved. Add months in the month planner, or roll the plan forward in Settings.',
        );
  const sum = () => {
    if (!inside) {
      out.replaceChildren(
        h('b', { text: $t('{0} to spend today', money(have() || 0)) }),
        h('div', { class: 'small', style: 'margin-top:6px', text: outside }),
      );
      return;
    }
    const paidNow = lines.reduce((a, e) => a + (done.has(e.key) ? e.amount : 0), 0);
    const gone = budgets.reduce((a, e) => a + Math.max(0, e.budget.left - (left[e.id] || 0)), 0);
    const counted = r2(m.now + paidNow - gone);
    if (!known()) {
      out.replaceChildren(
        $t('From the paid lines, the planner counts {0}. Enter what you really have to compare.', money(counted)),
      );
      return;
    }
    const gap = r2(have() - counted);
    const end = r2(m.close + gap);
    out.replaceChildren(
      ...[
        h(
          'div',
          null,
          $t('From the paid lines, the planner counts {0}. You have ', money(counted)),
          h('b', { text: money(have()) }),
          '.',
        ),
        h('div', {
          style: 'margin-top:4px',
          text:
            Math.abs(gap) < 0.005
              ? $t('They agree.')
              : gap < 0
                ? $t(
                    '{0} is not explained. It will count as spending that is not in the plan. If something above is already paid, tick it first.',
                    money(-gap),
                  )
                : $t(
                    'That is {0} more than expected. It will count as money that is not in the plan. If a line above is not really paid yet, untick it first.',
                    money(gap),
                  ),
        }),
        h(
          'div',
          { style: 'margin-top:4px' },
          $t('{0} then ends at ', M.label(m.k)),
          h('b', { class: end < 0 ? 'bad' : '', text: money(end) }),
          '.',
        ),
      ],
    );
  };
  const body = h(
    'div',
    { class: 'form' },
    h('div', { class: 'form-sec', style: 'border:0;padding:0', text: $t('1. What you really have') }),
    accounts.length
      ? accounts.map(a =>
          h(
            'label',
            { class: 'fld half' },
            h('span', { class: 'fld-l', text: a.type === 'credit' ? $t('{0} (still available)', a.name) : a.name }),
            moneyInp({
              value: a.type === 'credit' ? Math.max(0, a.limit - a.owed) : a.balance,
              blank: true,
              neg: a.type !== 'credit',
              onInput: n => {
                if (a.type === 'credit') {
                  a.limit = Math.max(a.limit, n || 0);
                  a.owed = Math.max(0, a.limit - (n || 0));
                } else {
                  a.balance = n || 0;
                }
                sum();
              },
            }),
          ),
        )
      : h(
          'label',
          { class: 'fld' },
          h('span', { class: 'fld-l', text: $t('Money you can spend right now') }),
          moneyInp({
            value: null,
            blank: true,
            neg: true,
            ph: inside ? fmtNum(m.now) : '',
            onInput: n => {
              v.direct = n;
              sum();
            },
          }),
          h('span', { class: 'fld-h', text: $t('Bank account plus cash.') }),
        ),
    lines.length
      ? [
          h(
            'div',
            { class: 'form-sec' },
            $t('2. Already paid? '),
            info(
              $t(
                'The lines of this month that are not ticked yet. Tick the ones that are already paid, so they are not counted twice. Lines whose day has passed start ticked.',
              ),
            ),
          ),
          h(
            'div',
            { class: 'fld' },
            h(
              'div',
              { class: 'rows recon' },
              lines.map(e => {
                const c = h('input', {
                  type: 'checkbox',
                  class: 'check',
                  checked: done.has(e.key),
                  onchange: () => {
                    c.checked ? done.add(e.key) : done.delete(e.key);
                    sum();
                  },
                });
                return h(
                  'label',
                  { class: 'row' },
                  c,
                  h(
                    'span',
                    { class: 'grow' },
                    h('span', { class: 't', text: e.label }),
                    h('span', {
                      class: 'd',
                      text: [e.date !== null ? D.label(e.date) : '', e.sub].filter(Boolean).join(' · '),
                    }),
                  ),
                  h('span', { class: 'amt', text: signed(e.amount) }),
                );
              }),
            ),
          ),
        ]
      : null,
    budgets.length
      ? [
          h(
            'div',
            { class: 'form-sec' },
            lines.length ? $t('3. Left in your budgets ') : $t('2. Left in your budgets '),
            info(
              $t(
                'How much of each budget you still expect to spend this month. The amounts are what is left after the spends you logged, or a guess from the days left. What is gone is logged as one spend.',
              ),
            ),
          ),
          budgets.map(e =>
            h(
              'label',
              { class: 'fld half' },
              h('span', { class: 'fld-l', text: e.label }),
              moneyInp({
                value: left[e.id],
                blank: true,
                onInput: n => {
                  left[e.id] = n || 0;
                  sum();
                },
              }),
              h('span', {
                class: 'fld-h',
                text: $t('{0} left of {1}', money(Math.max(0, e.budget.left)), money(e.budget.planned)),
              }),
            ),
          ),
        ]
      : null,
    out,
  );
  sum();
  const d = modal({
    title: $t('What I have today'),
    wide: inside && lines.length + budgets.length > 0,
    body,
    foot: [
      h('span', { class: 'sp' }),
      btn($t('Cancel'), () => d.close(), 'ghost'),
      btn(
        $t('Save'),
        () => {
          if (known()) {
            Actions.reconcile(
              accounts,
              inside ? m.key : null,
              have() || 0,
              lines.filter(e => done.has(e.key)),
              left,
            );
          }
          d.close();
        },
        'primary',
      ),
    ],
  });
  const f = body.querySelector('input');
  if (f) {
    f.focus();
    f.select();
  }
}
