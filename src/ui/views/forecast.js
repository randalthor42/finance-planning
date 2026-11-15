/**
 * @file Forecast page: the plan month by month or year by year, and scenarios that look ahead more carefully.
 */
import { M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { forecastScenario } from '../../logic/forecast.js';
import { IO } from '../../services/backup.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { dataTable } from '../components/dataTable.js';
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

V.forecast = () => {
  const projection = Store.proj;
  const now = nowK();
  const currentPosition = Math.min(projection.months.length - 1, Math.max(0, now - projection.summary.s0));
  const settings = UI.forecast;
  const yearly = UI.fview === 'year';
  const setForecast = change => {
    Object.assign(UI.forecast, change);
    App.render();
  };

  const isScenario = settings.type !== 'plan';
  const result = isScenario ? forecastScenario(projection, currentPosition, settings) : null;
  const lastRow = result ? result.rows[result.rows.length - 1] : null;

  let explanation = $t(
    'Every month in one table, exactly as planned. Red rows end below zero, amber rows end under your cushion. Click a row to open that month, click a column title to sort.',
  );
  if (settings.type === 'pace') {
    explanation = $t(
      'A plan only lists the costs you already know, so later months look better than they will be. Here the next {0} are taken as planned (they leave {1} a month on average), and no later month is allowed to leave more than that.',
      plural(settings.sampleMonths, 'month'),
      money(result.average),
    );
  } else if (settings.type === 'cautious') {
    explanation = $t('What if everything costs {0}% more than planned from this month on?', settings.percent);
  }

  const download = () => {
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
    IO.download(`runway-forecast-${settings.type}-${M.key(now)}.csv`, IO.csvText(rows), 'text/csv');
  };

  return page(
    $t('Forecast'),
    $t('Where your money is heading: as planned, or under a more careful assumption.'),
    [btn($t('Download for Excel (CSV)'), download, '', 'download')],
    card(
      null,
      null,
      null,
      h(
        'div',
        { class: 'acts', style: 'margin-bottom:10px' },
        segc(
          [
            ['plan', $t('As planned')],
            ['pace', $t('At my recent pace')],
            ['cautious', $t('Costs run higher')],
          ],
          settings.type,
          type => setForecast({ type }),
        ),
        settings.type === 'plan'
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
        settings.type === 'pace'
          ? numberInput($t('Months to learn from'), settings.sampleMonths, 1, 24, sampleMonths =>
              setForecast({ sampleMonths }),
            )
          : null,
        settings.type === 'cautious'
          ? numberInput($t('Costs higher by %'), settings.percent, 1, 100, percent => setForecast({ percent }))
          : null,
      ),
      h('p', { class: 'small muted', style: 'margin-bottom:10px', text: explanation }),
      isScenario
        ? h(
            'div',
            { class: 'flow' },
            h(
              'div',
              null,
              h('div', { class: 'l', text: $t('End of the plan, as planned') }),
              h('div', { class: 'v', text: money(lastRow.planClose) }),
            ),
            h(
              'div',
              null,
              h('div', { class: 'l', text: $t('End of the plan, this scenario') }),
              h('div', { class: 'v ' + (lastRow.close < 0 ? 'bad' : ''), text: money(lastRow.close) }),
            ),
            h(
              'div',
              null,
              h('div', { class: 'l', text: $t('Difference') }),
              h('div', { class: 'v', text: signed(lastRow.close - lastRow.planClose) }),
            ),
          )
        : null,
      isScenario ? scenarioTable(result, now) : planTable(projection, now, yearly),
    ),
  );
};
