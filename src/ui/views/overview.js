/**
 * @file Overview page: where you are this month, insights, charts, upcoming payments.
 */
import { D, M } from '../../core/dates.js';
import { fmtNum, money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { budgetTrend } from '../../logic/advice.js';
import { duplicateLines } from '../../logic/audit.js';
import { loanCalc } from '../../logic/loans.js';
import { project } from '../../logic/projection.js';
import { ctxMenu } from '../components/popover.js';
import { CAT_NAME } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { calendar } from '../components/calendar.js';
import { planCalendar } from '../components/calendarData.js';
import { nextDays } from '../../logic/calendar.js';
import { cashChart, netBars } from '../components/charts.js';
import { amt, bar, budgetText, card, chip, designPage, prow, row } from '../components/layout.js';
import { moneyInp } from '../components/moneyInput.js';
import { monthField } from '../components/pickers.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { balanceChip, balancesModal } from '../modals/balances.js';
import { monthEquation } from '../components/monthEquation.js';
import { monthPosition } from '../../logic/position.js';
import { goalModal } from '../modals/goal.js';
import { itemModal, lastBudget, logPurchase, logSpend } from '../modals/item.js';
import { recModal } from '../modals/recurring.js';
import { rollModal, settingsModal } from '../modals/settings.js';
import { tripModal } from '../modals/trip.js';
import { UI, curK, monthAt, nowK, rangeLabel } from '../state.js';
import { designable } from '../components/designPages.js';
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
        'Cash runs out in {0}. {1} below zero. Lowest: {2} in {3}.',
        M.label(summary.firstNeg, true),
        plural(summary.negN, 'month'),
        money(summary.min),
        M.label(summary.minK),
      ),
      k: summary.firstNeg,
    });
  } else if (summary.tightN) {
    out.push({
      tone: 'warn',
      text: $t(
        '{0} under your {1} cushion. Lowest: {2} in {3}.',
        plural(summary.tightN, 'month'),
        money(settings.cushion),
        money(summary.min),
        M.label(summary.minK),
      ),
      k: summary.minK,
    });
  } else {
    out.push({
      tone: 'good',
      text: settings.cushion
        ? $t(
            'You stay above your {0} cushion in every month. Lowest: {1} in {2}.',
            money(settings.cushion),
            money(summary.min),
            M.label(summary.minK),
          )
        : $t('You stay above zero in every month. Lowest: {0} in {1}.', money(summary.min), M.label(summary.minK)),
      k: summary.minK,
    });
  }
  for (const duplicate of duplicateLines(plan)) {
    out.push({
      tone: 'warn',
      text: $t(
        'Possibly entered twice: {0} ({1} each). Both are counted.',
        duplicate.names.join(' · '),
        money(duplicate.amount),
      ),
      act: [$t('Open income and bills'), () => App.go('recurring')],
    });
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
        'The plan keeps {0} a month ({1}% of income). If your account isn’t growing like that, spending is missing.',
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
        text:
          b.every === 1
            ? $t('“{0}” ends after {1}, freeing {2} a month.', b.name, M.label(M.parse(b.to)), money(b.amount))
            : $t('“{0}” ends after {1}, freeing {2}.', b.name, M.label(M.parse(b.to)), money(b.amount)),
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
      tone: coverTone(cover),
      text: $t('Safety net: {0} months of spending (aim for 3–6).', fmtNum(Math.round(cover * 10) / 10)),
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
  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}
/** Most urgent first: problems, then warnings, then tips, then good news. */
const TONE_RANK = { bad: 0, warn: 1, info: 2, good: 3 };
/** How many insights the Overview shows before "Show more". */
const INSIGHTS_SHOWN = 3;
/** Under one month of spending in reserve is worth a warning; three or more is good. */
function coverTone(months) {
  if (months >= 3) {
    return 'good';
  }
  if (months >= 1) {
    return 'info';
  }
  return 'warn';
}
/** The button of one insight: its own action, or "Open {month}" when it points at a month. */
function insightAction(insight) {
  if (insight.act) {
    return btn(insight.act[0], insight.act[1], 'sm');
  }
  if (insight.k != null) {
    return btn($t('Open {0}', M.label(insight.k)), () => App.go('months', { month: insight.k }), 'sm');
  }
  return null;
}
/** The insights card: the three most urgent, the rest one click away. */
function insightsCard() {
  const all = insights();
  const shown = UI.insightsAll ? all : all.slice(0, INSIGHTS_SHOWN);
  const notes = shown.map(insight =>
    h(
      'div',
      { class: 'note ' + insight.tone },
      icon(insight.tone === 'good' ? 'check' : insight.tone === 'info' ? 'info' : 'alert'),
      h('div', { class: 'grow', text: insight.text }),
      insightAction(insight),
    ),
  );
  let more = null;
  if (all.length > INSIGHTS_SHOWN) {
    const label = UI.insightsAll ? $t('Show fewer') : $t('Show {0} more', all.length - INSIGHTS_SHOWN);
    more = btn(
      label,
      () => {
        UI.insightsAll = !UI.insightsAll;
        App.render();
      },
      'ghost sm',
    );
  }
  return card($t('Insights'), null, more, h('div', { class: 'notes' }, notes));
}
/** Pending "Can I afford this?" recalculation: typing waits 120 ms so a 6-digit amount runs one projection, not six. */
let affordTimer = 0;
/** "Safe to spend" in a month: the room above the cushion that no later month goes below. */
function roomText(room, k, lowestK, cushion) {
  if (room > 0) {
    if (cushion) {
      return $t(
        'Safe to spend in {0}: {1}, without any later month going under your cushion.',
        M.label(k, true),
        money(Math.floor(room)),
      );
    }
    return $t(
      'Safe to spend in {0}: {1}, without any later month going below zero.',
      M.label(k, true),
      money(Math.floor(room)),
    );
  }
  if (cushion) {
    return $t(
      'Nothing safe to spend in {0}. {1} would go under your cushion.',
      M.label(k, true),
      M.label(lowestK, true),
    );
  }
  return $t('Nothing safe to spend in {0}. {1} would go below zero.', M.label(k, true), M.label(lowestK, true));
}
function affordCard() {
  const projection = Store.proj;
  const summary = projection.summary;
  const a = UI.afford;
  const res = h('div', { class: 'notes', style: 'margin-top:10px' });
  const upd = () => {
    const k = clamp(M.parse(a.month) === null ? curK() : M.parse(a.month), summary.s0, summary.s0 + summary.n - 1);
    // Store.proj is the plan as it is today (same options as a fresh projection without extras): reuse it.
    const base = projection;
    const cush = Store.plan.settings.cushion;
    const later = base.months.filter(m => m.k >= k);
    const lowest = later.reduce((low, m) => (m.close < low.close ? m : low), later[0]);
    const room = lowest.close - cush;
    const safe = h(
      'div',
      { class: 'note info' },
      icon('info'),
      h('div', { class: 'grow', text: roomText(room, k, lowest.k, cush) }),
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
          clearTimeout(affordTimer);
          affordTimer = setTimeout(() => {
            if (res.isConnected) {
              upd();
            }
          }, 120);
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

/** The month-end figure's name: with a payday the month ends the day before the next salary. */
const monthEndLabel = settings => (settings.payDay ? $t('Left by payday') : $t('Month-end balance'));
/** "Right now": where you are in the current budget month. Recomputed from today's date every time the page is drawn. */
function nowCard() {
  const settings = Store.plan.settings;
  const currentMonth = curK();
  const m = monthAt(currentMonth);
  const today = Store.day;
  const len = m.end - m.start + 1;
  const inside = today >= m.start && today <= m.end;
  const budgets = m.entries.filter(e => e.budget);
  const position = monthPosition(m, today);
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
    monthEquation(position, {
      endLabel: monthEndLabel(settings),
      endClass: m.close < 0 ? 'bad' : 'good',
      status: balanceChip(m),
      perDayText:
        position.budgetsLeft > 0 && position.daysLeft
          ? $t('{0}/day for {1}', money(position.perDay), plural(position.daysLeft, 'day'))
          : null,
    }),
    h('p', { class: 'small muted', text: $t('Month surplus: {0}', signed(m.net)) }),
    h(
      'div',
      { class: 'acts' },
      btn($t('Add transaction'), () => logPurchase(m), 'primary sm', 'plus'),
      budgets.length ? btn($t('Log a spend'), () => logSpend(lastBudget(budgets).id, m), 'sm', 'plus') : null,
      btn($t('Update balances'), balancesModal, 'sm', 'edit'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn sm',
          'aria-haspopup': 'menu',
          onclick: event =>
            ctxMenu(event, [
              [$t('Trip or event'), () => tripModal(null, { month: M.key(currentMonth) })],
              [$t('Recurring bill'), () => recModal('bills')],
              [$t('Savings goal'), () => goalModal()],
            ]),
        },
        icon('plus'),
        $t('More'),
      ),
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
    null,
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

/**
 * First month, from `fromK` on, in which nothing is owed any more (loans and credit cards), or null.
 * summary.debtFree only follows loans, so a card balance could read "All paid off" while money is still owed.
 */
function debtFreeFrom(projection, fromK) {
  const first = projection.months.find(month => month.k >= fromK && month.debt <= 0.005);
  return first ? first.k : null;
}
/** Under the Debt figure: when it is paid off, or that it is not paid off within the plan. */
function debtText(debtNow, debtFreeK) {
  if (debtNow <= 0.005) {
    return $t('All paid off');
  }
  if (debtFreeK === null) {
    return $t('Not paid off within this plan');
  }
  return $t('Debt-free in {0}', M.label(debtFreeK));
}
/**
 * "Safe to spend now": the room above the cushion that no month from now on goes below, so spending it today
 * breaks nothing later (the same rule as "Can I afford this?" and the Wishlist).
 */
function safeToSpend(projection, fromK, cushion) {
  const later = projection.months.filter(month => month.k >= fromK);
  const lowest = later.reduce((low, month) => (month.close < low.close ? month : low), later[0]);
  const amount = Math.max(0, Math.floor(lowest.close - cushion));
  if (amount > 0) {
    return { amount, text: cushion ? $t('keeps every month above your cushion') : $t('keeps every month above zero') };
  }
  return {
    amount,
    text: cushion
      ? $t('{0} already goes under your cushion', M.label(lowest.k, true))
      : $t('{0} already goes below zero', M.label(lowest.k, true)),
  };
}
/** This page offers Design mode (see components/designPages.js). */
const DESIGN = designable('overview', $t('Overview'));
/** "Build your plan": the three setup steps, each ticked once it is done. */
function setupCard(plan) {
  const steps = [
    {
      done: plan.incomes.length > 0,
      title: $t('1. Add your income'),
      desc: $t('Salary and anything else that comes in regularly.'),
      view: 'recurring',
    },
    {
      done: plan.accounts.length > 0 || plan.settings.opening !== 0,
      title: $t('2. Add your balances'),
      desc: $t('What is in your accounts and wallet today.'),
      view: 'accounts',
    },
    {
      done: plan.bills.length > 0,
      title: $t('3. Add your bills and living costs'),
      desc: $t('Rent, groceries, phone, subscriptions.'),
      view: 'recurring',
    },
  ];
  return card(
    $t('Build your plan'),
    $t('Three quick steps. Every number on this page updates as you go.'),
    null,
    h(
      'div',
      { class: 'rows' },
      steps.map(step =>
        row({
          title: step.title,
          desc: step.desc,
          cls: step.done ? 'done' : '',
          chips: step.done ? chip($t('done'), 'good') : null,
          right: icon('right'),
          onclick: () => App.go(step.view),
        }),
      ),
    ),
  );
}
/**
 * The calendar card of the Overview (audit 6.6): the mini month, what is ahead (income, bills, planned one-offs,
 * loans and trips by default; Settings › Calendar can change the groups), and one line about the next 7 days.
 * A day opens a short summary; "Open the month" in its menu goes to the planner. Null when it is switched off.
 */
function overviewCalendar() {
  const prefs = Store.db.calendar;
  if (!prefs.overview) {
    return null;
  }
  const next = nextDays(Store.proj.months, Store.day);
  return card(
    $t('Calendar'),
    nextDaysText(next),
    null,
    calendar({
      ...planCalendar({ only: prefs.overviewGroups, figure: null, openPlanner: true, ahead: true }),
      id: 'overview',
      mode: 'mini',
      // dots only: the legend of the planner calendar would be bigger than the month itself
      legend: false,
      // below the fold on most screens: the first time, the top of the Overview is painted before it is drawn
      defer: true,
      label: $t('Calendar'),
      monthList: false,
    }),
  );
}
/** "Next 7 days: 4 payments · 610 € · lowest 54 € on Mon 30 Nov" (or that nothing is due). */
function nextDaysText(next) {
  const lowest = next.lowest
    ? $t('lowest {0} on {1}', money(next.lowest.balance), D.label(next.lowest.day, { weekday: 'short' }))
    : '';
  if (!next.payments) {
    return lowest ? $t('Next 7 days: nothing due · {0}', lowest) : $t('Next 7 days: nothing due');
  }
  return $t('Next 7 days: {0} · {1} · {2}', plural(next.payments, 'payment'), money(next.out), lowest);
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
  const debtFreeK = debtFreeFrom(projection, currentMonth);
  const lowCls = summary.min < 0 ? 'bad' : summary.min < plan.settings.cushion ? 'warn' : '';
  const safe = safeToSpend(projection, currentMonth, plan.settings.cushion);
  /** One card of the page grid (Design mode can move and resize it). Most cards are a third of the width. */
  const titled = (id, title, el, size) => ({ id, title, el, w: 4, minW: 3, ...size });
  // four numbers, the most useful first: what you can spend safely, where this month ends, the low point, debt.
  // Each is its own small card, so it can be placed anywhere.
  const kpis = [
    ['kpi-safe', $t('Safe to spend now'), money(safe.amount), safe.text, safe.amount > 0 ? 'good' : 'bad'],
    [
      'kpi-end',
      monthEndLabel(plan.settings),
      money(m.close),
      $t('{0} this month', signed(m.net)),
      m.close < 0 ? 'bad' : '',
    ],
    ['kpi-low', $t('Lowest point'), money(summary.min), M.label(summary.minK, true), lowCls],
    m.debt > 0 || summary.debtFree !== null
      ? ['kpi-debt', $t('Debt'), money(m.debt), debtText(m.debt, debtFreeK)]
      : [
          'kpi-debt',
          $t('Net worth, {0}', M.label(last.k)),
          money(last.worth),
          $t('{0} at end of {1}', money(m.worth), M.label(currentMonth)),
        ],
  ].map(([id, label, ...rest]) => titled(id, label, kpi(label, ...rest), { w: 3, minW: 2 }));
  const noData = !plan.bills.length && !plan.items.length && !plan.trips.length;
  // until income exists every number here is empty or misleading, so the page is only the checklist
  const noIncome = !plan.incomes.length;
  const starter = noData || noIncome ? setupCard(plan) : null;
  if (noIncome) {
    return designPage(DESIGN, $t('Overview'), plan.name, null, [
      { id: 'starter', title: $t('Build your plan'), el: starter, w: 12 },
    ]);
  }
  // next things to pay: dated first (by day), then the ones without a fixed day
  const dueList = () => {
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
    return due;
  };
  const soonList = () => {
    const soon = [];
    for (let k = currentMonth + 1; k < Math.min(currentMonth + 5, summary.s0 + summary.n); k++) {
      for (const e of monthAt(k).entries) {
        if (e.group === 'item' || e.group === 'trip') {
          soon.push([k, e]);
        }
      }
    }
    return soon;
  };
  const catList = () => {
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
    return { catRows, catMax: catRows.length ? catRows[0][1] : 1, catTotal };
  };
  const budgets = m.entries.filter(e => e.budget);
  const i0 = currentMonth - summary.s0;
  const goalsLoansList = () => [
    ...plan.goals.map(G => {
      const now = projection.goals[G.id].series[i0];
      return prow(
        G.name,
        G.target ? $t('{0} of {1}', money(now), money(G.target)) : money(now),
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
  /**
   * A card below the first screen: on the first drawing of the Overview in this visit it is built just after the page
   * is painted (designGrid, lazy), keeping `reserve` px meanwhile; later drawings build it at once.
   */
  const later = (id, title, build, size) => titled(id, title, build, { lazy: true, ...size });
  const chartTitle = $t('Where your money is heading');
  // The cards of the page, in their usual order. Design mode lets the person move them and change their size.
  // A card that is null has nothing to show right now: its place stays free.
  return designPage(
    DESIGN,
    $t('Overview'),
    $t(
      '{0} · {1} to {2} · updated for {3}',
      plan.name,
      M.label(summary.s0),
      M.label(summary.endK),
      D.label(today, { weekday: 'long', year: 'numeric' }),
    ),
    null,
    [
      ...kpis,
      titled('starter', $t('Build your plan'), starter, { w: 12 }),
      titled('now', M.label(currentMonth, true), nowCard(), { w: 8, minW: 4 }),
      // beside "now" on wide screens: its place keeps the height of that row, so nothing visible moves
      later('insights', $t('Insights'), () => insightsCard(), { cls: 'ov-side', reserve: 430 }),
      later('chart', chartTitle, () => card(chartTitle, null, null, cashChart()), { w: 12, minW: 4, reserve: 365 }),
      titled('calendar', $t('Calendar'), overviewCalendar(), { w: 4, minW: 3 }),
      later('due', $t('Next to pay'), () => {
        const due = dueList();
        return card(
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
                      (e.date === null ? $t('No fixed day · {0}', M.label(k)) : D.label(e.date, { weekday: 'short' })) +
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
        );
      }),
      later('budgets', $t('Budgets this month'), () =>
        budgets.length
          ? card(
              $t('Budgets this month'),
              $t('What you have spent from each budget so far.'),
              btn($t('Log a spend'), () => logSpend(lastBudget(budgets).id, m), 'sm', 'plus'),
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
      ),
      later('surplus', $t('Monthly surplus'), () =>
        card(
          $t('Monthly surplus'),
          $t('In minus out.'),
          null,
          netBars(),
          h(
            'div',
            { class: 'legend static' },
            h('span', null, h('i', { style: 'background:var(--s-cash)' }), $t('Surplus')),
            h('span', null, h('i', { style: 'background:var(--bad)' }), $t('Spent more than came in')),
          ),
        ),
      ),
      later('review', $t('How {0} is going', M.label(currentMonth, true)), () => monthReviewCard()),
      later('afford', $t('Can I afford this?'), () => affordCard()),
      later('soon', $t('Coming up later'), () => {
        const soon = soonList();
        return soon.length
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
          : null;
      }),
      later('goals', $t('Savings and debt'), () => {
        const goalsLoans = goalsLoansList();
        return goalsLoans.length
          ? card($t('Savings and debt'), $t('Progress as of this month.'), null, goalsLoans)
          : null;
      }),
      later('cats', $t('Where it goes'), () => {
        const { catRows, catMax, catTotal } = catList();
        return catRows.length
          ? card(
              $t('Where it goes'),
              $t('Next 12 months, by category.'),
              null,
              catRows.slice(0, 8).map(([c, v]) =>
                h(
                  'div',
                  { class: 'catrow' },
                  h('span', { text: CAT_NAME[c] || $t('Other') }),
                  h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(2, (v / catMax) * 100)}%` })),
                  h('span', {
                    class: 'num muted',
                    text: $t('{0} · {1}%', money(v), Math.round((v / catTotal) * 100)),
                  }),
                ),
              ),
            )
          : null;
      }),
    ],
  );
};
