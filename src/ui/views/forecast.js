/**
 * @file Forecast page: the plan month by month or year by year, and scenarios that look ahead more carefully.
 */
import { M } from '../../core/dates.js';
import { compact, money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { forecastRange, forecastScenario } from '../../logic/forecast.js';
import { IO } from '../../services/backup.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { dataTable } from '../components/dataTable.js';
import { info } from '../components/info.js';
import { card, page, segc } from '../components/layout.js';
import { h } from '../dom.js';
import { UI, nowK } from '../state.js';
import { V } from './registry.js';

/** The plan table: every month (or year) with what each part of the plan adds or takes. */
function planTable(projection, now, yearly) {
  const z = v => (Math.round(v * 100) ? signed(v) : '–');
  const G = ['inc', 'bill', 'item', 'trip', 'loan', 'wish', 'goal'];
  const heads = [
    yearly ? $t('Year') : $t('Month'),
    $t('Income'),
    $t('Bills'),
    $t('One-offs'),
    $t('Trips'),
    $t('Loans'),
    $t('Wishlist'),
    $t('Savings'),
    $t('Left over'),
    $t('Cash at end'),
    $t('Saved'),
    $t('Debt'),
    $t('Net worth'),
  ];
  let rowsData = projection.months.map(m => ({
    label: M.label(m.k),
    k: m.k,
    g: m.g,
    net: m.net,
    close: m.close,
    savings: m.savings,
    debt: m.debt,
    worth: m.worth,
    status: m.status,
    cur: m.k === now,
  }));
  if (yearly) {
    const by = new Map();
    for (const m of projection.months) {
      const y = Math.floor(m.k / 12);
      const r = by.get(y) || {
        label: String(y),
        k: m.k,
        g: { inc: 0, bill: 0, item: 0, trip: 0, loan: 0, wish: 0, goal: 0 },
        net: 0,
        status: 'ok',
        n: 0,
      };
      G.forEach(g => {
        r.g[g] += m.g[g];
      });
      r.net += m.net;
      r.n++;
      r.close = m.close;
      r.savings = m.savings;
      r.debt = m.debt;
      r.worth = m.worth;
      if (m.status === 'neg' || (m.status === 'tight' && r.status === 'ok')) {
        r.status = m.status;
      }
      by.set(y, r);
    }
    rowsData = [...by.values()].map(r => ({
      ...r,
      label: r.n < 12 ? `${r.label} (${plural(r.n, 'month')})` : r.label,
    }));
  }
  const groupColumn = (group, position) => ({
    label: heads[position + 1],
    value: row => row.g[group],
    cell: row => z(row.g[group]),
  });
  const columns = [
    { label: heads[0], value: row => row.k, cell: row => row.label },
    ...G.map(groupColumn),
    {
      label: heads[8],
      value: row => row.net,
      cell: row => signed(row.net),
      cellProps: row => ({ class: row.net < 0 ? 'bad' : '' }),
    },
    {
      label: heads[9],
      value: row => row.close,
      cell: row => h('b', { class: row.close < 0 ? 'bad' : '', text: money(row.close) }),
    },
    { label: heads[10], value: row => row.savings, cell: row => (row.savings ? money(row.savings) : '–') },
    { label: heads[11], value: row => row.debt, cell: row => (row.debt ? money(row.debt) : '–') },
    { label: heads[12], value: row => row.worth, cell: row => money(row.worth) },
  ];
  const totals = G.map(group => projection.months.reduce((sum, month) => sum + month.g[group], 0));
  const last = projection.months[projection.months.length - 1];
  return dataTable({
    id: yearly ? 'forecast-year' : 'forecast-month',
    rows: rowsData,
    columns,
    maxHeight: '72vh',
    rowProps: row => ({
      class: 'click ' + (row.status === 'ok' ? '' : row.status) + (row.cur ? ' sel' : ''),
      tabindex: 0,
      onclick: () => App.go('months', { month: row.k }),
      onkeydown: event => {
        if (event.key === 'Enter') {
          App.go('months', { month: row.k });
        }
      },
    }),
    foot: [
      h('td', { text: $t('Whole plan') }),
      ...totals.map(total => h('td', { text: z(total) })),
      h('td', { text: signed(projection.summary.net) }),
      h('td', { text: money(last.close) }),
      h('td', { text: money(last.savings) }),
      h('td', { text: money(last.debt) }),
      h('td', { text: money(last.worth) }),
    ],
  });
}

/** A scenario next to the plan: what each month leaves and where the cash ends, both ways. */
function scenarioTable(result, now) {
  const columns = [
    { label: $t('Month'), value: row => row.k, cell: row => M.label(row.k) },
    { label: $t('Plan leaves'), value: row => row.planLeft, cell: row => signed(row.planLeft) },
    {
      label: $t('Scenario leaves'),
      value: row => row.left,
      cell: row => signed(row.left),
      cellProps: row => ({ class: row.left < 0 ? 'bad' : '' }),
    },
    { label: $t('Cash at end, plan'), value: row => row.planClose, cell: row => money(row.planClose) },
    {
      label: $t('Cash at end, scenario'),
      value: row => row.close,
      cell: row => h('b', { class: row.close < 0 ? 'bad' : '', text: money(row.close) }),
    },
    {
      label: $t('Difference'),
      value: row => row.close - row.planClose,
      cell: row => (Math.round((row.close - row.planClose) * 100) ? signed(row.close - row.planClose) : '–'),
    },
  ];
  return dataTable({
    id: 'forecast-scenario',
    rows: result.rows,
    columns,
    maxHeight: '72vh',
    rowProps: row => ({
      class: 'click ' + (row.close < 0 ? 'neg' : '') + (row.k === now ? ' sel' : ''),
      tabindex: 0,
      onclick: () => App.go('months', { month: row.k }),
    }),
  });
}

/** The range of outcomes: for every month the plan, a low (1 in 10 worse), the middle and a high (1 in 10 better). */
function rangeTable(range, now) {
  return dataTable({
    id: 'forecast-range',
    rows: range.rows,
    maxHeight: '72vh',
    rowProps: row => ({
      class: 'click ' + (row.low < 0 ? 'tight' : '') + (row.k === now ? ' sel' : ''),
      tabindex: 0,
      onclick: () => App.go('months', { month: row.k }),
    }),
    columns: [
      { label: $t('Month'), value: row => row.k, cell: row => M.label(row.k) },
      { label: $t('Cash at end, plan'), value: row => row.planClose, cell: row => money(row.planClose) },
      {
        label: $t('Low (1 in 10 worse)'),
        value: row => row.low,
        cell: row => money(row.low),
        cellProps: row => ({ class: row.low < 0 ? 'bad' : '' }),
      },
      {
        label: $t('Middle'),
        value: row => row.middle,
        cell: row => h('b', { class: row.middle < 0 ? 'bad' : '', text: money(row.middle) }),
      },
      { label: $t('High (1 in 10 better)'), value: row => row.high, cell: row => money(row.high) },
    ],
  });
}

/** A small whole-number input for the scenario settings. */
function numberInput(label, value, min, max, onChange) {
  const input = h('input', {
    class: 'inp sm',
    type: 'number',
    min,
    max,
    value,
    style: 'width:76px',
    'aria-label': label,
  });
  input.addEventListener('change', () => {
    const number = Math.round(Number(input.value));
    if (Number.isFinite(number)) {
      onChange(Math.min(max, Math.max(min, number)));
    }
  });
  return h('label', { class: 'frow' }, h('span', { text: label }), input);
}

/** The ways of looking ahead. They are the sub-sections of Forecast in the menu (see SUBS in ui/app.js). */
export const FTABS = [
  ['plan', $t('As planned')],
  ['variance', $t('Your real overspend')],
  ['pace', $t('Like the next months')],
  ['smooth', $t('Weighted pace')],
  ['trend', $t('Follow the trend')],
  ['cautious', $t('Costs run higher')],
  ['income', $t('Income drops')],
  ['range', $t('Range of outcomes')],
];
const forecastName = type => (FTABS.find(tab => tab[0] === type) || FTABS[0])[1];

/** Runs one forecast with the settings chosen on the Forecast page. Shared with the month planner overlay. */
function runForecast(type) {
  const projection = Store.proj;
  const settings = UI.forecast;
  const currentPosition = Math.min(projection.months.length - 1, Math.max(0, nowK() - projection.summary.s0));
  if (type === 'range') {
    return { range: forecastRange(projection, currentPosition, { sampleMonths: settings.sampleMonths }) };
  }
  const percent = type === 'income' ? settings.incomePercent : settings.percent;
  const scenario = { type, sampleMonths: settings.sampleMonths, percent, alpha: settings.alphaPercent / 100 };
  return { result: forecastScenario(projection, currentPosition, scenario) };
}

/**
 * The inputs one forecast really uses (months to learn from, weight, percentages), as form rows.
 * Shared by the Forecast page and the banner in the month planner, so the values can be changed in either place.
 * @param {string} type A forecast type from FTABS.
 * @param {(change: object) => void} apply Called with the changed setting; the caller saves it and redraws.
 */
export function forecastInputs(type, apply) {
  const settings = UI.forecast;
  return [
    ['pace', 'smooth', 'trend', 'range'].includes(type)
      ? numberInput($t('Months to learn from'), settings.sampleMonths, 1, 24, sampleMonths => apply({ sampleMonths }))
      : null,
    type === 'smooth'
      ? numberInput($t('Weight of the latest month %'), settings.alphaPercent, 10, 90, alphaPercent =>
          apply({ alphaPercent }),
        )
      : null,
    type === 'cautious'
      ? numberInput($t('Costs higher by %'), settings.percent, 1, 100, percent => apply({ percent }))
      : null,
    type === 'income'
      ? numberInput($t('Income lower by %'), settings.incomePercent, 1, 100, incomePercent => apply({ incomePercent }))
      : null,
  ].filter(Boolean);
}

/**
 * Where every month would end under one forecast, for showing it in the month planner.
 * The plan itself is never changed: this is only another way to look at it.
 * @returns {?{name: string, closes: Map<number, number>}} null for "as planned".
 */
export function forecastCloses(type) {
  if (!type || type === 'plan' || !FTABS.some(tab => tab[0] === type)) {
    return null;
  }
  const { result, range } = runForecast(type);
  const rows = range ? range.rows.map(row => [row.k, row.middle]) : result.rows.map(row => [row.k, row.close]);
  return { name: forecastName(type), closes: new Map(rows) };
}

V.forecast = () => {
  const projection = Store.proj;
  const now = nowK();
  const settings = UI.forecast;
  const type = FTABS.some(tab => tab[0] === UI.ftab) ? UI.ftab : 'plan';
  const yearly = UI.fview === 'year';
  const setForecast = change => {
    Object.assign(UI.forecast, change);
    App.render();
  };

  const isRange = type === 'range';
  const isScenario = type !== 'plan' && !isRange;
  const { result, range } = type === 'plan' ? {} : runForecast(type);
  const lastRow = result ? result.rows[result.rows.length - 1] : null;
  const lastRange = range ? range.rows[range.rows.length - 1] : null;
  const sampleText = plural(settings.sampleMonths, 'month');

  // each way of looking ahead in one plain sentence; the method and the maths sit behind the "i"
  let explanation = null;
  let method = null;
  if (type === 'pace') {
    explanation = $t(
      'No later month leaves more than the next {0} do on average ({1}).',
      sampleText,
      money(result.average),
    );
    method = $t(
      'A plan only lists the costs you already know, so later months look better than they will be. Here the next {0} are taken as planned, and no later month is allowed to leave more than their average. Method: simple average.',
      sampleText,
    );
  } else if (type === 'smooth') {
    explanation = $t('Like the next months, but the latest count more. Level: {0} a month.', money(result.average));
    method = $t(
      'The latest of the next {0} count more than the earlier ones, so a recent change shows up sooner. A higher weight follows the latest month more closely. Method: simple exponential smoothing.',
      sampleText,
    );
  } else if (type === 'trend') {
    explanation = $t('Continues where the next {0} are heading, with the slope fading out.', sampleText);
    method = $t(
      'If each month leaves less than the one before, later months continue that slide, with the slope fading out so it does not run away. No month does better than the plan. Method: damped trend (Holt, Gardner and McKenzie), with fixed settings because a few months are too little to fit them.',
    );
  } else if (type === 'cautious') {
    explanation = $t('What if everything costs {0}% more from this month on?', settings.percent);
    method = $t('Method: stress test.');
  } else if (type === 'income') {
    explanation = $t('What if {0}% less comes in from this month on?', settings.incomePercent);
    method = $t('Method: stress test.');
  } else if (type === 'variance') {
    if (result.overrun === null) {
      explanation = $t('Needs one balance update first. Until then it equals the plan.');
    } else {
      explanation = $t(
        'You spent {0}% more than planned. The same overrun is applied to every cost still to come.',
        Math.round(result.overrun * 100),
      );
    }
    method = $t(
      'Measured when you updated your balances: what you really spent against the planned costs paid by then. The only forecast here based on what really happened. Method: budget variance (cost performance index).',
    );
  } else if (isRange) {
    explanation = $t('Your plan run 2,000 times with realistic ups and downs. Low and High are 1-in-10 outcomes.');
    method = $t(
      'In each run every later month is pushed up or down by as much as one of your next {0} differs from their average ({1}). “Low” is the result that only 1 run in 10 falls below, “High” the one only 1 in 10 beats. Method: Monte Carlo simulation with bootstrapped shocks.',
      sampleText,
      money(range.average),
    );
  }
  // the plain table explains its colours with a legend instead of a sentence
  const intro =
    type === 'plan'
      ? h(
          'div',
          { class: 'legend static', style: 'margin-bottom:10px' },
          h('span', null, h('i', { style: 'background:var(--bad)' }), $t('Below zero')),
          h('span', null, h('i', { style: 'background:var(--warn)' }), $t('Under cushion')),
        )
      : h('p', { class: 'small muted', style: 'margin-bottom:10px' }, explanation, ' ', method ? info(method) : null);

  const download = () => {
    if (isRange) {
      const rows = [
        [$t('Month'), $t('Cash at end, plan'), $t('Low (1 in 10 worse)'), $t('Middle'), $t('High (1 in 10 better)')],
        ...range.rows.map(row => [
          row.key,
          row.planClose.toFixed(2),
          row.low.toFixed(2),
          row.middle.toFixed(2),
          row.high.toFixed(2),
        ]),
      ];
      IO.download(`runway-forecast-range-${M.key(now)}.csv`, IO.csvText(rows), 'text/csv');
      return;
    }
    if (!isScenario) {
      IO.download(`runway-forecast-${M.key(now)}.csv`, IO.csv(projection), 'text/csv');
      return;
    }
    const rows = [
      [$t('Month'), $t('Plan leaves'), $t('Scenario leaves'), $t('Cash at end, plan'), $t('Cash at end, scenario')],
      ...result.rows.map(row => [
        row.key,
        row.planLeft.toFixed(2),
        row.left.toFixed(2),
        row.planClose.toFixed(2),
        row.close.toFixed(2),
      ]),
    ];
    IO.download(`runway-forecast-${type}-${M.key(now)}.csv`, IO.csvText(rows), 'text/csv');
  };

  const flowBox = (label, value, className) =>
    h('div', null, h('div', { class: 'l', text: label }), h('div', { class: 'v ' + (className || ''), text: value }));

  // "Show in the month planner" only changes what the planner displays; "Back to the plan" there undoes it
  const showInPlanner = () => {
    UI.overlay = type;
    App.go('months');
  };

  const controls = [
    type === 'plan'
      ? segc(
          [
            ['month', $t('By month')],
            ['year', $t('By year')],
          ],
          UI.fview,
          view => {
            UI.fview = view;
            App.render();
          },
        )
      : null,
    ...forecastInputs(type, setForecast),
  ].filter(Boolean);

  return page(
    $t('Forecast: {0}', forecastName(type)),
    $t('Where your money is heading. Pick another way of looking ahead in the menu.'),
    [
      type !== 'plan' ? btn($t('Show in the month planner'), showInPlanner, '', 'calendar') : null,
      btn($t('Export CSV'), download, '', 'download'),
    ],
    card(
      null,
      null,
      null,
      controls.length ? h('div', { class: 'acts', style: 'margin-bottom:10px' }, controls) : null,
      intro,
      isScenario
        ? h(
            'div',
            { class: 'flow' },
            flowBox($t('End of the plan, as planned'), money(lastRow.planClose)),
            flowBox($t('End of the plan, this forecast'), money(lastRow.close), lastRow.close < 0 ? 'bad' : ''),
            flowBox($t('Difference'), signed(lastRow.close - lastRow.planClose)),
          )
        : null,
      isRange
        ? h(
            'div',
            { class: 'flow' },
            flowBox($t('End of the plan, as planned'), money(lastRange.planClose)),
            flowBox(
              $t('Low · middle · high'),
              `${compact(lastRange.low)} · ${compact(lastRange.middle)} · ${compact(lastRange.high)}`,
            ),
            flowBox(
              $t('Chance of going below zero after the next {0}', sampleText),
              Math.round(range.chanceBelowZero * 100) + '%',
              range.chanceBelowZero >= 0.5 ? 'bad' : range.chanceBelowZero >= 0.1 ? 'warn' : 'good',
            ),
          )
        : null,
      isRange ? rangeTable(range, now) : isScenario ? scenarioTable(result, now) : planTable(projection, now, yearly),
    ),
  );
};
