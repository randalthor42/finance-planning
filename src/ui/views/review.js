/**
 * @file Review page: one month or one year looked at after the fact.
 */
import { D, M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { CAT_NAME } from '../../models/categories.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { amt, budgetText, card, chip, page, prow, row, segc } from '../components/layout.js';
import { monthField } from '../components/pickers.js';
import { h } from '../dom.js';
import { remove } from '../helpers.js';
import { itemModal, logPurchase } from '../modals/item.js';
import { UI, monthAt, rangeLabel, selK } from '../state.js';
import { V } from './registry.js';
import { budgetTone } from './trips.js';

/** Looking back (or ahead) at one month or one year: where the money went, budgets, and plan against reality. */
V.review = () => {
  const projection = Store.proj;
  const summary = projection.summary;
  const k = selK();
  const m = monthAt(k);
  const yearly = UI.rview === 'year';
  const kv = (l, v, className) =>
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'grow muted', text: l }),
      h('span', { class: 'amt ' + (className || ''), text: v }),
    );
  const kp = (l, v, className, sub) =>
    h(
      'div',
      { class: 'kpi' },
      h('div', { class: 'l', text: l }),
      h('div', { class: 'v ' + (className || ''), text: v }),
      sub ? h('div', { class: 's', text: sub }) : null,
    );
  const GN = {
    inc: $t('Income'),
    bill: $t('Bills and living costs'),
    item: $t('Purchases'),
    trip: $t('Trips and events'),
    loan: $t('Loans'),
    wish: $t('Wishlist'),
    goal: $t('Savings'),
  };
  const catBars = ms => {
    const c = {};
    let tot = 0;
    ms.forEach(x =>
      x.entries.forEach(e => {
        if (e.amount < 0 && e.group !== 'adjust') {
          c[e.cat] = (c[e.cat] || 0) - e.amount;
          tot -= e.amount;
        }
      }),
    );
    const r = Object.entries(c).sort((a, b) => b[1] - a[1]);
    return r.length
      ? r
          .slice(0, 9)
          .map(([cat, v]) =>
            h(
              'div',
              { class: 'catrow' },
              h('span', { text: CAT_NAME[cat] || $t('Other') }),
              h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(2, (v / r[0][1]) * 100)}%` })),
              h('span', { class: 'num muted', text: `${money(v)} · ${Math.round((v / tot) * 100)}%` }),
            ),
          )
      : h('p', { class: 'muted', text: $t('No spending.') });
  };
  const years = [...new Set(projection.months.map(x => Math.floor(x.k / 12)))];
  const acts = [
    segc(
      [
        ['month', $t('Month')],
        ['year', $t('Year')],
      ],
      UI.rview,
      v => {
        UI.rview = v;
        App.render();
      },
    ),
    yearly
      ? h(
          'select',
          {
            class: 'inp',
            style: 'width:auto',
            'aria-label': $t('Year to review'),
            onchange: e =>
              App.go('review', {
                month: clamp(+e.target.value * 12 + (k % 12), summary.s0, summary.s0 + summary.n - 1),
              }),
          },
          years.map(y => h('option', { value: y, text: y, selected: y === Math.floor(k / 12) })),
        )
      : h(
          'div',
          { style: 'width:190px' },
          monthField({ value: M.key(k), sm: true, onChange: v => App.go('review', { month: M.parse(v) }) }),
        ),
    ibtn($t('Earlier'), () => App.go('review', { month: Math.max(summary.s0, k - (yearly ? 12 : 1)) }), '', 'left'),
    ibtn(
      $t('Later'),
      () => App.go('review', { month: Math.min(summary.s0 + summary.n - 1, k + (yearly ? 12 : 1)) }),
      '',
      'right',
    ),
  ];
  // what the money in each budget actually went on, grouped by the name you logged (water, cat food, cigarettes…)
  const spendBreak = ms => {
    const g = new Map();
    ms.forEach(x =>
      x.entries.forEach(e => {
        if (e.of) {
          const key = e.sub.replace(/^From /, '') + ' · ' + e.label.trim().toLowerCase();
          const r = g.get(key) || { label: e.label.trim(), sub: e.sub, sum: 0, n: 0 };
          r.sum -= e.amount;
          r.n++;
          g.set(key, r);
        }
      }),
    );
    const rows = [...g.values()].sort((a, b) => b.sum - a.sum);
    return rows.length
      ? card(
          $t('What your budgets went on'),
          $t('Spends you logged, grouped by name.'),
          null,
          h(
            'div',
            { class: 'rows' },
            rows.slice(0, 12).map(r =>
              row({
                title: r.label,
                desc: `${r.sub} · ${r.n === 1 ? $t('once') : $t('{0} times', r.n)}`,
                right: amt(-r.sum),
              }),
            ),
          ),
        )
      : null;
  };
  if (yearly) {
    const y = Math.floor(k / 12);
    const ms = projection.months.filter(x => Math.floor(x.k / 12) === y);
    const inc = ms.reduce((a, x) => a + x.inc, 0);
    const out = ms.reduce((a, x) => a + x.out, 0);
    const saved = -ms.reduce((a, x) => a + Math.min(0, x.g.goal), 0);
    const best = ms.reduce((a, b) => (b.net > a.net ? b : a));
    const worst = ms.reduce((a, b) => (b.net < a.net ? b : a));
    const end = ms[ms.length - 1];
    return page(
      $t('Review of {0}', y),
      ms.length < 12
        ? $t(
            'Your plan covers {0} of {1}: {2} to {3}.',
            plural(ms.length, 'month'),
            y,
            M.label(ms[0].k),
            M.label(end.k),
          )
        : $t('The whole year at a glance.'),
      acts,
      h(
        'div',
        { class: 'kpis' },
        kp($t('Money in'), money(inc)),
        kp($t('Money out'), money(out)),
        kp(
          $t('Left over'),
          signed(inc - out),
          inc - out < 0 ? 'bad' : 'good',
          inc ? $t('{0}% of income', Math.round(((inc - out) / inc) * 100)) : '',
        ),
        kp($t('Put into savings'), money(saved)),
      ),
      h(
        'div',
        { class: 'cols' },
        h(
          'div',
          { class: 'stack' },
          card($t('Where it went'), $t('By category.'), null, catBars(ms)),
          spendBreak(ms),
          card(
            $t('By type'),
            null,
            null,
            h(
              'div',
              { class: 'rows' },
              Object.keys(GN).map(g => {
                const v = ms.reduce((a, x) => a + x.g[g], 0);
                return Math.round(v * 100) ? kv(GN[g], signed(v), v > 0 ? 'good' : '') : null;
              }),
            ),
          ),
        ),
        h(
          'div',
          { class: 'stack' },
          card(
            $t('Month by month'),
            $t('Click a month to open it.'),
            null,
            h(
              'div',
              { class: 'rows' },
              ms.map(x =>
                row({
                  title: M.label(x.k, true),
                  chips:
                    x.status === 'neg'
                      ? chip($t('below zero'), 'bad')
                      : x.status === 'tight'
                        ? chip($t('tight'), 'warn')
                        : null,
                  desc: $t('in {0} · out {1} · ends at {2}', money(x.inc), money(x.out), money(x.close)),
                  right: amt(x.net),
                  onclick: () => App.go('months', { month: x.k }),
                }),
              ),
            ),
          ),
          card(
            $t('Highlights'),
            null,
            null,
            h(
              'div',
              { class: 'rows' },
              kv($t('Best month'), `${M.label(best.k)} (${signed(best.net)})`),
              kv($t('Hardest month'), `${M.label(worst.k)} (${signed(worst.net)})`),
              kv($t('Months that end below zero'), String(ms.filter(x => x.status === 'neg').length)),
              kv($t('Cash at the end'), money(end.close)),
              kv($t('Debt at the end'), money(end.debt)),
              kv($t('Savings at the end'), money(end.savings)),
            ),
          ),
        ),
      ),
    );
  }
  const costs = m.entries
    .filter(e => e.amount < 0 && e.group !== 'adjust' && !e.budget)
    .sort((a, b) => a.amount - b.amount);
  const budgets = m.entries.filter(e => e.budget);
  const bought = m.entries.filter(e => e.key.startsWith('item:') && e.amount < 0);
  const over = Store.day > m.end;
  return page(
    $t('Review of {0}', M.label(k, true)),
    (Store.plan.settings.payDay ? rangeLabel(m) + ' · ' : '') +
      (over
        ? $t('This month is over.')
        : Store.day < m.start
          ? $t('This month has not started yet, so this is the plan.')
          : $t('This month is still running.')),
    acts,
    h(
      'div',
      { class: 'kpis' },
      kp($t('Money in'), money(m.inc)),
      kp($t('Money out'), money(m.out), '', $t('{0} against your average month', signed(m.out - summary.avgOut))),
      kp($t('Left over'), signed(m.net), m.net < 0 ? 'bad' : 'good'),
      kp(
        $t('Ends at'),
        money(m.close),
        m.close < 0 ? 'bad' : '',
        m.actual != null
          ? m.adjust
            ? $t(
                'real balance, {0} {1} than planned',
                money(Math.abs(m.adjust)),
                m.adjust > 0 ? $t('better') : $t('worse'),
              )
            : $t('real balance, exactly as planned')
          : $t('planned, no check-in yet'),
      ),
    ),
    h(
      'div',
      { class: 'cols' },
      h(
        'div',
        { class: 'stack' },
        card($t('Where it went'), $t('By category.'), null, catBars([m])),
        budgets.length
          ? card(
              $t('Budgets'),
              over ? $t('What you used. The rest went back into your cash.') : $t('So far.'),
              null,
              budgets.map(e =>
                prow(
                  e.label,
                  budgetText(e.budget),
                  e.budget.planned ? (e.budget.spent / e.budget.planned) * 100 : 100,
                  budgetTone(e.budget.spent, e.budget.planned),
                ),
              ),
            )
          : null,
        spendBreak([m]),
        card(
          $t('By type'),
          null,
          null,
          h(
            'div',
            { class: 'rows' },
            Object.keys(GN).map(g =>
              Math.round(m.g[g] * 100) ? kv(GN[g], signed(m.g[g]), m.g[g] > 0 ? 'good' : '') : null,
            ),
            kv($t('Ticked off as paid'), `${costs.filter(e => e.paid).length} of ${costs.length}`),
          ),
        ),
      ),
      h(
        'div',
        { class: 'stack' },
        card(
          $t('Biggest costs'),
          null,
          btn($t('Open month'), () => App.go('months', { month: k }), 'sm'),
          costs.length
            ? h(
                'div',
                { class: 'rows' },
                costs.slice(0, 8).map(e =>
                  row({
                    title: e.label,
                    desc: [e.date !== null ? D.label(e.date, { weekday: 'short' }) : '', e.sub || CAT_NAME[e.cat]]
                      .filter(Boolean)
                      .join(' · '),
                    right: amt(e.amount),
                  }),
                ),
              )
            : h('p', { class: 'muted', text: $t('Nothing spent.') }),
        ),
        card(
          $t('Purchases and one-offs'),
          $t('{0}, {1} in total.', plural(bought.length, 'entry'), money(-bought.reduce((a, e) => a + e.amount, 0))),
          btn($t('Log a purchase'), () => logPurchase(m), 'sm', 'plus'),
          bought.length
            ? h(
                'div',
                { class: 'rows' },
                bought.slice(0, 10).map(e =>
                  row({
                    title: e.label,
                    desc: [
                      e.date !== null ? D.label(e.date, { weekday: 'short' }) : $t('no exact day'),
                      e.sub || CAT_NAME[e.cat],
                    ].join(' · '),
                    right: amt(e.amount),
                    onclick: () => itemModal(e.id),
                    del: () => remove('items', e.id),
                  }),
                ),
              )
            : h('p', { class: 'muted', text: $t('Nothing logged for this month.') }),
        ),
      ),
    ),
  );
};
