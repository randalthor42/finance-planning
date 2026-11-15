/**
 * @file Month planner: every line of one month, grouped by type or day by day, with ticks and budgets.
 */
import { D, M } from '../../core/dates.js';
import { compact, fmtNum, money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { r2 } from '../../core/util.js';
import { CAT_NAME } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { info } from '../components/info.js';
import { amt, bar, budgetText, card, chip, empty, page, row, segc } from '../components/layout.js';
import { moneyInp } from '../components/moneyInput.js';
import { coverNote, fixNote } from '../components/monthNotes.js';
import { ctxMenu } from '../components/popover.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';
import { accName, remove } from '../helpers.js';
import { icon } from '../icons.js';
import { balancesModal } from '../modals/balances.js';
import { entryModal } from '../modals/entry.js';
import { itemModal, logPurchase, logSpend } from '../modals/item.js';
import { loanModal } from '../modals/loan.js';
import { recModal } from '../modals/recurring.js';
import { tripModal } from '../modals/trip.js';
import { UI, monthAt, nowK, rangeLabel, selK } from '../state.js';
import { FTABS, forecastCloses } from './forecast.js';
import { V } from './registry.js';

V.months = () => {
  const plan = Store.plan;
  const settings = plan.settings;
  const projection = Store.proj;
  const summary = projection.summary;
  const k = selK();
  const m = monthAt(k);
  const now = nowK();
  const monthKey = M.key(k);
  const days = UI.mview === 'days';
  // a forecast chosen on the Forecast page can be shown here; it changes what is displayed, never the plan
  const overlay = forecastCloses(UI.overlay);
  const shownClose = month => (overlay && overlay.closes.has(month.k) ? overlay.closes.get(month.k) : month.close);
  const overlayBanner = overlay
    ? h(
        'div',
        { class: 'note info', style: 'margin-bottom:10px' },
        icon('info'),
        h(
          'div',
          { class: 'grow' },
          h('div', {
            text: $t(
              'Showing the forecast “{0}”. The amount under each month is where it would end: {1} at {2}, against {3} as planned. Your plan is not changed.',
              overlay.name,
              M.label(k),
              money(shownClose(m)),
              money(m.close),
            ),
          }),
          h(
            'div',
            { class: 'acts', style: 'margin-top:8px' },
            h(
              'select',
              {
                class: 'inp sm',
                style: 'width:auto',
                'aria-label': $t('Forecast to show'),
                onchange: event => {
                  UI.overlay = event.target.value;
                  App.render();
                },
              },
              FTABS.filter(tab => tab[0] !== 'plan').map(tab =>
                h('option', { value: tab[0], text: tab[1], selected: tab[0] === UI.overlay }),
              ),
            ),
            btn(
              $t('Back to the plan'),
              () => {
                UI.overlay = null;
                App.render();
              },
              'sm primary',
            ),
          ),
        ),
      )
    : null;
  const strip = h(
    'div',
    { class: 'strip', role: 'tablist', 'aria-label': $t('Months') },
    projection.months.map(x =>
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': String(x.k === k),
          class: [
            overlay ? (shownClose(x) < 0 ? 'neg' : '') : x.status,
            x.k === k ? 'sel' : '',
            x.k === now ? 'cur' : '',
          ].join(' '),
          onclick: () => App.go('months', { month: x.k }),
        },
        h('b', { text: M.label(x.k) }),
        h('span', { text: compact(shownClose(x)) }),
      ),
    ),
    summary.n < 120
      ? h(
          'button',
          {
            type: 'button',
            title: $t('Plan one more month. This raises “Months to plan ahead” in Settings by one.'),
            onclick: () => {
              Actions.addMonth();
              App.go('months', { month: summary.s0 + summary.n });
            },
          },
          h('b', { text: $t('+ Add month') }),
          h('span', { text: M.label(summary.s0 + summary.n) }),
        )
      : null,
  );
  requestAnimationFrame(() => {
    const element = strip.querySelector('.sel');
    if (element) {
      strip.scrollLeft = element.offsetLeft - strip.offsetLeft - strip.clientWidth / 2 + element.offsetWidth / 2;
    }
  });
  const tickOf = e => ({
    key: e.key,
    label: e.label,
    amount: e.budget ? 0 : e.onCard ? -e.charged : e.amount,
    payTo: e.payTo || e.cover || null,
    account: e.account || null,
  });
  const togglePaid = e => Actions.setPaid(m.key, tickOf(e), !e.paid);
  /** One ledger line. Budgets show a progress bar; spends logged against a budget are always "paid". */
  const line = (e, showDate, sub) => {
    const adj = e.group === 'adjust';
    const b = e.budget;
    const box = adj
      ? null
      : h('input', {
          type: 'checkbox',
          class: 'check',
          checked: e.paid,
          disabled: !!e.of,
          'aria-label': b
            ? $t('Done for this month: {0}', e.label)
            : e.amount > 0
              ? $t('Received: {0}', e.label)
              : $t('Paid: {0}', e.label),
          onchange: () => togglePaid(e),
        });
    // the tick box sits in a larger click area of its own, so ticking never opens the row
    const cb = adj
      ? h('span', { style: 'width:34px' })
      : h(
          'label',
          {
            class: 'ck',
            title: e.of
              ? $t('Logged spends are always counted as paid')
              : b
                ? $t('Done with this budget for the month')
                : e.amount > 0
                  ? $t('Received')
                  : $t('Paid'),
            onclick: ev => ev.stopPropagation(),
          },
          box,
        );
    const description = [
      showDate && e.date !== null ? D.label(e.date, { weekday: 'short' }) : '',
      b ? budgetText(b) : e.fix ? $t('What you really had, compared with the paid lines') : e.sub,
      !b && !e.of && (e.group === 'inc' || e.group === 'bill' || e.group === 'item') ? CAT_NAME[e.cat] : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return row({
      left: cb,
      title: e.label,
      desc: description,
      del: e.key.startsWith('item:') ? () => remove('items', e.id) : null,
      cls: (e.paid && !b && !e.of && !e.fix ? 'done ' : '') + (e.skipped ? 'off ' : '') + (sub ? 'subrow' : ''),
      chips: [
        e.note ? info(e.note) : null,
        e.onCard
          ? chip($t('on {0}', accName(e.onCard)), 'warn')
          : e.paid && e.paidFrom && !e.of && !Store.plan.accounts.find(a => a.id === e.paidFrom && a.main)
            ? chip($t('from {0}', accName(e.paidFrom)))
            : null,
        e.vary && !e.over ? chip($t('estimate')) : null,
        b
          ? chip(
              b.closed ? $t('closed, rest released') : b.done ? $t('done') : $t('budget'),
              b.left < 0 ? 'bad' : 'acc',
            )
          : null,
        e.skipped ? chip($t('skipped this month'), 'warn') : e.over ? chip($t('changed this month'), 'acc') : null,
      ],
      extra: b
        ? h('div', { class: 'mini' }, bar(b.planned ? (b.spent / b.planned) * 100 : 100, b.left < 0 ? 'over' : 'good'))
        : null,
      right: [
        b && !b.closed
          ? btn(
              $t('Log'),
              ev => {
                ev.stopPropagation();
                logSpend(e.id, m);
              },
              'sm',
              'plus',
            )
          : null,
        amt(b ? -(b.closed ? b.spent : Math.max(b.planned, b.spent)) : e.onCard ? -e.charged : e.amount),
      ],
      onclick: !adj && e.key !== 'whatif' ? () => entryModal(e, m) : null,
    });
  };
  const body = [];
  if (!days) {
    for (const [g, label] of [
      ['inc', $t('Income')],
      ['bill', $t('Bills and living costs')],
      ['item', $t('Purchases')],
      ['trip', $t('Trips and events')],
      ['loan', $t('Loans')],
      ['wish', $t('Wishlist')],
      ['goal', $t('Savings')],
      ['adjust', $t('Plan against reality')],
    ]) {
      const es = m.entries.filter(e => e.group === g);
      if (!es.length) {
        continue;
      }
      const tops = es.filter(e => !e.of || !es.some(x => x.budget && x.id === e.of));
      // the group title folds its lines away; the total stays visible either way
      const isClosed = UI.closedGroups.has(g);
      const paidCount = es.filter(e => e.paid).length;
      body.push(
        h(
          'button',
          {
            type: 'button',
            class: 'grp-h grp-toggle' + (isClosed ? ' closed' : ''),
            'aria-expanded': String(!isClosed),
            title: isClosed ? $t('Show the lines') : $t('Hide the lines'),
            onclick: () => {
              if (isClosed) {
                UI.closedGroups.delete(g);
              } else {
                UI.closedGroups.add(g);
              }
              App.render();
            },
          },
          icon('right'),
          h('span', { text: label }),
          h('span', { class: 'grp-n', text: $t('{0} of {1} paid', paidCount, es.length) }),
          h('span', { class: 'grow' }),
          h('span', { class: 'num', text: signed(es.reduce((a, e) => a + e.amount, 0)) }),
        ),
      );
      if (isClosed) {
        continue;
      }
      body.push(
        h(
          'div',
          { class: 'rows' },
          tops.map(e => [
            line(e, true),
            e.budget
              ? es
                  .filter(x => x.of === e.id)
                  .sort((a, c) => (a.date || 0) - (c.date || 0))
                  .map(x => line(x, true, true))
              : null,
          ]),
        ),
      );
    }
  } else {
    const inR = e => e.date !== null && e.date >= m.start && e.date <= m.end;
    const und = m.entries.filter(e => !inR(e));
    const by = {};
    m.entries.filter(inR).forEach(e => (by[e.date] = by[e.date] || []).push(e));
    let bal = r2(m.open + und.reduce((a, e) => a + e.amount, 0));
    let low = Infinity;
    let lowDay = null;
    if (und.length) {
      body.push(
        h(
          'div',
          { class: 'day' },
          h(
            'div',
            { class: 'day-h' },
            h('b', { text: $t('No fixed day') }),
            h('span', { class: 'muted', text: $t('counted on the first day, to be safe') }),
            h('span', { class: 'bal', text: signed(und.reduce((a, e) => a + e.amount, 0)) }),
          ),
          und.map(e => line(e, false)),
        ),
      );
    }
    for (let n = m.start; n <= m.end; n++) {
      const es = by[n] || [];
      bal = r2(bal + es.reduce((a, e) => a + e.amount, 0));
      if (bal < low) {
        low = bal;
        lowDay = n;
      }
      body.push(
        h(
          'div',
          {
            class: 'day' + (D.weekend(n) ? ' we' : '') + (n === Store.day ? ' today' : '') + (es.length ? '' : ' nil'),
          },
          h(
            'div',
            { class: 'day-h' },
            h('b', { text: D.label(n, { weekday: 'short' }) }),
            n === Store.day ? chip($t('today'), 'acc') : null,
            n === m.start && settings.payDay ? chip($t('payday'), 'good') : null,
            es.length || n === Store.day ? h('span', { class: 'bal', text: money(bal) }) : h('span', { class: 'bal' }),
            ibtn($t('Add something on ') + D.label(n), () => itemModal(null, { date: D.key(n) }), 'ghost sm', 'plus'),
          ),
          es.map(e => line(e, false)),
        ),
      );
    }
    body.unshift(
      h(
        'div',
        { class: 'note ' + (low < 0 ? 'bad' : 'info'), style: 'margin-bottom:10px' },
        icon(low < 0 ? 'alert' : 'info'),
        h('div', {
          class: 'grow',
          text: $t(
            'Lowest balance during this month: {0} on {1}. The amount on the right of each day is your balance at the end of that day.',
            money(low),
            D.label(lowDay, { weekday: 'short' }),
          ),
        }),
      ),
    );
  }
  let actualVal = null;
  const tickable = m.entries.filter(e => e.group !== 'adjust' && !e.of && e.key !== 'whatif').map(e => e.key);
  const allPaid = tickable.length > 0 && m.entries.filter(e => tickable.includes(e.key)).every(e => e.paid);
  const inMonth = Store.day >= m.start && Store.day <= m.end;
  const budgets = m.entries.filter(e => e.budget);
  const over = Store.day > m.end;
  const actual = moneyInp({
    value: null,
    blank: true,
    neg: true,
    ph: fmtNum(m.close),
    label: $t('Real balance at month end'),
    onInput: n => {
      actualVal = n;
    },
  });
  const sumIf = f => r2(m.entries.reduce((x, e) => x + (f(e) ? e.amount : 0), 0));
  const paidIn = sumIf(e => e.paid && e.amount > 0 && !e.fix);
  const paidOut = -sumIf(e => e.paid && e.amount < 0 && !e.fix);
  const toIn = sumIf(e => !e.paid && e.amount > 0);
  const toPay = -sumIf(e => !e.paid && e.amount < 0);
  const fl = (l, v, className) =>
    h('div', null, h('div', { class: 'l', text: l }), h('div', { class: 'v ' + (className || ''), text: v }));
  const endCls = m.status === 'neg' ? 'bad' : m.status === 'tight' ? 'warn' : '';
  const note = h('textarea', {
    class: 'inp',
    maxlength: 600,
    placeholder: $t('Anything to remember about this month…'),
    'aria-label': $t('Notes'),
  });
  note.value = plan.notes[m.key] || '';
  note.addEventListener('change', () => Actions.setNote(m.key, note.value));
  const budgetLeft = budgets.reduce((a, e) => a + Math.max(0, e.budget.left), 0);
  const daysLeft = Store.day >= m.start && Store.day <= m.end ? m.end - Store.day + 1 : 0;
  // one button, one menu: everything that can be added to this month
  const addMenu = event =>
    ctxMenu(event, [
      [$t('Purchase'), () => logPurchase(m)],
      [$t('Planned one-off'), () => itemModal(null, { month: monthKey })],
      [$t('Money in'), () => itemModal(null, { month: monthKey, kind: 'in', cat: 'other' })],
      [$t('Trip or event'), () => tripModal(null, { month: monthKey })],
      [$t('New bill from this month'), () => recModal('bills', null, { from: monthKey })],
      [$t('Budget'), () => recModal('bills', null, { budget: true })],
      [$t('Loan'), () => loanModal()],
    ]);
  // the sum behind the tiles, folded away until someone wants to see it
  const explainBox = props =>
    h('details', { class: 'more' }, h('summary', { text: $t('How this adds up') }), h('p', props));
  return page(
    $t('Month planner'),
    $t(
      'Everything that touches each month, from every part of your plan: bills, budgets, one-offs, trips, loans and savings.',
    ),
    [
      segc(
        [
          ['list', $t('By type')],
          ['days', $t('Day by day')],
        ],
        UI.mview,
        v => {
          UI.mview = v;
          App.render();
        },
      ),
      ibtn($t('Previous month'), () => App.go('months', { month: k - 1 }), k <= summary.s0 ? 'hide' : '', 'left'),
      btn($t('This month'), () => App.go('months', { month: null }), ''),
      ibtn(
        $t('Next month'),
        () => App.go('months', { month: k + 1 }),
        k >= summary.s0 + summary.n - 1 ? 'hide' : '',
        'right',
      ),
    ],
    overlayBanner,
    strip,
    h(
      'div',
      { class: 'cols lead' },
      card(
        M.label(k, true),
        [
          settings.payDay ? rangeLabel(m) : '',
          m.status === 'neg' ? $t('Ends below zero.') : m.status === 'tight' ? $t('Ends under your cushion.') : '',
        ]
          .filter(Boolean)
          .join(' · ') || null,
        btn($t('Add to this month'), addMenu, 'primary sm', 'plus'),
        coverNote(m),
        inMonth
          ? h(
              'div',
              { class: 'flow' },
              fl($t('You have now'), money(m.now), m.now < 0 ? 'bad' : ''),
              toIn ? fl($t('Still to come in'), signed(toIn), 'good') : null,
              fl($t('Still to pay'), money(-toPay)),
              fl($t('Left at the end'), money(m.close), endCls),
            )
          : h(
              'div',
              { class: 'flow' },
              fl($t('Start of month'), money(m.open)),
              fl($t('Money in'), signed(m.inc), 'good'),
              fl($t('Money out'), money(-m.out)),
              fl($t('End of month'), money(m.close), endCls),
            ),
        explainBox({
          class: 'small muted',
          style: 'margin-top:8px',
          text: inMonth
            ? $t(
                'The month started with {0}. Paid lines so far: {1} in, {2} out.',
                money(m.open),
                money(paidIn),
                money(paidOut),
              ) +
              (m.fix && m.fix.a ? ' ' + $t('Correction from your real money: {0}.', signed(m.fix.a)) : '') +
              ' ' +
              $t(
                'That makes {0} now. Tick a line when it is paid: its amount moves from “still to pay” into “you have now”. “Left at the end” only changes when an amount changes.',
                money(m.now),
              )
            : (k > summary.s0
                ? $t('{0} ended at {1}, so this month starts with that.', M.label(k - 1), money(m.open))
                : $t('The plan starts with {0} (set in Settings).', money(m.open))) +
              ' ' +
              $t(
                '{0} comes in and {1} goes out, which leaves {2}.',
                money(m.inc),
                money(m.out),
                money(r2(m.open + m.inc - m.out)),
              ) +
              (m.fix && m.fix.a ? ' ' + $t('Corrected by {0} from your real money.', signed(m.fix.a)) : ''),
        }),
        tickable.length || inMonth
          ? h(
              'div',
              { class: 'acts', style: 'margin-top:10px' },
              inMonth && !UI.hideCheck ? btn($t('I really have a different amount'), balancesModal, 'sm') : null,
              tickable.length
                ? btn(
                    allPaid ? $t('Untick all') : $t('Tick all as paid'),
                    () =>
                      Actions.setPaidAll(m.key, m.entries.filter(e => tickable.includes(e.key)).map(tickOf), !allPaid),
                    'sm ghost',
                    'check',
                  )
                : null,
              info(
                $t(
                  'A ticked line is paid: its amount is already inside what you have now. A line that is not ticked is still to come. Budgets work the same way through the spends you log.',
                ),
              ),
            )
          : null,
        body.length
          ? h('div', { style: 'margin-top:14px' }, body)
          : empty(
              $t('Nothing in this month yet'),
              $t('Add income and bills, or a one-off for this month.'),
              $t('Add to this month'),
              () => itemModal(null, { month: monthKey }),
            ),
      ),
      h(
        'div',
        { class: 'stack' },
        budgets.length
          ? card(
              $t('Budgets'),
              over
                ? $t('This month is over. What you did not spend went back into your cash.')
                : daysLeft
                  ? $t(
                      '{0} left in total, about {1} a day for {2}.',
                      money(budgetLeft),
                      money(budgetLeft / daysLeft),
                      plural(daysLeft, 'day'),
                    )
                  : $t('Log what you spend and see what is left.'),
              null,
              budgets.map(e =>
                h(
                  'div',
                  { class: 'prow' },
                  h('div', { class: 'top' }, h('span', { text: e.label }), h('span', { text: budgetText(e.budget) })),
                  bar(
                    e.budget.planned ? (e.budget.spent / e.budget.planned) * 100 : 100,
                    e.budget.left < 0 ? 'over' : 'good',
                  ),
                  h(
                    'div',
                    { class: 'acts', style: 'margin-top:6px' },
                    btn($t('Log a spend'), () => logSpend(e.id, m), 'sm', 'plus'),
                    btn($t('Change this month’s budget'), () => entryModal(e, m), 'sm ghost'),
                  ),
                ),
              ),
              h(
                'div',
                { class: 'acts', style: 'margin-top:8px' },
                btn($t('Add another budget'), () => recModal('bills', null, { budget: true }), 'sm ghost', 'plus'),
              ),
            )
          : card(
              $t('Budgets'),
              $t(
                'For money you spend bit by bit: groceries, fuel, going out, pets, “everything else”. The full budget is counted in your plan even if you log nothing; logging just shows what is left.',
              ),
              null,
              btn($t('Add a budget'), () => recModal('bills', null, { budget: true }), 'sm', 'plus'),
            ),
        (inMonth || over) && !UI.hideCheck
          ? card(
              $t('Check against reality'),
              inMonth
                ? $t('Does “You have now” match your bank and cash?')
                : $t('Did this month end where the plan says?'),
              h(
                'div',
                { class: 'acts' },
                info(
                  $t(
                    'You do not have to log every purchase. Now and then, compare “You have now” with what you really have. If it is different, enter the real amount: the planner asks what is already paid and counts the rest as spending that is not in the plan.',
                  ),
                ),
                ibtn(
                  $t('Hide this card'),
                  () => {
                    // hidden for this visit only: it is back the next time the page is loaded
                    UI.hideCheck = true;
                    App.render();
                    toast($t('Card hidden until you reload the page.'));
                  },
                  'sm ghost',
                  'x',
                ),
              ),
              fixNote(m),
              inMonth
                ? h(
                    'div',
                    { class: 'acts', style: 'margin-top:8px' },
                    btn(m.fix ? $t('Check again') : $t('Enter what I really have'), balancesModal, 'sm primary'),
                    m.fix ? btn($t('Remove the correction'), () => Actions.clearFix(m.key), 'sm ghost') : null,
                  )
                : h(
                    'div',
                    null,
                    h(
                      'div',
                      { style: 'display:flex;gap:8px;margin-top:6px' },
                      actual,
                      btn(
                        $t('Save'),
                        () => {
                          if (actualVal != null) {
                            Actions.setEnd(m.key, actualVal);
                          }
                        },
                        '',
                      ),
                      m.fix ? btn($t('Clear'), () => Actions.clearFix(m.key), 'ghost') : null,
                    ),
                  ),
            )
          : null,
        card($t('Notes'), null, null, note),
      ),
    ),
  );
};
