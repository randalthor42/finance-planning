/**
 * @file Overview page: where you are this month, insights, charts, upcoming payments.
 */
import { D, M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { budgetTrend } from '../../logic/advice.js';
import { loanCalc } from '../../logic/loans.js';
import { project } from '../../logic/projection.js';
import { CAT_NAME } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { cashChart, netBars } from '../components/charts.js';
import { amt, bar, budgetText, card, page, prow, row, tile } from '../components/layout.js';
import { moneyInp } from '../components/moneyInput.js';
import { monthField } from '../components/pickers.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { balancesModal } from '../modals/balances.js';
import { goalModal } from '../modals/goal.js';
import { itemModal, logPurchase, logSpend } from '../modals/item.js';
import { recModal } from '../modals/recurring.js';
import { rollModal, settingsModal } from '../modals/settings.js';
import { tripModal } from '../modals/trip.js';
import { UI, curK, monthAt, nowK, rangeLabel } from '../state.js';
import { V } from './registry.js';
import { reviewPeriod } from '../../logic/review.js';
import { forecastScenario } from '../../logic/forecast.js';
import { goodText, watchText } from './review.js';

function insights() {
  const plan = Store.plan;
  const projection = Store.proj;
  const settings = plan.settings;
  const summary = projection.summary;
  const out = [];
  const now = nowK();
  const currentMonth = curK();
  const end = summary.s0 + summary.n - 1;
  if (summary.s0 < now) {
    out.push({
      tone: 'info',
      text: $t(
        'This plan starts in {0}. Roll it forward so it starts from this month and your real balance.',
        M.label(summary.s0),
      ),
      act: [$t('Roll forward'), rollModal],
    });
  }
  if (summary.negN) {
    out.push({
      tone: 'bad',
      text: $t(
        'Cash runs out in {0}. {1} end{2} below zero, and the lowest point is {3} in {4}.',
        M.label(summary.firstNeg, true),
        plural(summary.negN, 'month'),
        summary.negN === 1 ? 's' : '',
        money(summary.min),
        M.label(summary.minK),
      ),
      k: summary.firstNeg,
    });
  } else if (summary.tightN) {
    out.push({
      tone: 'warn',
      text: $t(
        '{0} dip{1} under your {2} cushion. The lowest point is {3} in {4}.',
        plural(summary.tightN, 'month'),
        summary.tightN === 1 ? 's' : '',
        money(settings.cushion),
        money(summary.min),
        M.label(summary.minK),
      ),
      k: summary.minK,
    });
  } else {
    out.push({
      tone: 'good',
      text: $t(
        'You stay above {0} in every month. Lowest point: {1} in {2}.',
        settings.cushion ? $t('your ') + money(settings.cushion) + $t(' cushion') : $t('zero'),
        money(summary.min),
        M.label(summary.minK),
      ),
      k: summary.minK,
    });
  }
  {
    const cm = monthAt(currentMonth);
    const inM = Store.day >= cm.start && Store.day <= cm.end;
    if (!cm.fix && inM && !UI.hideCheck) {
      out.push({
        tone: 'info',
        text: $t(
          'Compare the planner with what you really have. One number is enough: you do not need to log every purchase.',
        ),
        act: [$t('Check it'), balancesModal],
      });
    }
  }
  budgetTrend(plan, currentMonth)
    .slice(0, 2)
    .forEach(b =>
      out.push({
        tone: 'warn',
        text: $t(
          '“{0}” averaged {1} over the last {2} months, against a budget of {3}.',
          b.name,
          money(b.avg),
          b.months,
          money(b.amount),
        ),
        act: [
          $t('Set it to {0}', money(Math.round(b.avg))),
          () =>
            Actions.patch(
              'bills',
              b.id,
              { amount: Math.round(b.avg) },
              $t('“{0}” budget set to {1}', b.name, money(Math.round(b.avg))),
            ),
        ],
      }),
    );
  if (summary.avgInc > 0 && summary.avgNet / summary.avgInc > 0.25) {
    out.push({
      tone: 'info',
      text: $t(
        'On paper you keep about {0} a month, {1}% of your income. If your account does not really grow like that, some spending is missing from the plan. Add an “Everything else” budget, or do a check-in with your real balance.',
        money(summary.avgNet),
        Math.round((summary.avgNet / summary.avgInc) * 100),
      ),
      act: [
        $t('Add a budget'),
        () => recModal('bills', null, { budget: true, name: $t('Everything else'), cat: 'other' }),
      ],
    });
  }
  const m = monthAt(currentMonth);
  m.entries
    .filter(e => e.budget && e.budget.left < 0)
    .forEach(e =>
      out.push({
        tone: 'warn',
        text: $t('“{0}” is {1} over budget this month.', e.label, money(-e.budget.left)),
        k: currentMonth,
      }),
    );
  plan.trips
    .filter(t => t.on && t.budget > 0 && t.items.reduce((a, i) => a + i.amount, 0) > t.budget)
    .forEach(t =>
      out.push({
        tone: 'warn',
        text: $t(
          '“{0}” is planned at {1}, over its {2} budget.',
          t.name,
          money(t.items.reduce((a, i) => a + i.amount, 0)),
          money(t.budget),
        ),
        act: [$t('Open trips'), () => App.go('trips')],
      }),
    );
  plan.goals.forEach(G => {
    const g = projection.goals[G.id];
    const by = M.parse(G.by);
    if (by !== null && G.target > 0 && (g.reached === null || g.reached > by)) {
      out.push({
        tone: 'warn',
        text: $t('“{0}” will not reach {1} by {2} at the current pace.', G.name, money(G.target), M.label(by)),
        act: [$t('Open goals'), () => App.go('goals')],
      });
    }
  });
  if (!settings.cushion) {
    out.push({
      tone: 'info',
      text: $t('Set a safety cushion so months that get close to zero are flagged early.'),
      act: [$t('Set cushion'), settingsModal],
    });
  }
  plan.bills
    .filter(b => {
      const t = M.parse(b.to);
      return t !== null && t >= currentMonth && t < end && b.amount > 0;
    })
    .slice(0, 2)
    .forEach(b =>
      out.push({
        tone: 'good',
        text: $t(
          '“{0}” ends after {1}. That frees {2}{3}.',
          b.name,
          M.label(M.parse(b.to)),
          money(b.amount),
          b.every === 1 ? $t(' a month') : '',
        ),
        k: M.parse(b.to),
      }),
    );
  for (const L of plan.loans) {
    const c = projection.loans[L.id];
    if (!c || !L.on || c.end < currentMonth) {
      continue;
    }
    const alt = loanCalc({ ...L, extra: L.extra + 50 });
    const save = c.int + c.fees - alt.int - alt.fees;
    const mo = c.sch.length - alt.sch.length;
    if (save > 1 && mo > 0) {
      out.push({
        tone: 'info',
        text: $t(
          'Paying {0} more a month on “{1}” would save about {2} and finish {3} sooner.',
          money(50),
          L.name,
          money(save),
          plural(mo, 'month'),
        ),
        act: [$t('Open loans'), () => App.go('loans')],
      });
    }
  }
  if (summary.avgOut > 0 && m.close + m.savings > 0) {
    const cover = (m.close + m.savings) / summary.avgOut;
    out.push({
      tone: cover >= 3 ? 'good' : 'info',
      text: $t(
        'Your cash and savings cover about {0} months of spending. A common target is 3 to 6.',
        cover.toFixed(1),
      ),
    });
  }
  const big = projection.months.reduce((a, b) => (b.out > a.out ? b : a));
  if (big.out > summary.avgOut * 1.35) {
    out.push({
      tone: 'info',
      text: $t('{0} is your most expensive month at {1}.', M.label(big.k, true), money(big.out)),
      k: big.k,
    });
  }
  return out.slice(0, 8);
}
function affordCard() {
  const projection = Store.proj;
  const summary = projection.summary;
  const a = UI.afford;
  const res = h('div', { class: 'notes', style: 'margin-top:10px' });
  const upd = () => {
    const k = clamp(M.parse(a.month) === null ? curK() : M.parse(a.month), summary.s0, summary.s0 + summary.n - 1);
    const base = project(Store.plan, { extra: [], today: Store.day });
    const cush = Store.plan.settings.cushion;
    const room = Math.min(...base.months.filter(m => m.k >= k).map(m => m.close)) - cush;
    const safe = h(
      'div',
      { class: 'note info' },
      icon('info'),
      h('div', {
        class: 'grow',
        text:
          room > 0
            ? $t(
                'You could spend up to {0} in {1} and still stay above {2} in every later month.',
                money(Math.floor(room)),
                M.label(k, true),
                cush ? $t('your cushion') : $t('zero'),
              )
            : $t(
                'There is no spare room in {0}: a later month is already {1}.',
                M.label(k, true),
                cush ? $t('under your cushion') : $t('at or below zero'),
              ),
      }),
    );
    if (!(a.amount > 0)) {
      return res.replaceChildren(safe);
    }
    const W = project(Store.plan, { extra: [{ k, amount: a.amount }], today: Store.day });
    const newNeg = W.months.filter((m, i) => m.status === 'neg' && base.months[i].status !== 'neg');
    const newTight = W.months.filter((m, i) => m.status === 'tight' && base.months[i].status === 'ok');
    const v = newNeg.length
      ? [
          'bad',
          $t(
            'Not safely. Cash would drop below zero in {0}, first in {1}.',
            plural(newNeg.length, 'more month'),
            M.label(newNeg[0].k, true),
          ),
        ]
      : newTight.length
        ? [
            'warn',
            $t(
              'It fits, but it is tight. {0} would dip under your cushion, down to {1} in {2}.',
              plural(newTight.length, 'month'),
              money(W.summary.min),
              M.label(W.summary.minK),
            ),
          ]
        : [
            'good',
            $t(
              'Yes. Your lowest point would be {0} in {1} (it is {2} now).',
              money(W.summary.min),
              M.label(W.summary.minK),
              money(base.summary.min),
            ),
          ];
    res.replaceChildren(
      h(
        'div',
        { class: 'note ' + v[0] },
        icon(v[0] === 'good' ? 'check' : 'alert'),
        h('div', { class: 'grow', text: v[1] }),
        btn($t('Add to plan'), () => itemModal(null, { amount: a.amount, month: M.key(k) }), 'sm'),
      ),
      safe,
    );
  };
  upd();
  return card(
    $t('Can I afford this?'),
    $t('Test a cost without changing your plan.'),
    null,
    h(
      'div',
      { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' },
      moneyInp({
        value: a.amount,
        ph: $t('Cost, e.g. 500'),
        label: $t('Cost'),
        onInput: n => {
          a.amount = n;
          upd();
        },
      }),
      monthField({
        value: a.month || M.key(curK()),
        onChange: v => {
          a.month = v;
          upd();
        },
      }),
    ),
    res,
  );
}

/** "Right now": where you are in the current budget month. Recomputed from today's date every time the page is drawn. */
function nowCard() {
  const settings = Store.plan.settings;
  const currentMonth = curK();
  const m = monthAt(currentMonth);
  const today = Store.day;
  const len = m.end - m.start + 1;
  const inside = today >= m.start && today <= m.end;
  const daysLeft = inside ? m.end - today + 1 : len;
  const budgets = m.entries.filter(e => e.budget);
  const budgetLeft = budgets.reduce((a, e) => a + (e.paid ? 0 : Math.max(0, e.budget.left)), 0);
  const toPay = -m.entries.reduce((a, e) => a + (e.still < 0 && !e.budget ? e.still : 0), 0);
  const toIn = m.entries.reduce((a, e) => a + (e.still > 0 ? e.still : 0), 0);
  const sub =
    today < m.start
      ? $t('Starts in {0}, on {1}', plural(m.start - today, 'day'), D.label(m.start, { weekday: 'short' }))
      : today > m.end
        ? $t('This month is over. Roll the plan forward to continue.')
        : $t(
            'Day {0} of {1} · {2} in {3} ({4})',
            today - m.start + 1,
            len,
            settings.payDay ? $t('next salary') : $t('next month'),
            plural(m.end + 1 - today, 'day'),
            D.label(m.end + 1, { weekday: 'short' }),
          );
  return card(
    M.label(currentMonth, true) + (settings.payDay ? ' · ' + rangeLabel(m) : ''),
    sub,
    btn($t('Open month'), () => App.go('months', { month: currentMonth }), 'sm'),
    inside ? bar(((today - m.start + 1) / len) * 100) : null,
    h(
      'div',
      { class: 'nowgrid' },
      tile(
        $t('You have now'),
        money(m.now),
        m.now < 0 ? 'bad' : '',
        m.fix && m.fix.d !== null ? $t('checked on ') + D.label(m.fix.d) : $t('from the lines you ticked'),
      ),
      tile(
        $t('Still to pay'),
        money(Math.max(0, toPay)),
        '',
        toIn > 0 ? $t('{0} still to come in', money(toIn)) : null,
      ),
      budgets.length
        ? tile(
            $t('Left in your budgets'),
            money(budgetLeft),
            '',
            $t('about {0} a day for {1}', money(budgetLeft / daysLeft), plural(daysLeft, 'day')),
          )
        : null,
      tile(
        $t('Left at the end'),
        money(m.close),
        m.close < 0 ? 'bad' : 'good',
        $t('this month on its own: {0}', signed(m.net)),
      ),
    ),
    h(
      'div',
      { class: 'acts' },
      budgets.length ? btn($t('Log a spend'), () => logSpend(budgets[0].id, m), 'primary sm', 'plus') : null,
      btn($t('What I have today'), balancesModal, 'sm', 'edit'),
      btn($t('Log a purchase'), () => logPurchase(m), budgets.length ? 'sm' : 'primary sm', 'plus'),
      btn($t('Trip'), () => tripModal(null, { month: M.key(currentMonth) }), 'sm', 'plus'),
      btn($t('Bill'), () => recModal('bills'), 'sm', 'plus'),
      btn($t('Savings goal'), () => goalModal(), 'sm', 'plus'),
    ),
  );
}
/** The current month in two lines: the best thing and the thing most worth watching, with a way into the full review. */
function monthReviewCard() {
  const month = monthAt(curK());
  const review = reviewPeriod(Store.plan, Store.proj, [month], Store.day);
  const pace = forecastScenario(Store.proj, month.k - Store.proj.summary.s0, {
    type: 'pace',
    sampleMonths: UI.forecast.sampleMonths,
  });
  const paceEnd = pace.rows[pace.rows.length - 1];
  const line = (tone, iconName, text) =>
    h('div', { class: 'note ' + tone }, icon(iconName), h('div', { class: 'grow', text }));
  return card(
    $t('How {0} is going', M.label(month.k, true)),
    $t('{0} went well, {1} to watch.', review.good.length, review.watch.length),
    btn($t('Full review'), () => App.go('review', { month: month.k }), 'sm'),
    h(
      'div',
      { class: 'notes' },
      review.watch.length ? line('warn', 'alert', watchText(review.watch[0])) : null,
      review.good.length ? line('good', 'check', goodText(review.good[0])) : null,
      line(
        'info',
        'info',
        $t(
          'As planned, the plan ends at {0}. If later months go like the next {1}, it ends at {2}.',
          money(paceEnd.planClose),
          plural(UI.forecast.sampleMonths, 'month'),
          money(paceEnd.close),
        ),
      ),
    ),
  );
}

V.overview = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const summary = projection.summary;
  const currentMonth = curK();
  const m = monthAt(currentMonth);
  const last = projection.months[summary.n - 1];
  const today = Store.day;
  const kpi = (l, v, sub, className) =>
    h(
      'div',
      { class: 'kpi' },
      h('div', { class: 'l', text: l }),
      h('div', { class: 'v ' + (className || ''), text: v }),
      h('div', { class: 's', text: sub }),
    );
  const lowCls = summary.min < 0 ? 'bad' : summary.min < plan.settings.cushion ? 'warn' : '';
  const kpis = h(
    'div',
    { class: 'kpis' },
    kpi(
      $t('Cash at end of {0}', M.label(currentMonth)),
      money(m.close),
      $t('{0} this month', signed(m.net)),
      m.close < 0 ? 'bad' : '',
    ),
    kpi($t('Lowest point'), money(summary.min), M.label(summary.minK, true), lowCls),
    kpi(
      $t('Free each month'),
      signed(summary.avgNet),
      $t('average over {0} months', summary.n),
      summary.avgNet < 0 ? 'bad' : '',
    ),
    m.debt > 0 || summary.debtFree !== null
      ? kpi(
          $t('Debt'),
          money(m.debt),
          summary.debtFree !== null && summary.debtFree >= currentMonth
            ? $t('Debt-free ') + M.label(summary.debtFree)
            : $t('All paid off'),
        )
      : null,
    kpi($t('Net worth, {0}', M.label(last.k)), money(last.worth), $t('{0} today', money(m.worth))),
  );
  const noData = !plan.bills.length && !plan.items.length && !plan.trips.length;
  const starter = noData
    ? card(
        $t('Build your plan'),
        $t('Three quick steps. Every number on this page updates as you go.'),
        null,
        h(
          'div',
          { class: 'rows' },
          row({
            title: $t('1. Add your bills and living costs'),
            desc: $t('Rent, groceries, phone, subscriptions.'),
            right: icon('right'),
            onclick: () => App.go('recurring'),
          }),
          row({
            title: $t('2. Add the one-offs you know about'),
            desc: $t('Gifts, a concert, something you plan to buy.'),
            right: icon('right'),
            onclick: () => App.go('items'),
          }),
          row({
            title: $t('3. Add trips, loans and savings goals'),
            desc: $t('Each one feeds straight into your months.'),
            right: icon('right'),
            onclick: () => App.go('trips'),
          }),
        ),
      )
    : null;
  const ins = insights().map(i =>
    h(
      'div',
      { class: 'note ' + i.tone },
      icon(i.tone === 'good' ? 'check' : i.tone === 'info' ? 'info' : 'alert'),
      h('div', { class: 'grow', text: i.text }),
      i.act
        ? btn(i.act[0], i.act[1], 'sm')
        : i.k != null
          ? btn($t('Open'), () => App.go('months', { month: i.k }), 'sm')
          : null,
    ),
  );
  // next things to pay: dated first (by day), then the ones without a fixed day
  const due = [];
  for (let k = currentMonth; k < Math.min(currentMonth + 2, summary.s0 + summary.n); k++) {
    for (const e of monthAt(k).entries) {
      if (
        e.amount < 0 &&
        !e.paid &&
        !e.budget &&
        e.group !== 'adjust' &&
        (e.date === null ? k === currentMonth : e.date >= today)
      ) {
        due.push([k, e]);
      }
    }
  }
  due.sort((a, b) => (a[1].date === null ? Infinity : a[1].date) - (b[1].date === null ? Infinity : b[1].date));
  const soon = [];
  for (let k = currentMonth + 1; k < Math.min(currentMonth + 5, summary.s0 + summary.n); k++) {
    for (const e of monthAt(k).entries) {
      if (e.group === 'item' || e.group === 'trip') {
        soon.push([k, e]);
      }
    }
  }
  const cats = {};
  let catTotal = 0;
  for (let k = currentMonth; k < Math.min(currentMonth + 12, summary.s0 + summary.n); k++) {
    for (const e of monthAt(k).entries) {
      if (e.amount < 0 && e.group !== 'adjust') {
        cats[e.cat] = (cats[e.cat] || 0) - e.amount;
        catTotal -= e.amount;
      }
    }
  }
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const catMax = catRows.length ? catRows[0][1] : 1;
  const budgets = m.entries.filter(e => e.budget);
  const i0 = currentMonth - summary.s0;
  const goalsLoans = [
    ...plan.goals.map(G => {
      const now = projection.goals[G.id].series[i0];
      return prow(
        G.name,
        G.target ? `${money(now)} of ${money(G.target)}` : money(now),
        G.target ? (now / G.target) * 100 : 100,
        'good',
        () => App.go('goals'),
      );
    }),
    ...plan.accounts
      .filter(a => a.type === 'credit' && a.limit > 0 && projection.cards[a.id].series[i0] > 0)
      .map(a =>
        prow(
          a.name,
          $t('{0} owed of {1}', money(projection.cards[a.id].series[i0]), money(a.limit)),
          (projection.cards[a.id].series[i0] / a.limit) * 100,
          'warn',
          () => App.go('accounts'),
        ),
      ),
    ...plan.loans
      .filter(L => L.on && projection.loans[L.id] && projection.loans[L.id].balAt(currentMonth) > 0)
      .map(L => {
        const c = projection.loans[L.id];
        const owed = c.balAt(currentMonth);
        return prow(L.name, $t('{0} left of {1}', money(owed), money(c.P)), (1 - owed / c.P) * 100, '', () =>
          App.go('loans'),
        );
      }),
  ];
  return page(
    $t('Overview'),
    $t(
      '{0} · {1} to {2} · updated for {3}',
      plan.name,
      M.label(summary.s0),
      M.label(summary.endK),
      D.label(today, { weekday: 'long', year: 'numeric' }),
    ),
    null,
    kpis,
    starter,
    nowCard(),
    h('div', { style: 'height:16px' }),
    card($t('Where your money is heading'), $t('Hover for a month, click to open it.'), null, cashChart()),
    h(
      'div',
      { class: 'cols', style: 'margin-top:16px' },
      h(
        'div',
        { class: 'stack' },
        card($t('Worth knowing'), null, null, h('div', { class: 'notes' }, ins)),
        card(
          $t('What is left each month'),
          $t('Money in minus money out. Red months spend more than comes in.'),
          null,
          netBars(),
          h(
            'div',
            { class: 'legend static' },
            h('span', null, h('i', { style: 'background:var(--good)' }), $t('Money left over')),
            h('span', null, h('i', { style: 'background:var(--bad)' }), $t('Spent more than came in')),
          ),
        ),
        monthReviewCard(),
        affordCard(),
      ),
      h(
        'div',
        { class: 'stack' },
        budgets.length
          ? card(
              $t('Budgets this month'),
              $t('What you have spent from each budget so far.'),
              btn($t('Log a spend'), () => logSpend(budgets[0].id, m), 'sm', 'plus'),
              budgets.map(e =>
                prow(
                  e.label,
                  budgetText(e.budget),
                  e.budget.planned ? (e.budget.spent / e.budget.planned) * 100 : 100,
                  e.budget.left < 0 ? 'over' : 'good',
                  () => logSpend(e.id, m),
                ),
              ),
            )
          : null,
        card(
          $t('Next to pay'),
          $t('Unpaid costs, soonest first.'),
          null,
          due.length
            ? h(
                'div',
                { class: 'rows' },
                due.slice(0, 7).map(([k, e]) =>
                  row({
                    title: e.label,
                    desc:
                      (e.date === null ? $t('No fixed day · ') + M.label(k) : D.label(e.date, { weekday: 'short' })) +
                      (e.sub ? ' · ' + e.sub : ''),
                    right: amt(e.amount),
                    onclick: () => App.go('months', { month: k }),
                  }),
                ),
                due.length > 7
                  ? h('div', {
                      class: 'muted small',
                      style: 'padding:8px 6px 0',
                      text: $t('and {0} more', due.length - 7),
                    })
                  : null,
              )
            : h('p', { class: 'muted', text: $t('Nothing left to pay right now.') }),
        ),
        soon.length
          ? card(
              $t('Coming up later'),
              $t('One-offs and trip costs in the following months.'),
              null,
              h(
                'div',
                { class: 'rows' },
                soon.slice(0, 6).map(([k, e]) =>
                  row({
                    title: e.label,
                    desc: M.label(k) + (e.sub ? ' · ' + e.sub : ''),
                    right: amt(e.amount),
                    onclick: () => App.go('months', { month: k }),
                  }),
                ),
              ),
            )
          : null,
        goalsLoans.length ? card($t('Savings and debt'), $t('Progress as of this month.'), null, goalsLoans) : null,
        catRows.length
          ? card(
              $t('Where it goes'),
              $t('Next 12 months, by category.'),
              null,
              catRows
                .slice(0, 8)
                .map(([c, v]) =>
                  h(
                    'div',
                    { class: 'catrow' },
                    h('span', { text: CAT_NAME[c] || $t('Other') }),
                    h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(2, (v / catMax) * 100)}%` })),
                    h('span', { class: 'num muted', text: `${money(v)} · ${Math.round((v / catTotal) * 100)}%` }),
                  ),
                ),
            )
          : null,
      ),
    ),
  );
};
