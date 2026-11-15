/**
 * @file Forecast page: every month of the plan as a table, monthly or yearly.
 */
import { M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { IO } from '../../services/backup.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { card, page, segc } from '../components/layout.js';
import { h } from '../dom.js';
import { UI, nowK } from '../state.js';
import { V } from './registry.js';

V.forecast = () => {
  const projection = Store.proj;
  const now = nowK();
  const z = v => (Math.round(v * 100) ? signed(v) : '–');
  const yearly = UI.fview === 'year';
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
  const body = rowsData.map(m =>
    h(
      'tr',
      {
        class: 'click ' + (m.status === 'ok' ? '' : m.status) + (m.cur ? ' sel' : ''),
        tabindex: 0,
        onclick: () => App.go('months', { month: m.k }),
        onkeydown: e => {
          if (e.key === 'Enter') {
            App.go('months', { month: m.k });
          }
        },
      },
      h('td', { text: m.label }),
      G.map(g => h('td', { text: z(m.g[g]) })),
      h('td', { class: m.net < 0 ? 'bad' : '', text: signed(m.net) }),
      h('td', null, h('b', { class: m.close < 0 ? 'bad' : '', text: money(m.close) })),
      h('td', { text: m.savings ? money(m.savings) : '–' }),
      h('td', { text: m.debt ? money(m.debt) : '–' }),
      h('td', { text: money(m.worth) }),
    ),
  );
  const tot = G.map(g => projection.months.reduce((a, m) => a + m.g[g], 0));
  return page(
    $t('Forecast'),
    $t(
      'Every month in one table. Red rows end below zero, amber rows end under your cushion. Click a row to open that month.',
    ),
    [
      segc(
        [
          ['month', $t('By month')],
          ['year', $t('By year')],
        ],
        UI.fview,
        v => {
          UI.fview = v;
          App.render();
        },
      ),
      btn(
        $t('Download CSV'),
        () => IO.download(`runway-forecast-${M.key(now)}.csv`, IO.csv(projection), 'text/csv'),
        '',
        'download',
      ),
    ],
    card(
      null,
      null,
      null,
      h(
        'div',
        { class: 'tblw', style: 'max-height:72vh' },
        h(
          'table',
          null,
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              heads.map(t => h('th', { text: t })),
            ),
          ),
          h('tbody', null, body),
          h(
            'tfoot',
            null,
            h(
              'tr',
              { style: 'font-weight:700' },
              h('td', { text: $t('Whole plan') }),
              tot.map(v => h('td', { text: z(v) })),
              h('td', { text: signed(projection.summary.net) }),
              h('td', { text: money(projection.summary.end) }),
              h('td'),
              h('td'),
              h('td'),
            ),
          ),
        ),
      ),
    ),
  );
};
