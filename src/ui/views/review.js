/**
 * @file Review page: look at one month or one year and see what went well, what to watch, where the money went
 * and where the plan is heading. The numbers come from logic/review.js; this file only decides how to say them.
 */
import { M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { forecastScenario } from '../../logic/forecast.js';
import { reviewPeriod } from '../../logic/review.js';
import { CAT_NAME } from '../../models/categories.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { dataTable } from '../components/dataTable.js';
import { card, page, segc } from '../components/layout.js';
import { monthField } from '../components/pickers.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { UI, monthAt, nowK, selK } from '../state.js';
import { V } from './registry.js';

const percent = share => Math.round(share * 100) + '%';
const categoryName = cat => CAT_NAME[cat] || $t('Other');

/** One sentence for each thing that went well. */
export function goodText(item) {
  switch (item.id) {
    case 'leftOver':
      return $t('Kept {0} ({1} of income).', money(item.amount), percent(item.share));
    case 'saved':
      return $t('You put {0} into savings ({1} of your income).', money(item.amount), percent(item.share));
    case 'debtDown':
      return $t('Your debt went down by {0}.', money(item.amount));
    case 'budgetsKept':
      return $t('You stayed inside every budget you logged against, {0} under in total.', money(item.amount));
    case 'aboveCushion':
      return $t('You stayed above your cushion the whole time.');
    case 'noSurprises':
      return $t('Your real money matched the plan: almost no spending outside it.');
    default:
      return item.id;
  }
}

/** One sentence for each thing to watch, with what it costs over a year where that helps. */
export function watchText(item) {
  switch (item.id) {
    case 'negative':
      return $t(
        '{0} below zero, the worst at {1} in {2}.',
        plural(item.count, 'month'),
        money(item.amount),
        M.label(item.monthIndex, true),
      );
    case 'spentMore':
      return $t('You spent {0} more than came in.', money(item.amount));
    case 'overBudget':
      return $t(
        '“{0}” went {1} over its budget. At that rate it is {2} a year.',
        item.name,
        money(item.amount),
        money(item.yearly),
      );
    case 'unplanned':
      return $t(
        '{0} was spent outside the plan ({1} of everything you spent).',
        money(item.amount),
        percent(item.share),
      );
    case 'cardUp':
      return $t('You owe {0} more on credit cards than at the start.', money(item.amount));
    case 'tight':
      return $t('{0} under your cushion.', plural(item.count, 'month'));
    case 'subscriptions':
      return $t('Subscriptions took {0}, which is {1} a year.', money(item.amount), money(item.yearly));
    case 'topCategory':
      return $t('{0} is {1} of your spending ({2}).', categoryName(item.cat), percent(item.share), money(item.amount));
    default:
      return item.id;
  }
}

const insightList = (items, toText, tone, iconName, emptyText) =>
  items.length
    ? h(
        'div',
        { class: 'notes' },
        items.map(item =>
          h('div', { class: 'note ' + tone }, icon(iconName), h('div', { class: 'grow', text: toText(item) })),
        ),
      )
    : h('p', { class: 'muted', text: emptyText });

const kpi = (label, value, className, sub) =>
  h(
    'div',
    { class: 'kpi' },
    h('div', { class: 'l', text: label }),
    h('div', { class: 'v ' + (className || ''), text: value }),
    sub ? h('div', { class: 's', text: sub }) : null,
  );

/** Month or year switch, the picker for it, and earlier / later buttons. */
function periodPicker(monthIndex, yearly, summary, years) {
  const lastIndex = summary.s0 + summary.n - 1;
  const step = yearly ? 12 : 1;
  return [
    segc(
      [
        ['month', $t('Month')],
        ['year', $t('Year')],
      ],
      UI.rview,
      view => {
        UI.rview = view;
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
            onchange: event =>
              App.go('review', { month: clamp(+event.target.value * 12 + (monthIndex % 12), summary.s0, lastIndex) }),
          },
          years.map(year => h('option', { value: year, text: year, selected: year === Math.floor(monthIndex / 12) })),
        )
      : h(
          'div',
          { style: 'width:190px' },
          monthField({
            value: M.key(monthIndex),
            sm: true,
            onChange: value => App.go('review', { month: M.parse(value) }),
          }),
        ),
    ibtn($t('Earlier'), () => App.go('review', { month: Math.max(summary.s0, monthIndex - step) }), '', 'left'),
    ibtn($t('Later'), () => App.go('review', { month: Math.min(lastIndex, monthIndex + step) }), '', 'right'),
  ];
}

V.review = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const summary = projection.summary;
  const monthIndex = selK();
  const yearly = UI.rview === 'year';
  const year = Math.floor(monthIndex / 12);
  const months = yearly ? projection.months.filter(month => Math.floor(month.k / 12) === year) : [monthAt(monthIndex)];
  const years = [...new Set(projection.months.map(month => Math.floor(month.k / 12)))];
  const review = reviewPeriod(plan, projection, months, Store.day);
  const periodName = yearly ? String(year) : M.label(monthIndex, true);

  // a period that is not over yet shows planned numbers; say so, because a review reads like the past
  const today = Store.day;
  const lastMonth = months[months.length - 1];
  const timing =
    lastMonth.end < today
      ? $t('This period is over: these are the numbers it ended on.')
      : months[0].start > today
        ? $t('This period has not started: these are the planned numbers.')
        : $t('This period is still running: paid lines are real, the rest is the plan.');

  // where the plan is heading if later months go like the recent ones
  const currentPosition = clamp(nowK() - summary.s0, 0, projection.months.length - 1);
  const pace = forecastScenario(projection, currentPosition, { type: 'pace', sampleMonths: UI.forecast.sampleMonths });
  const paceEnd = pace.rows[pace.rows.length - 1];

  const topAmount = review.categories.length ? review.categories[0].amount : 0;
  const categoryRows = review.categories
    .slice(0, 9)
    .map(category =>
      h(
        'div',
        { class: 'catrow' },
        h('span', { text: categoryName(category.cat) }),
        h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(2, (category.amount / topAmount) * 100)}%` })),
        h('span', { class: 'num muted', text: `${money(category.amount)} · ${percent(category.share)}` }),
      ),
    );

  const budgetTable = dataTable({
    id: 'review-budgets',
    rows: review.budgets,
    columns: [
      { label: $t('Budget'), value: budget => budget.name, cell: budget => budget.name },
      { label: $t('Allowed'), value: budget => budget.planned, cell: budget => money(budget.planned) },
      { label: $t('Logged'), value: budget => budget.spent, cell: budget => money(budget.spent) },
      {
        label: $t('Left or over'),
        value: budget => budget.difference,
        cell: budget => signed(budget.difference),
        cellProps: budget => ({ class: budget.difference < 0 ? 'bad' : '' }),
      },
    ],
  });

  const biggestTable = () =>
    dataTable({
      id: 'review-biggest',
      rows: review.biggest,
      rowProps: line => ({
        class: 'click',
        tabindex: 0,
        onclick: () => App.go('months', { month: line.monthIndex }),
        onkeydown: event => {
          if (event.key === 'Enter') {
            App.go('months', { month: line.monthIndex });
          }
        },
      }),
      columns: [
        {
          label: $t('Name'),
          value: line => line.label,
          cell: line => [line.label, line.detail ? h('div', { class: 'muted small', text: line.detail }) : null],
        },
        yearly ? { label: $t('Month'), value: line => line.monthIndex, cell: line => M.label(line.monthIndex) } : null,
        { label: $t('Amount'), value: line => line.amount, cell: line => money(-line.amount) },
      ].filter(Boolean),
    });

  return page(
    $t('Review of {0}', periodName),
    $t('Look at a month or a year: what you did well, what to watch, and where that leads.'),
    periodPicker(monthIndex, yearly, summary, years),
    h('p', { class: 'small muted', style: 'margin:-4px 0 10px', text: timing }),
    h(
      'div',
      { class: 'kpis' },
      kpi($t('Money in'), money(review.moneyIn)),
      kpi(
        $t('Money out'),
        money(review.moneyOut),
        '',
        review.unplanned ? $t('{0} more outside the plan', money(review.unplanned)) : null,
      ),
      kpi(
        $t('Left over'),
        signed(review.leftOver),
        review.leftOver < 0 ? 'bad' : 'good',
        review.moneyIn ? $t('{0} of what came in', percent(review.leftOver / review.moneyIn)) : null,
      ),
      kpi($t('Put into savings'), money(review.saved)),
      kpi(
        lastMonth.end < today ? $t('Ended at') : $t('Ends at'),
        money(review.endBalance),
        review.endBalance < 0 ? 'bad' : '',
        $t('started at {0}', money(review.startBalance)),
      ),
    ),
    h(
      'div',
      { class: 'rgrid' },
      card(
        $t('What went well'),
        null,
        null,
        insightList(review.good, goodText, 'good', 'check', $t('Nothing stands out yet.')),
      ),
      card(
        $t('What to watch'),
        null,
        null,
        insightList(review.watch, watchText, 'warn', 'alert', $t('Nothing to worry about in this period.')),
      ),
      card(
        $t('Where it went'),
        $t('Planned and logged costs by category.'),
        null,
        categoryRows.length ? categoryRows : h('p', { class: 'muted', text: $t('No spending.') }),
      ),
      card(
        $t('Budgets'),
        $t('What each budget allowed against what you logged. Click a column to sort.'),
        null,
        review.budgets.length ? budgetTable : h('p', { class: 'muted', text: $t('No budgets in this period.') }),
      ),
      card(
        $t('Biggest costs'),
        null,
        null,
        review.biggest.length ? biggestTable() : h('p', { class: 'muted', text: $t('No costs in this period.') }),
      ),
      card(
        $t('Where this leads'),
        $t(
          'The end of your plan, as planned and if later months go like your next {0}.',
          plural(UI.forecast.sampleMonths, 'month'),
        ),
        btn(
          $t('Open the forecast'),
          () => {
            UI.ftab = 'pace';
            App.go('forecast');
          },
          'sm',
        ),
        h(
          'div',
          { class: 'flow' },
          h(
            'div',
            null,
            h('div', { class: 'l', text: $t('As planned') }),
            h('div', { class: 'v', text: money(paceEnd.planClose) }),
          ),
          h(
            'div',
            null,
            h('div', { class: 'l', text: $t('Like the next {0}', plural(UI.forecast.sampleMonths, 'month')) }),
            h('div', { class: 'v ' + (paceEnd.close < 0 ? 'bad' : ''), text: money(paceEnd.close) }),
          ),
          h(
            'div',
            null,
            h('div', { class: 'l', text: $t('Difference') }),
            h('div', { class: 'v', text: signed(paceEnd.close - paceEnd.planClose) }),
          ),
        ),
      ),
    ),
  );
};
