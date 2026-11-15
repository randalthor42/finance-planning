/**
 * @file Savings goals page.
 */
import { M } from '../../core/dates.js';
import { fmtNum, money } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { sparkline } from '../components/charts.js';
import { bar, card, cardDel, chip, empty, keep, page, tile } from '../components/layout.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { goalModal } from '../modals/goal.js';
import { curK, monthAt } from '../state.js';
import { V } from './registry.js';

V.goals = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const summary = projection.summary;
  const i = curK() - summary.s0;
  const totalNow = plan.goals.reduce((a, G) => a + projection.goals[G.id].series[i], 0);
  const monthly = monthAt(curK())
    .entries.filter(e => e.key.startsWith('goal:') && e.amount < 0)
    .reduce((a, e) => a - e.amount, 0);
  const cards = plan.goals.map(G => {
    const g = projection.goals[G.id];
    const now = g.series[i];
    const by = M.parse(G.by);
    const late = by !== null && G.target > 0 && (g.reached === null || g.reached > by);
    const needM = late ? Math.ceil(Math.max(0, G.target - now) / Math.max(1, by - curK() + 1)) : 0;
    const steps = () =>
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
              [$t('Month'), $t('In the pot'), G.target ? $t('Of target') : ''].map(t => h('th', { text: t })),
            ),
          ),
          h(
            'tbody',
            null,
            g.series.map((v, j) =>
              j % 3 === 0 || j === g.series.length - 1 || summary.s0 + j === g.reached
                ? h(
                    'tr',
                    { class: summary.s0 + j === g.reached ? 'sel' : '' },
                    h('td', { text: M.label(summary.s0 + j) }),
                    h('td', { text: money(v) }),
                    h('td', { text: G.target ? Math.round((v / G.target) * 100) + '%' : '' }),
                  )
                : null,
            ),
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
            G.name,
            ' ',
            g.reached !== null && g.reached <= curK()
              ? chip($t('reached'), 'good')
              : late
                ? chip($t('behind'), 'warn')
                : by !== null
                  ? chip($t('on track'), 'good')
                  : null,
          ),
          h('p', {
            text: [
              G.monthly ? $t('{0} a month', money(G.monthly)) : $t('No monthly amount set'),
              G.rate ? $t('{0}% interest', fmtNum(G.rate)) : '',
            ]
              .filter(Boolean)
              .join(' · '),
          }),
        ),
        h(
          'div',
          { class: 'acts' },
          btn($t('Edit'), () => goalModal(G.id), 'sm', 'edit'),
          cardDel('goals', G.id),
        ),
      ),
      G.target ? bar((now / G.target) * 100, 'good') : null,
      sparkline(g.series, G.target),
      h(
        'div',
        { class: 'tiles' },
        tile($t('Saved now'), money(now)),
        G.target ? tile($t('Target'), money(G.target), '', by !== null ? $t('by ') + M.label(by) : null) : null,
        G.target
          ? tile(
              $t('Reached'),
              g.reached !== null ? M.label(g.reached) : $t('Not within this plan'),
              g.reached === null ? 'warn' : '',
            )
          : tile($t('At end of plan'), money(g.end)),
        g.interest > 0 ? tile($t('Interest earned'), money(g.interest)) : null,
        G.release ? tile($t('Taken out to spend'), M.label(M.parse(G.release))) : null,
      ),
      late
        ? h(
            'div',
            { class: 'note warn' },
            icon('alert'),
            h('div', {
              class: 'grow',
              text: $t('To reach {0} by {1} you need about {2} a month.', money(G.target), M.label(by), money(needM)),
            }),
            btn(
              $t('Use it'),
              () =>
                Actions.patch(
                  'goals',
                  G.id,
                  { monthly: needM },
                  $t('“{0}” now saves {1} a month', G.name, money(needM)),
                ),
              'sm',
            ),
          )
        : null,
      keep(G.id + ':g', $t('How the pot grows'), steps),
    );
  });
  return page(
    $t('Savings goals'),
    $t(
      'Money you set aside each month. It leaves your cash, builds a pot, and shows up in every month, the overview and the forecast.',
    ),
    [btn($t('Add a goal'), () => goalModal(), 'primary', 'plus')],
    cards.length
      ? [
          h(
            'div',
            { class: 'kpis' },
            h(
              'div',
              { class: 'kpi' },
              h('div', { class: 'l', text: $t('Saved in total') }),
              h('div', { class: 'v', text: money(totalNow) }),
              h('div', { class: 's', text: $t('as of ') + M.label(curK()) }),
            ),
            h(
              'div',
              { class: 'kpi' },
              h('div', { class: 'l', text: $t('Going into savings this month') }),
              h('div', { class: 'v', text: money(monthly) }),
              h('div', { class: 's', text: plural(plan.goals.length, 'goal') }),
            ),
            h(
              'div',
              { class: 'kpi' },
              h('div', { class: 'l', text: $t('Saved at the end of the plan') }),
              h('div', { class: 'v', text: money(projection.months[summary.n - 1].savings) }),
              h('div', { class: 's', text: M.label(summary.endK) }),
            ),
          ),
          h('div', { class: 'cols' }, cards),
        ]
      : card(
          null,
          null,
          null,
          empty(
            $t('No savings goals yet'),
            $t('An emergency fund is a good first one: three to six months of spending.'),
            $t('Add a goal'),
            () => goalModal(),
          ),
        ),
  );
};
