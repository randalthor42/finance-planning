/**
 * @file Forecast › Simulation: a range of possible futures learned from the person's real history, not one line.
 * A fan chart of the balance, the chance of going below zero and under the safety buffer, savings goals, the main
 * risks in plain words, what it learned (each value can be set by hand), what if, and a backtest against the last
 * three months. The numbers come from logic/sim (loaded on demand, ui/simRun.js); this file only words and draws them.
 *
 * No false precision: chances are rounded (to 5% above one in ten, never "0%" or "100%"), amounts of the future to
 * two significant figures, and the page says when it is guessing (little history) or when the backtest missed.
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { CAT_NAME } from '../../models/categories.js';
import { SIM_HORIZONS } from '../../models/sim.js';
import { IO } from '../../services/backup.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { fanChart } from '../components/charts.js';
import { dataTable } from '../components/dataTable.js';
import { info } from '../components/info.js';
import { card, chip, keep, page, segc } from '../components/layout.js';
import { moneyInp } from '../components/moneyInput.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { scenarioModal } from '../modals/scenario.js';
import { simOverrideModal } from '../modals/simOverride.js';
import { chance, chanceAbout, rough } from '../simFormat.js';
import { simulation } from '../simRun.js';
import { UI } from '../state.js';

/** The tone of a chance of something going wrong: 'bad' from 1 in 5, 'warn' from 1 in 20, else 'good'. */
const tone = p => {
  if (p >= 0.2) {
    return 'bad';
  }
  if (p >= 0.05) {
    return 'warn';
  }
  return 'good';
};

/** The name of a source of uncertainty: a category, the large expenses, an income. */
function sourceName(key, plan) {
  if (key === 'events') {
    return $t('Large irregular expenses');
  }
  if (key === 'extra') {
    return $t('Freelance income');
  }
  const [kind, id] = key.split(':');
  if (kind === 'inc') {
    return (plan.incomes.find(i => i.id === id) || {}).name || id;
  }
  return CAT_NAME[id] || id;
}

/** The main risks (logic/sim/risks.js) as sentences. */
function riskText(r, result, plan) {
  const n = plural(result.months.length, 'month');
  switch (r.id) {
    case 'calm':
      return $t('No big risks in the next {0}: in most futures your balance stays above zero and your buffer.', n);
    case 'belowZero':
      return r.k !== null
        ? $t(
            'In {0} of the futures your balance goes below zero, most often first in {1}.',
            chanceAbout(r.p),
            M.label(r.k, true),
          )
        : $t('In {0} of the futures your balance goes below zero.', chanceAbout(r.p));
    case 'zeroAtP10':
      return r.months === 0
        ? $t('In the worst 1 in 10 futures, your balance is below zero already this month.')
        : $t(
            'In the worst 1 in 10 futures, your balance reaches zero by {0} ({1} from now).',
            M.label(r.k, true),
            plural(r.months, 'month'),
          );
    case 'belowBuffer':
      return $t(
        'In {0} of the futures your balance goes under your safety buffer of {1}.',
        chanceAbout(r.p),
        money(r.buffer),
      );
    case 'goal':
      return r.byDate
        ? $t('“{0}” is reached by {1} in only {2} of the futures.', r.name, M.label(r.by, true), chanceAbout(r.p))
        : $t('“{0}” is reached within these months in only {1} of the futures.', r.name, chanceAbout(r.p));
    case 'goalPlan':
      return r.planReach !== null
        ? $t(
            '“{0}” cannot reach its target by {1}, even as planned: with every payment made it takes until {2}.',
            r.name,
            M.label(r.by, true),
            M.label(r.planReach, true),
          )
        : $t(
            '“{0}” cannot reach its target by {1}, even as planned: its payments are too small for that.',
            r.name,
            M.label(r.by, true),
          );
    case 'planGap':
      return $t(
        'Your plan expects about {0} more by {1} than your real spending suggests. Often that is spending with no budget in the plan.',
        rough(r.amount),
        M.label(r.k, true),
      );
    case 'drivers':
      return $t(
        'Most of the uncertainty comes from {0}.',
        r.sources.map(s => sourceName(s.key, plan)).join(' ' + $t('and') + ' '),
      );
    case 'events':
      return $t(
        'Large irregular expenses happen about {0} a year, typically {1}.',
        plural(Math.round(r.perYear * 10) / 10, 'time'),
        rough(r.typical),
      );
    case 'noHistory':
      return $t(
        'There is no spending history yet: the ranges are wide guesses from your budgets. Log your spending for a few months to make them yours.',
      );
    case 'shortHistory':
      return $t('Only {0} of history: the ranges are wide and less certain.', plural(r.months, 'month'));
    case 'lowConfidence':
      return $t('Little data for {0}: wide ranges are used there.', r.cats.map(c => CAT_NAME[c] || c).join(', '));
    case 'untrusted':
      return $t('Checked against your last 3 months, the simulation missed. Treat these numbers with care.');
    case 'clipped':
      return $t('Your plan only covers {0}: the simulation stops there.', plural(r.months, 'month'));
    case 'noMonths':
      return $t('Your plan has no months ahead to simulate.');
    default:
      return '';
  }
}

/** Settings of the simulation: months ahead, runs, safety buffer, seed, and which what-if to compare. */
function controls(plan, sim, scenarioId) {
  const horizon = segc(
    SIM_HORIZONS.map(hz => [hz, plural(hz, 'month')]),
    sim.horizon,
    hz => Actions.setSim({ horizon: hz }),
  );
  horizon.setAttribute('role', 'group');
  horizon.setAttribute('aria-label', $t('Months ahead'));
  const runs = h(
    'select',
    {
      class: 'inp sm',
      style: 'width:auto',
      'aria-label': $t('Runs'),
      onchange: e => Actions.setSim({ runs: Number(e.target.value) }),
    },
    [...new Set([1000, 2000, 5000, 10000, sim.runs])]
      .sort((a, b) => a - b)
      .map(n => h('option', { value: n, text: $t('{0} runs', n.toLocaleString()), selected: n === sim.runs })),
  );
  let buffer = sim.buffer;
  const bufferInput = moneyInp({
    value: sim.buffer,
    blank: true,
    ph: money(plan.settings.cushion),
    label: $t('Safety buffer'),
    onInput: v => {
      buffer = v;
    },
  });
  bufferInput.style.width = '110px';
  // a number, 0 included, is the buffer; an empty field means the plan's cushion
  bufferInput.addEventListener('change', () =>
    Actions.setSim({ buffer: typeof buffer === 'number' && Number.isFinite(buffer) ? buffer : null }),
  );
  const what = h(
    'select',
    {
      class: 'inp sm',
      style: 'width:auto',
      'aria-label': $t('What if'),
      onchange: e => {
        UI.simScenario = e.target.value || null;
        App.render();
      },
    },
    h('option', { value: '', text: $t('No what-if'), selected: !scenarioId }),
    sim.scenarios.map(s => h('option', { value: s.id, text: s.name, selected: s.id === scenarioId })),
  );
  const current = sim.scenarios.find(s => s.id === scenarioId);
  return h(
    'div',
    { class: 'sim-controls' },
    h('div', { class: 'frow' }, h('span', { text: $t('Months ahead') }), horizon),
    h('label', { class: 'frow' }, h('span', { text: $t('Runs') }), runs),
    h('label', { class: 'frow' }, h('span', { text: $t('Safety buffer') }), bufferInput),
    h(
      'div',
      { class: 'frow' },
      h('span', { text: $t('Seed {0}', sim.seed) }),
      btn($t('Try another seed'), () => Actions.setSim({ seed: sim.seed + 1 }), 'sm ghost'),
      info(
        $t(
          'The same seed always gives the same numbers, so you can come back to them. Another seed shows how much the numbers move by chance alone: with enough runs, hardly at all.',
        ),
      ),
    ),
    h(
      'div',
      { class: 'frow' },
      h('span', { text: $t('What if') }),
      what,
      current ? btn($t('Edit'), () => scenarioModal(current), 'sm ghost', 'edit') : null,
      btn($t('New what-if'), () => scenarioModal(null, id => (UI.simScenario = id)), 'sm', 'plus'),
    ),
  );
}

/** The headline numbers: chances, where the balance ends, the worst 1 in 10. */
function headline(result) {
  const end = result.months[result.months.length - 1];
  const lastK = end.k;
  const kpi = (label, value, sub, cls) =>
    h(
      'div',
      { class: 'kpi' },
      h('div', { class: 'l', text: label }),
      h('div', { class: 'v ' + (cls || ''), text: value }),
      sub ? h('div', { class: 's', text: sub }) : null,
    );
  let worst;
  if (result.zeroAtP10 === null) {
    worst = $t('stays above zero for {0}', plural(result.months.length, 'month'));
  } else if (result.zeroAtP10 === 0) {
    worst = $t('below zero this month');
  } else {
    worst = $t(
      'reaches zero in {0} ({1})',
      plural(result.zeroAtP10, 'month'),
      M.label(result.months[result.zeroAtP10].k),
    );
  }
  return h(
    'div',
    { class: 'kpis sim-kpis' },
    kpi(
      $t('Chance of going below zero'),
      chance(result.pBelowZero),
      $t('in the next {0}', plural(result.months.length, 'month')),
      tone(result.pBelowZero),
    ),
    kpi(
      $t('Chance of going under your buffer'),
      chance(result.pBelowBuffer),
      $t('buffer {0}', money(result.buffer)),
      tone(result.pBelowBuffer / 2),
    ),
    kpi(
      $t('Balance at the end of {0}', M.label(lastK, true)),
      $t('about {0}', rough(end.p50)),
      $t('middle half {0} to {1}', rough(end.p25), rough(end.p75)),
      end.p50 < 0 ? 'bad' : '',
    ),
    kpi($t('In the worst 1 in 10 futures'), worst, null, result.zeroAtP10 === null ? 'good' : 'bad'),
  );
}

/** Each savings goal with a target: its chance by its date, and when half and nine in ten of the futures reach it. */
function goalsCard(result) {
  const goals = result.goals.filter(g => g.target > 0);
  if (!goals.length) {
    return null;
  }
  const when = k => (k === null ? $t('not within these months') : M.label(k, true));
  return card(
    $t('Savings goals'),
    $t('A month that runs short cannot put money aside, so goals can slip.'),
    null,
    dataTable({
      id: 'sim-goals',
      rows: goals,
      columns: [
        { label: $t('Goal'), value: g => g.name, cell: g => g.name },
        { label: $t('Target'), value: g => g.target, cell: g => money(g.target) },
        {
          label: $t('Chance by its date'),
          value: g => g.pByDate ?? -1,
          cell: g => {
            if (g.pByDate !== null) {
              return h('b', { class: tone(1 - g.pByDate), text: $t('{0} by {1}', chance(g.pByDate), M.label(g.by)) });
            }
            return g.byBeyond ? $t('{0} is after these months', M.label(g.by)) : $t('no date set');
          },
        },
        { label: $t('Reached in half the futures by'), value: g => g.reach50 ?? Infinity, cell: g => when(g.reach50) },
        { label: $t('Reached in 9 of 10 by'), value: g => g.reach90 ?? Infinity, cell: g => when(g.reach90) },
      ],
    }),
  );
}

/** Baseline and what-if side by side, with the difference. */
function compareCard(result, compare, scenario) {
  const end = r => r.months[r.months.length - 1];
  const rows = [
    [
      $t('Chance of going below zero'),
      chance(result.pBelowZero),
      chance(compare.pBelowZero),
      diffPoints(compare.pBelowZero - result.pBelowZero),
    ],
    [
      $t('Chance of going under your buffer'),
      chance(result.pBelowBuffer),
      chance(compare.pBelowBuffer),
      diffPoints(compare.pBelowBuffer - result.pBelowBuffer),
    ],
    [
      $t('Balance at the end, middle'),
      rough(end(result).p50),
      rough(end(compare).p50),
      roughSigned(end(compare).p50 - end(result).p50),
    ],
    [
      $t('Balance at the end, worst 1 in 10'),
      rough(end(result).p10),
      rough(end(compare).p10),
      roughSigned(end(compare).p10 - end(result).p10),
    ],
    ...result.goals
      .filter(g => g.target > 0)
      .map((g, i) => {
        const a = g.pByDate ?? g.pWithin;
        const b = compare.goals[i].pByDate ?? compare.goals[i].pWithin;
        return [$t('“{0}” reached', g.name), chance(a), chance(b), diffPoints(b - a)];
      }),
  ];
  return card(
    $t('What if: {0}', scenario.name),
    $t('Both with the same random futures, so the difference is the what-if alone.'),
    null,
    h(
      'div',
      { class: 'rows sim-compare' },
      rows.map(([label, a, b, d]) =>
        h(
          'div',
          { class: 'row' },
          h('div', { class: 'grow' }, h('div', { class: 't', text: label })),
          h(
            'div',
            { class: 'sim-cmp-v' },
            h('span', { class: 'muted', text: a, title: $t('Without') }),
            h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
            h('b', { text: b, title: scenario.name }),
            h('span', { class: 'chip', text: d, title: $t('Difference') }),
          ),
        ),
      ),
    ),
  );
}
/** A difference of two chances in points ("+12 points"), or a dash when it is under one point. */
const diffPoints = d => {
  if (Math.abs(d) < 0.01) {
    return '–';
  }
  const sign = d > 0 ? '+' : '−';
  return $t('{0} points', sign + Math.round(Math.abs(d) * 100));
};
/** A rounded amount with its sign, or a dash when it is under 5. */
const roughSigned = v => {
  if (Math.abs(v) < 5) {
    return '–';
  }
  const sign = v > 0 ? '+' : '−';
  return sign + rough(Math.abs(v));
};

/** The finished simulation: its headline, the fan chart with its legend, and the main risks. */
function resultBlock(state, plan) {
  const result = state.result;
  let headlineBlock = null;
  let chart = null;
  let legend = null;
  if (result.months.length) {
    headlineBlock = headline(result);
    chart = fanChart({
      months: result.months,
      buffer: result.buffer,
      compare: state.compare ? state.compare.months : null,
      compareName: state.scenario ? state.scenario.name : '',
      rough,
    });
    legend = fanLegend(!!state.compare, state.scenario);
  }
  return h(
    'div',
    { class: 'sim-result' + (state.stale ? ' stale' : ''), 'aria-busy': String(!!state.stale) },
    headlineBlock,
    chart,
    legend,
    h('div', { class: 'grp-h', text: $t('The main risks') }),
    h(
      'ul',
      { class: 'sim-risks' },
      state.risks.map(r => h('li', { text: riskText(r, result, plan) })),
    ),
  );
}

/** What the simulation shows while it runs: an error, "Simulating…", or the result once it is ready. */
function runState(state, ready, sim, plan) {
  if (state.status === 'error') {
    return h(
      'p',
      { class: 'note bad' },
      icon('alert'),
      h('span', { text: $t('The simulation could not run: {0}', String(state.error && state.error.message)) }),
    );
  }
  if (!ready) {
    return h('div', {
      class: 'sim-loading',
      role: 'status',
      text: $t('Simulating {0} futures…', sim.runs.toLocaleString()),
    });
  }
  return resultBlock(state, plan);
}

/** What the simulation learned from history, each with a way to use one's own values. */
function learnedCard(model, sim, plan) {
  const w = model.window;
  const intro = w.months
    ? $t(
        'Learned from {0} of history ({1} to {2}): {3} purchases and spends, of which {4} large and irregular.',
        plural(w.months, 'month'),
        M.label(w.from),
        M.label(w.to),
        model.history.spends,
        model.history.large,
      )
    : $t('There is no history to learn from yet: every range below is a wide guess, flagged “low”.');
  const mine = o => (o && Object.keys(o).length ? chip($t('your values'), 'acc') : null);
  const confidence = c => (c === 'low' ? chip($t('low confidence'), 'warn') : chip($t('learned'), 'good'));
  const catRows = model.cats.map(c => {
    const o = sim.cats[c.cat];
    let basis;
    if (c.basis === 'history') {
      basis = $t('{0} of data', plural(c.months, 'month'));
    } else if (c.basis === 'few') {
      basis = $t('only {0} of data', plural(c.months, 'month'));
    } else if (c.zeroHistory) {
      basis = $t('nothing logged: your budget is used');
    } else {
      basis = $t('no history: your budget is used');
    }
    const range = c.basis === 'history' ? $t('{0} to {1}', rough(c.stats.p10), rough(c.stats.p90)) : $t('wide');
    let detail;
    if (o && o.off) {
      detail = $t('Left out of the simulation.');
    } else {
      const usual = o && o.median !== undefined ? o.median : c.center;
      detail = $t('Usual month about {0} · most months {1} · {2}', rough(usual), range, basis);
    }
    return h(
      'div',
      { class: 'row sim-row' + (o && o.off ? ' off' : '') },
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 't' }, CAT_NAME[c.cat] || c.cat, ' ', confidence(c.confidence), ' ', mine(o)),
        h('div', { class: 'd', text: detail }),
      ),
      btn($t('Change'), () => simOverrideModal('cats', c.cat, model), 'sm ghost'),
    );
  });
  const e = model.events;
  const eo = sim.events;
  let eventText;
  if (eo.off) {
    eventText = $t('Left out of the simulation.');
  } else if (eo.perYear ?? e.perYear) {
    eventText = $t(
      'About {0} a year, typically {1}. From {2} in your history (purchases from {3}).',
      plural(Math.round((eo.perYear ?? e.perYear) * 10) / 10, 'time'),
      rough(eo.size ?? e.typical),
      e.count,
      e.threshold ? rough(e.threshold) : '–',
    );
  } else {
    eventText = $t('None in your history. Add your own if you expect some (a car repair, a new phone).');
  }
  const eventRow = h(
    'div',
    { class: 'row sim-row' + (eo.off ? ' off' : '') },
    h(
      'div',
      { class: 'grow' },
      h(
        'div',
        { class: 't' },
        $t('Large irregular expenses'),
        ' ',
        e.count || eo.perYear ? confidence(e.confidence) : null,
        ' ',
        mine(eo),
      ),
      h('div', { class: 'd', text: eventText }),
    ),
    btn($t('Change'), () => simOverrideModal('events', null, model), 'sm ghost'),
  );
  const incomeRows = model.incomes.map(i => {
    const o = sim.incomes[i.id] || {};
    const mode = o.mode || i.mode;
    const risks = [
      o.delay ? $t('{0} chance a payment is late', chance(o.delay)) : null,
      o.cutChance ? $t('{0} a year chance of a {1} cut', chance(o.cutChance), Math.round(o.cutPct * 100) + '%') : null,
      o.raiseChance
        ? $t('{0} a year chance of a {1} raise', chance(o.raiseChance), Math.round(o.raisePct * 100) + '%')
        : null,
    ].filter(Boolean);
    let modeText;
    if (mode !== 'variable') {
      modeText = $t('Fixed: {0} as planned', money(i.amount));
    } else if (i.mode === 'variable' && i.confidence === 'ok') {
      modeText = $t('Varies as in your history ({0} of data)', plural(i.observed, 'month'));
    } else {
      modeText = $t('Varies (freelance): no history of how, so a wide range is used');
    }
    return h(
      'div',
      { class: 'row sim-row' },
      h(
        'div',
        { class: 'grow' },
        h(
          'div',
          { class: 't' },
          i.name,
          ' ',
          mode === 'variable' ? confidence(i.confidence) : null,
          ' ',
          mine(sim.incomes[i.id]),
        ),
        h('div', {
          class: 'd',
          text: [modeText, ...risks].join(' · '),
        }),
      ),
      btn($t('Change'), () => simOverrideModal('incomes', i.id, model), 'sm ghost'),
    );
  });
  return keep('sim-learned', $t('What it learned from your history, and your own values'), () =>
    h(
      'div',
      null,
      h('p', { class: 'muted small', text: intro }),
      h('div', { class: 'grp-h', text: $t('Everyday spending, per month') }),
      catRows.length
        ? h('div', { class: 'rows' }, catRows)
        : h('p', { class: 'muted small', text: $t('No spending to learn from, and no budgets.') }),
      h('div', { class: 'grp-h', text: $t('Rare events') }),
      h('div', { class: 'rows' }, eventRow),
      h('div', { class: 'grp-h', text: $t('Income') }),
      incomeRows.length
        ? h('div', { class: 'rows' }, incomeRows)
        : h('p', { class: 'muted small', text: $t('No recurring income in the plan.') }),
      h('p', {
        class: 'muted small',
        text: $t(
          'Bills, subscriptions, loans, planned one-offs, trips and wishes are taken as planned. Everyday spending resamples your real months (all categories from the same month, as they move together), not a bell curve.',
        ),
      }),
    ),
  );
}

/** The backtest: the last months hidden, predicted from the months before, and what really happened. */
function backtestCard(check) {
  const verdicts = {
    good: [$t('Trustworthy for your data'), 'good'],
    fair: [$t('Roughly right for your data'), 'warn'],
    poor: [$t('Not trustworthy for your data now'), 'bad'],
    unknown: [$t('Too little history to tell'), ''],
  };
  if (check.status !== 'ok') {
    return card(
      $t('Checked against reality'),
      $t(
        'Needs at least {0} of history: 3 to learn from and {1} to check.',
        plural(3 + check.hold, 'month'),
        plural(check.hold, 'month'),
      ),
      chip(verdicts.unknown[0]),
    );
  }
  const [label, cls] = verdicts[check.verdict];
  const coverage =
    check.coverage90 !== null
      ? $t(
          'Over {0} checks from earlier months, reality fell inside the middle half {1} of the time (should be about half) and inside nine in ten {2} of the time (should be about 90%).',
          check.checks,
          Math.round(check.coverage50 * 100) + '%',
          Math.round(check.coverage90 * 100) + '%',
        )
      : '';
  return card(
    $t('Checked against reality'),
    $t(
      'The last {0} were hidden, the simulation learned from the months before, and then predicted them.',
      plural(check.hold, 'month'),
    ),
    chip(label, cls),
    dataTable({
      id: 'sim-backtest',
      rows: check.months,
      columns: [
        { label: $t('After'), value: m => m.k, cell: m => M.label(m.k, true) },
        {
          label: $t('Predicted spending so far, middle half'),
          value: m => m.p25,
          cell: m => $t('{0} to {1}', rough(m.p25), rough(m.p75)),
        },
        { label: $t('Nine in ten'), value: m => m.p5, cell: m => $t('{0} to {1}', rough(m.p5), rough(m.p95)) },
        { label: $t('Really spent so far'), value: m => m.actual, cell: m => money(m.actual) },
        {
          label: $t('Inside?'),
          value: m => {
            if (m.inside50) {
              return 2;
            }
            return m.inside90 ? 1 : 0;
          },
          cell: m => {
            if (m.inside50) {
              return chip($t('middle half'), 'good');
            }
            return m.inside90 ? chip($t('nine in ten'), 'warn') : chip($t('outside'), 'bad');
          },
        },
      ],
    }),
    h('p', {
      class: 'muted small',
      text: [$t('Spending is added up from the first hidden month.'), coverage].filter(Boolean).join(' '),
    }),
  );
}

/** Every month's numbers, for screen readers and for anyone who prefers a table to a chart. */
function numbersTable(result) {
  return keep('sim-numbers', $t('Month by month'), () =>
    dataTable({
      id: 'sim-months',
      rows: result.months,
      columns: [
        { label: $t('Month'), value: m => m.k, cell: m => M.label(m.k) },
        { label: $t('Plan'), value: m => m.plan, cell: m => money(m.plan) },
        { label: $t('1 in 20 lower'), value: m => m.p5, cell: m => rough(m.p5) },
        { label: $t('Middle half'), value: m => m.p25, cell: m => $t('{0} to {1}', rough(m.p25), rough(m.p75)) },
        {
          label: $t('Middle'),
          value: m => m.p50,
          cell: m => h('b', { class: m.p50 < 0 ? 'bad' : '', text: rough(m.p50) }),
        },
        { label: $t('1 in 20 higher'), value: m => m.p95, cell: m => rough(m.p95) },
      ],
    }),
  );
}

const DISCLAIMER = () => $t('Simulations are estimates based on your past behaviour, not financial advice.');

/**
 * The CSV of the fan: month, plan and percentiles (exact values, for a spreadsheet).
 * @returns {string} the CSV text
 */
export function simCsv(result) {
  return IO.csvText([
    [$t('Month'), $t('Plan'), 'P5', 'P10', 'P25', 'P50', 'P75', 'P90', 'P95'],
    ...result.months.map(m => [M.key(m.k), m.plan, m.p5, m.p10, m.p25, m.p50, m.p75, m.p90, m.p95].map(String)),
  ]);
}

/**
 * The Simulation page (Forecast › Simulation).
 * @returns {Array} the page (layout.js page)
 */
export function simulationPage(title) {
  const plan = Store.plan;
  const sim = plan.sim;
  const scenarioId = sim.scenarios.some(s => s.id === UI.simScenario) ? UI.simScenario : null;
  const state = simulation(scenarioId, () => {
    if (UI.view === 'forecast') {
      App.render();
    }
  });
  const ready = state.status === 'ready' && state.result;
  const result = ready ? state.result : null;
  const download = () => IO.download(`runway-simulation-${M.key(result.months[0].k)}.csv`, simCsv(result), 'text/csv');
  const body = [];
  body.push(
    card(
      null,
      null,
      null,
      controls(plan, sim, scenarioId),
      h('p', { class: 'note sim-note' }, icon('info'), h('span', { text: DISCLAIMER() })),
      runState(state, ready, sim, plan),
    ),
  );
  if (ready && result.months.length) {
    if (state.compare) {
      body.push(compareCard(result, state.compare, state.scenario));
    }
    body.push(
      goalsCard(result),
      card(null, null, null, learnedCard(state.model, sim, plan), numbersTable(result)),
      backtestCard(state.check),
    );
  }
  return page(
    title,
    $t('A range of possible futures, learned from what you really spent. Not one line: many.'),
    [
      ready && result.months.length
        ? btn(
            $t('Show in the month planner'),
            () => {
              UI.overlay = 'sim';
              App.go('months');
            },
            '',
            'calendar',
          )
        : null,
      ready && result.months.length ? btn($t('Export CSV'), download, '', 'download') : null,
    ],
    ...body.filter(Boolean),
  );
}

/** What the colours of the fan mean. */
function fanLegend(compare, scenario) {
  const item = (cls, text) => h('span', null, h('i', { class: cls }), text);
  return h(
    'div',
    { class: 'legend static sim-legend' },
    item('lg-mid', $t('Middle')),
    item('lg-50', $t('Middle half of the futures')),
    item('lg-90', $t('Nine in ten')),
    item('lg-plan', $t('Your plan')),
    compare ? item('lg-cmp', $t('What if: {0}', scenario.name)) : null,
  );
}
