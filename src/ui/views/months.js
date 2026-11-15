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
import { balanceChip, balancesModal } from '../modals/balances.js';
import { monthEquation } from '../components/monthEquation.js';
import { monthPosition } from '../../logic/position.js';
import { entryModal } from '../modals/entry.js';
import { itemModal, logPurchase, logSpend } from '../modals/item.js';
import { loanModal } from '../modals/loan.js';
import { recModal } from '../modals/recurring.js';
import { tripModal } from '../modals/trip.js';
import { UI, monthAt, nowK, rangeLabel, selK } from '../state.js';
import { FTABS, forecastCloses, forecastInputs } from './forecast.js';
import { V } from './registry.js';

/** ‹ This month › as one control. At the first or last month the arrow is disabled, not hidden, so nothing shifts. */
function monthNav(k, summary) {
  const previous = ibtn($t('Previous month'), () => App.go('months', { month: k - 1 }), '', 'left');
  const next = ibtn($t('Next month'), () => App.go('months', { month: k + 1 }), '', 'right');
  previous.disabled = k <= summary.s0;
  next.disabled = k >= summary.s0 + summary.n - 1;
  return h(
    'div',
    { class: 'monthnav', role: 'group', 'aria-label': $t('Month') },
    previous,
    btn($t('This month'), () => App.go('months', { month: null }), ''),
    next,
  );
}
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
              'Forecast view: “{0}”. {1} ends at {2} (plan: {3}). Your plan is unchanged.',
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
            // the same inputs as on the Forecast page: change a value and the numbers below update at once
            forecastInputs(UI.overlay, change => {
              Object.assign(UI.forecast, change);
              App.render();
            }),
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
            title: $t('Extends the plan by one month.'),
            onclick: () => {
              Actions.addMonth();
              App.go('months', { month: summary.s0 + summary.n });
            },
          },
          h('b', { text: $t('+ Month') }),
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
  /** Row actions of a budget: log a spend, change it for this month, close it (or reopen it). */
  const budgetActions = e => [
    e.budget.done || e.budget.closed ? null : [$t('Log a spend'), () => logSpend(e.id, m)],
    [$t('Adjust this month'), () => entryModal(e, m)],
    e.budget.done ? [$t('Reopen budget'), () => togglePaid(e)] : null,
    !e.budget.done && !e.budget.closed ? [$t('Close budget'), () => togglePaid(e)] : null,
  ];
  const budgetMenuButton = e =>
    h(
      'button',
      {
        type: 'button',
        class: 'btn icon ghost sm',
        'aria-label': $t('Actions for {0}', e.label),
        'aria-haspopup': 'menu',
        title: $t('More actions'),
        onclick: event => {
          event.stopPropagation();
          ctxMenu(event, budgetActions(e));
        },
      },
      icon('menu'),
    );
  /** One ledger line. Budgets show a progress bar; spends logged against a budget are always "paid". */
  const line = (e, showDate, sub) => {
    const adj = e.group === 'adjust';
    const b = e.budget;
    // a budget has no tick box: closing it ("done for this month, release the rest") is a row action of its own
    const box =
      adj || b
        ? null
        : h('input', {
            type: 'checkbox',
            class: 'check',
            checked: e.paid,
            disabled: !!e.of,
            'aria-label': e.amount > 0 ? $t('Received: {0}', e.label) : $t('Paid: {0}', e.label),
            onchange: () => togglePaid(e),
          });
    // the tick box sits in a larger click area of its own, so ticking never opens the row
    const cb =
      adj || b
        ? h('span', { style: 'width:34px' })
        : h(
            'label',
            {
              class: 'ck',
              title: e.of ? $t('Logged spends are always counted as paid') : e.amount > 0 ? $t('Received') : $t('Paid'),
              onclick: ev => ev.stopPropagation(),
            },
            box,
          );
    const description = [
      showDate && e.date !== null ? D.label(e.date, { weekday: 'short' }) : '',
      // inside its budget a spend does not repeat "From “budget”"
      b ? budgetText(b) : e.fix ? $t('What you really had, compared with the paid lines') : sub && e.of ? '' : e.sub,
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
              b.closed || b.done ? $t('closed') : !b.reserve ? $t('limit') : $t('budget'),
              b.left < 0 ? 'bad' : 'acc',
            )
          : null,
        e.skipped
          ? chip($t('skipped this month'), 'warn')
          : e.over || (b && b.reserveOver)
            ? chip($t('changed this month'), 'acc')
            : null,
      ],
      extra: b
        ? h('div', { class: 'mini' }, bar(b.planned ? (b.spent / b.planned) * 100 : 100, b.left < 0 ? 'over' : 'good'))
        : null,
      right: [
        b && !b.closed && !b.done
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
        b ? budgetMenuButton(e) : null,
        amt(b ? -(b.closed || !b.reserve ? b.spent : Math.max(b.planned, b.spent)) : e.onCard ? -e.charged : e.amount),
      ],
      onclick: !adj && e.key !== 'whatif' ? () => entryModal(e, m) : null,
      menu: b ? budgetActions(e) : null,
    });
  };
  // a tracked budget with nothing logged holds nothing back, so it stays out of the lines, the counts and "tick all"
  const quiet = e => !!e.budget && !e.budget.reserve && !e.budget.spent && !e.budget.countsLimit;
  const shown = m.entries.filter(e => !quiet(e));
  const body = [];
  /**
   * The spends logged against one budget, folded by default ("20 spends · 515,59 €"): a month of groceries would
   * otherwise fill the page. Opening one is remembered for the visit.
   */
  const budgetSpends = (budgetEntry, spends) => {
    if (!spends.length) {
      return null;
    }
    const foldKey = m.key + ':' + budgetEntry.id;
    const isOpen = UI.openBudgets.has(foldKey);
    const total = spends.reduce((a, x) => a + x.amount, 0);
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'spendfold' + (isOpen ? ' open' : ''),
        'aria-expanded': String(isOpen),
        onclick: () => {
          if (isOpen) {
            UI.openBudgets.delete(foldKey);
          } else {
            UI.openBudgets.add(foldKey);
          }
          App.render();
        },
      },
      icon('right'),
      h('span', { text: $t('{0} · {1}', plural(spends.length, 'spend'), money(-total)) }),
    );
    if (!isOpen) {
      return toggle;
    }
    return [toggle, [...spends].sort((a, c) => (a.date || 0) - (c.date || 0)).map(x => line(x, true, true))];
  };
  if (!days) {
    for (const [g, label] of [
      ['inc', $t('Income')],
      ['bill', $t('Bills and living costs')],
      ['item', $t('Purchases')],
      ['trip', $t('Trips and events')],
      ['loan', $t('Loans')],
      ['wish', $t('Wishlist')],
      ['goal', $t('Savings')],
      ['transfer', $t('Borrowed or from savings')],
      ['adjust', $t('Balance correction')],
    ]) {
      const es = shown.filter(e => e.group === g);
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
          // a correction is always one paid line, so a count would only add noise there
          g === 'adjust' ? null : h('span', { class: 'grp-n', text: $t('{0}/{1} paid', paidCount, es.length) }),
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
              ? budgetSpends(
                  e,
                  es.filter(x => x.of === e.id),
                )
              : null,
          ]),
        ),
      );
    }
  } else {
    const inR = e => e.date !== null && e.date >= m.start && e.date <= m.end;
    const und = shown.filter(e => !inR(e));
    const by = {};
    shown.filter(inR).forEach(e => (by[e.date] = by[e.date] || []).push(e));
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
            es.length || n === Store.day
              ? h('span', { class: 'bal', title: $t('End-of-day balance'), text: money(bal) })
              : h('span', { class: 'bal' }),
            ibtn($t('Add something on {0}', D.label(n)), () => itemModal(null, { date: D.key(n) }), 'ghost sm', 'plus'),
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
          text: $t('Lowest: {0} on {1}.', money(low), D.label(lowDay, { weekday: 'short' })),
        }),
      ),
    );
  }
  let actualVal = null;
  // "Mark all paid" ticks bills and income; budgets are closed one by one with their own action
  const tickable = shown.filter(e => e.group !== 'adjust' && !e.of && !e.budget && e.key !== 'whatif').map(e => e.key);
  const allPaid = tickable.length > 0 && m.entries.filter(e => tickable.includes(e.key)).every(e => e.paid);
  const inMonth = Store.day >= m.start && Store.day <= m.end;
  const budgets = m.entries.filter(e => e.budget);
  const over = Store.day > m.end;
  const actual = moneyInp({
    value: null,
    blank: true,
    neg: true,
    ph: fmtNum(m.close),
    label: $t('Real balance on {0}', D.label(m.end)),
    onInput: n => {
      actualVal = n;
    },
  });
  const sumIf = f => r2(m.entries.reduce((x, e) => x + (f(e) ? e.amount : 0), 0));
  const paidIn = sumIf(e => e.paid && e.amount > 0 && !e.fix);
  const paidOut = -sumIf(e => e.paid && e.amount < 0 && !e.fix);
  const position = monthPosition(m, Store.day);
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
  // only reserved budgets hold money back; tracked ones just show what you spent against a limit
  // in a month that has not started a limit counts in full, like a reserved budget
  const reservedBudgets = budgets.filter(e => e.budget.reserve || e.budget.countsLimit);
  const trackedBudgets = budgets.filter(e => !e.budget.reserve && !e.budget.countsLimit);
  // the same "budgets left" as the sum above and the Overview (a closed budget holds nothing back)
  const budgetLeft = position.budgetsLeft;
  const trackedSpent = trackedBudgets.reduce((a, e) => a + e.budget.spent, 0);
  const budgetsNote = () => {
    const parts = [];
    if (reservedBudgets.length) {
      parts.push(
        trackedBudgets.length
          ? $t(
              '{0} still set aside, about {1} a day for {2}.',
              money(budgetLeft),
              money(budgetLeft / daysLeft),
              plural(daysLeft, 'day'),
            )
          : $t(
              '{0} left in total, about {1} a day for {2}.',
              money(budgetLeft),
              money(budgetLeft / daysLeft),
              plural(daysLeft, 'day'),
            ),
      );
    }
    if (trackedBudgets.length) {
      parts.push(
        trackedSpent
          ? $t('Limits set nothing aside: the {0} you spent on them comes out of your free money.', money(trackedSpent))
          : $t('Limits set nothing aside and count only once you log a spend on them.'),
      );
    }
    return parts.join(' ');
  };
  const daysLeft = Store.day >= m.start && Store.day <= m.end ? m.end - Store.day + 1 : 0;
  // one expense entry: in the current month it starts dated today (a purchase), otherwise undated in that month (planned)
  const addExpense = () => {
    if (inMonth) {
      logPurchase(m);
    } else {
      itemModal(null, { month: monthKey });
    }
  };
  // one button, one menu: everything that can be added to this month
  const addMenu = event =>
    ctxMenu(event, [
      [$t('Expense'), addExpense],
      [$t('Income'), () => itemModal(null, { month: monthKey, kind: 'in', cat: 'other' })],
      [$t('Trip or event'), () => tripModal(null, { month: monthKey })],
      [$t('Recurring bill'), () => recModal('bills', null, { from: monthKey })],
      [$t('Budget'), () => recModal('bills', null, { budget: true })],
      [$t('Loan'), () => loanModal()],
    ]);
  // with a payday the month ends the day before the next salary, so say so
  const endLabel = settings.payDay ? $t('Left by payday') : $t('Month-end balance');
  const correction = m.fix && m.fix.a ? $t('Balance correction: {0}.', signed(m.fix.a)) : null;
  /** The sum behind the tiles, as whole sentences (each one translated on its own). */
  const explainSentences = () => {
    if (inMonth) {
      return [
        $t(
          'The month started with {0}. Paid lines so far: {1} in, {2} out.',
          money(m.open),
          money(paidIn),
          money(paidOut),
        ),
        correction,
        $t('That makes {0} now.', money(m.now)),
      ].filter(Boolean);
    }
    const opening =
      k > summary.s0
        ? $t('{0} ended at {1}, so this month starts with that.', M.label(k - 1), money(m.open))
        : $t('The plan starts with {0} (set in Settings).', money(m.open));
    return [
      opening,
      $t(
        '{0} comes in and {1} goes out, which leaves {2}.',
        money(m.inc),
        money(m.out),
        money(r2(m.open + m.inc - m.out)),
      ),
      m.moved ? $t('Borrowed or taken from savings: {0}.', signed(m.moved)) : null,
      correction,
    ].filter(Boolean);
  };
  // the sum behind the tiles, folded away until someone wants to see it
  const explainBox = props =>
    h('details', { class: 'more' }, h('summary', { text: $t('How this adds up') }), h('p', props));
  return page(
    $t('Month planner'),
    null,
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
      monthNav(k, summary),
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
          ? monthEquation(position, {
              endLabel,
              endClass: endCls,
              status: balanceChip(m),
              perDayText:
                position.budgetsLeft > 0 && position.daysLeft
                  ? $t('{0}/day for {1}', money(position.perDay), plural(position.daysLeft, 'day'))
                  : null,
            })
          : h(
              'div',
              { class: 'flow' },
              fl($t('Start of month'), money(m.open)),
              fl($t('Money in'), signed(m.inc), 'good'),
              fl($t('Money out'), money(-m.out)),
              m.moved ? fl($t('Borrowed or from savings'), signed(m.moved)) : null,
              fl(endLabel, money(m.close), endCls),
            ),
        // the equation shows the current month's sum; other months keep the sentence version
        inMonth
          ? null
          : explainBox({
              class: 'small muted',
              style: 'margin-top:8px',
              text: explainSentences().join(' '),
            }),
        tickable.length || inMonth
          ? h(
              'div',
              { class: 'acts', style: 'margin-top:10px' },
              tickable.length
                ? btn(
                    allPaid ? $t('Untick all') : $t('Mark all paid'),
                    () =>
                      Actions.setPaidAll(m.key, m.entries.filter(e => tickable.includes(e.key)).map(tickOf), !allPaid),
                    'sm ghost',
                    'check',
                  )
                : null,
              info($t('Ticked = already in your balance.')),
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
                  ? budgetsNote()
                  : $t('Log what you spend and see what is left.'),
              null,
              // the whole row logs a spend; "Adjust this month" and "Close budget" are in its menu
              budgets.map(e => {
                const open = !e.budget.done && !e.budget.closed;
                const logHere = () => (open ? logSpend(e.id, m) : entryModal(e, m));
                return h(
                  'div',
                  {
                    class: 'prow click',
                    role: 'button',
                    tabindex: 0,
                    title: open ? $t('Log a spend') : $t('Adjust this month'),
                    onclick: logHere,
                    onkeydown: event => {
                      if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        logHere();
                      }
                    },
                    oncontextmenu: event => ctxMenu(event, budgetActions(e)),
                  },
                  h(
                    'div',
                    { class: 'top' },
                    h(
                      'span',
                      null,
                      e.label,
                      e.budget.reserve ? null : [' ', chip($t('limit'), 'acc')],
                      open ? null : [' ', chip($t('closed'))],
                    ),
                    h(
                      'span',
                      { class: 'prow-r' },
                      h('span', { text: quiet(e) ? $t('nothing logged, not counted') : budgetText(e.budget) }),
                      budgetMenuButton(e),
                    ),
                  ),
                  quiet(e)
                    ? null
                    : bar(
                        e.budget.planned ? (e.budget.spent / e.budget.planned) * 100 : 100,
                        e.budget.left < 0 ? 'over' : 'good',
                      ),
                );
              }),
              h(
                'div',
                { class: 'acts', style: 'margin-top:8px' },
                btn($t('Add another budget'), () => recModal('bills', null, { budget: true }), 'sm ghost', 'plus'),
              ),
            )
          : card(
              $t('Budgets'),
              $t('For spending that happens bit by bit: groceries, fuel, eating out.'),
              null,
              btn($t('Add a budget'), () => recModal('bills', null, { budget: true }), 'sm', 'plus'),
            ),
        // the current month's check lives in the status chip of the sum; this card is for a correction already made,
        // and for entering where a finished month really ended
        (over || (inMonth && m.fix)) && !UI.hideCheck
          ? card(
              $t('Balance check'),
              inMonth
                ? $t('Does “You have now” match your bank and cash?')
                : $t('Did this month end where the plan says?'),
              h(
                'div',
                { class: 'acts' },
                info(
                  $t(
                    'No need to log every purchase. Update your balances now and then; any difference becomes a correction.',
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
                    btn($t('Update balances'), balancesModal, 'sm primary'),
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
