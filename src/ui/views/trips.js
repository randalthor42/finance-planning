/**
 * @file Trips and events page, including whether the plan can pay for each one.
 */
import { D, M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { firstFit } from '../../logic/advice.js';
import { project } from '../../logic/projection.js';
import { tripParts } from '../../logic/trips.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { linkify } from '../components/info.js';
import { amt, bar, card, cardDel, chip, empty, keep, page, row, segc, tile } from '../components/layout.js';
import { dataTable } from '../components/dataTable.js';
import { h } from '../dom.js';
import { tripModal } from '../modals/trip.js';
import { curK, monthAt } from '../state.js';
import { V } from './registry.js';

/** How the plan copes with one trip: compares the plan with and without it. */
function tripFit(t) {
  const plan = Store.plan;
  const projection = Store.proj;
  if (!t.on) {
    return null;
  }
  const base = project({ ...plan, trips: plan.trips.filter(x => x.id !== t.id) }, { today: Store.day });
  const newNeg = projection.months.filter((m, i) => m.status === 'neg' && base.months[i].status !== 'neg');
  const newTight = projection.months.filter((m, i) => m.status === 'tight' && base.months[i].status === 'ok');
  return { newNeg, newTight, tone: newNeg.length ? 'bad' : newTight.length ? 'warn' : 'good' };
}
export const budgetTone = (used, budget) => (used > budget ? 'over' : used >= budget * 0.9 ? 'warn' : 'good');
const tripWhen = t => {
  const a = D.parse(t.from);
  const b = D.parse(t.to);
  return a === null
    ? M.label(M.parse(t.month), true)
    : b === null || b === a
      ? D.label(a, { weekday: 'short', year: 'numeric' })
      : `${D.label(a)} to ${D.label(b, { year: 'numeric' })} · ${plural(b - a + 1, 'day')}`;
};
/** Everything a trip card or list row needs, worked out once. */
function tripInfo(t) {
  const plan = Store.plan;
  const projection = Store.proj;
  const summary = projection.summary;
  const inPlan = k => k >= summary.s0 && k < summary.s0 + summary.n;
  const tripMonth = M.parse(t.month);
  const total = t.items.reduce((a, i) => a + i.amount, 0);
  const by = new Map();
  for (const x of tripParts(plan.settings, t)) {
    by.set(x.k, (by.get(x.k) || []).concat(x));
  }
  let tone = '';
  let label = $t('not counted');
  let text = $t('Switched off, so it is not in your plan.');
  let act = null;
  if (t.kind === 'idea') {
    const k = total > 0 ? firstFit(projection, plan.settings.cushion, total, curK()) : null;
    const left = Math.max(1, summary.endK - curK());
    tone = k === null ? 'warn' : 'acc';
    label = $t('idea');
    text = !total
      ? $t('Add rough costs to see when you could afford it.')
      : k === null
        ? $t(
            'Not within your plan yet. Putting aside {0} a month would cover it by {1}.',
            money(total / left),
            M.label(summary.endK),
          )
        : $t('The earliest your plan can pay for this is {0}.', M.label(k, true));
    if (k !== null) {
      act = [
        $t('Plan it for ') + M.label(k),
        () =>
          Actions.patch(
            'trips',
            t.id,
            { kind: 'trip', month: M.key(k), on: true },
            $t('Planned “{0}” for {1}', t.name, M.label(k)),
          ),
      ];
    }
  } else if (t.on) {
    const fit = tripFit(t);
    const touched = [...by.keys()].filter(inPlan).map(monthAt);
    const worst = touched.length ? touched.reduce((a, b) => (b.close < a.close ? b : a)) : null;
    const already = !fit.newNeg.length && !!worst && worst.status === 'neg';
    tone = fit.newNeg.length
      ? 'bad'
      : already || fit.tone === 'warn' || (worst && worst.status === 'tight')
        ? 'warn'
        : 'good';
    label = fit.newNeg.length
      ? $t('too expensive')
      : already
        ? $t('month already short')
        : tone === 'warn'
          ? $t('tight')
          : $t('fits');
    text = fit.newNeg.length
      ? $t(
          'Pushes {0} below zero, first {1} (ends at {2}).',
          plural(fit.newNeg.length, 'month'),
          M.label(fit.newNeg[0].k, true),
          money(fit.newNeg[0].close),
        )
      : already
        ? $t(
            '{0} is already short without this. With it, the month ends at {1}.',
            M.label(worst.k, true),
            money(worst.close),
          )
        : fit.newTight.length
          ? $t(
              '{0} would end at {1}, under your cushion.',
              M.label(fit.newTight[0].k, true),
              money(fit.newTight[0].close),
            )
          : worst && worst.status === 'tight'
            ? $t('{0} is tight: it ends at {1}.', M.label(worst.k, true), money(worst.close))
            : worst
              ? $t('Fits. {0} still ends at {1}.', M.label(worst.k, true), money(worst.close))
              : $t('Add costs to see whether it fits.');
  }
  return { tk: tripMonth, total, by, tone, label, text, act, inPlan };
}
V.trips = () => {
  const plan = Store.plan;
  const list = Store.db.tripView === 'list';
  const sorted = [...plan.trips].sort(
    (a, b) =>
      (a.kind === 'idea') - (b.kind === 'idea') ||
      M.parse(a.month) - M.parse(b.month) ||
      (D.parse(a.from) || 0) - (D.parse(b.from) || 0),
  );
  const sw = t => {
    const c = h('input', {
      type: 'checkbox',
      checked: t.on,
      'aria-label': $t('Count in my plan'),
      onchange: () => Actions.toggle('trips', t.id, c.checked),
    });
    return t.kind === 'idea' ? null : h('label', { class: 'switch', title: $t('Count in my plan') }, c);
  };
  const details = (t, I) => () =>
    h(
      'div',
      null,
      h(
        'div',
        { class: 'rows' },
        [...I.by]
          .sort((a, b) => a[0] - b[0])
          .map(([k, items]) =>
            row({
              title: M.label(k, true),
              cls: 'wrap',
              chips: [
                k < I.tk ? chip($t('paid before'), 'acc') : null,
                t.on && I.inPlan(k)
                  ? (m =>
                      m.status === 'neg'
                        ? chip($t('ends at ') + money(m.close), 'bad')
                        : m.status === 'tight'
                          ? chip($t('ends at ') + money(m.close), 'warn')
                          : chip($t('fits'), 'good'))(monthAt(k))
                  : null,
              ],
              desc: items.map(i => `${i.name || $t('Cost')} ${money(i.amount)}`).join(' · '),
              right: amt(-items.reduce((a, i) => a + i.amount, 0)),
              onclick: t.kind === 'idea' ? null : () => App.go('months', { month: k }),
            }),
          ),
        t.on && t.reserve && t.budget > I.total
          ? row({
              title: $t('Budget not planned yet'),
              desc: $t('Reserved in {0}', M.label(I.tk)),
              right: amt(-(t.budget - I.total)),
              cls: 'off',
            })
          : null,
      ),
      [t.note ? [$t('Notes'), t.note] : null, ...t.items.filter(i => i.note).map(i => [i.name || $t('Cost'), i.note])]
        .filter(Boolean)
        .map(([l, n]) => h('p', { class: 'small tnotes' }, h('b', { text: l + ': ' }), linkify(n))),
    );
  const cards = sorted.map(t => {
    const I = tripInfo(t);
    const bt = t.budget ? budgetTone(I.total, t.budget) : '';
    return h(
      'section',
      { class: 'card tcard' + (t.on || t.kind === 'idea' ? '' : ' off') },
      h(
        'div',
        { class: 'card-h' },
        h(
          'div',
          { class: 'grow', style: 'min-width:0' },
          h('h2', null, t.name, ' ', t.kind === 'event' ? chip($t('event')) : null, chip(I.label, I.tone)),
          h('p', { text: t.kind === 'idea' ? $t('Someday') : tripWhen(t) }),
        ),
        h(
          'div',
          { class: 'acts' },
          sw(t),
          ibtn($t('Edit'), () => tripModal(t.id), 'sm', 'edit'),
          cardDel('trips', t.id),
        ),
      ),
      h(
        'div',
        { class: 'tiles' },
        tile($t('Cost'), money(I.total)),
        tile($t('Budget'), t.budget ? money(t.budget) : '–'),
        t.budget
          ? tile(
              I.total > t.budget ? $t('Over') : $t('Left to plan'),
              money(Math.abs(t.budget - I.total)),
              bt === 'over' ? 'bad' : bt === 'warn' ? 'warn' : 'good',
            )
          : tile($t('Paid in'), plural(I.by.size, 'month')),
      ),
      h('div', { style: t.budget ? '' : 'visibility:hidden' }, bar(t.budget ? (I.total / t.budget) * 100 : 0, bt)),
      h(
        'p',
        { class: 'tverdict ' + (I.tone === 'acc' ? '' : I.tone) },
        I.text,
        I.act ? [' ', btn(I.act[0], I.act[1], 'sm')] : null,
      ),
      keep(t.id + ':t', $t('Costs and notes'), details(t, I)),
    );
  });
  // "Does it fit?" sorts by how well it fits, best first: fits, tight, already short, too expensive, ideas, switched off
  const FIT_ORDER = { good: 0, warn: 1, bad: 2, acc: 3, '': 4 };
  const table = () =>
    dataTable({
      id: 'trips',
      rows: sorted.map(trip => ({ trip, info: tripInfo(trip) })),
      rowProps: row => ({ class: row.trip.on || row.trip.kind === 'idea' ? '' : 'dim' }),
      columns: [
        { label: $t('Name'), value: row => row.trip.name, cell: row => h('b', { text: row.trip.name }) },
        {
          label: $t('When'),
          value: row => (row.trip.kind === 'idea' ? null : D.parse(row.trip.from) || M.parse(row.trip.month) * 31),
          cell: row => (row.trip.kind === 'idea' ? $t('Someday') : tripWhen(row.trip)),
        },
        { label: $t('Cost'), value: row => row.info.total, cell: row => money(row.info.total) },
        {
          label: $t('Budget'),
          value: row => row.trip.budget || null,
          cell: row => (row.trip.budget ? money(row.trip.budget) : '–'),
        },
        {
          label: $t('Does it fit?'),
          value: row => FIT_ORDER[row.info.tone] ?? 4,
          cellProps: row => ({ title: row.info.text }),
          cell: row => [
            chip(row.info.label, row.info.tone),
            row.info.act ? [' ', btn(row.info.act[0], row.info.act[1], 'sm')] : null,
          ],
        },
        {
          label: '',
          cell: row =>
            h(
              'div',
              { class: 'acts', style: 'justify-content:flex-end' },
              sw(row.trip),
              ibtn($t('Edit'), () => tripModal(row.trip.id), 'sm', 'edit'),
              cardDel('trips', row.trip.id),
            ),
        },
      ],
    });
  return page(
    $t('Trips and events'),
    $t(
      'Trips, concerts, days out, and places you would like to go one day. Each one tells you whether your plan can pay for it.',
    ),
    [
      segc(
        [
          ['grid', $t('Cards')],
          ['list', $t('List')],
        ],
        Store.db.tripView,
        v => Store.setPref('tripView', v),
      ),
      btn($t('Someday idea'), () => tripModal(null, { kind: 'idea', on: false }), '', 'plus'),
      btn($t('Plan a trip'), () => tripModal(), 'primary', 'plus'),
    ],
    !sorted.length
      ? card(
          null,
          null,
          null,
          empty(
            $t('Nothing planned yet'),
            $t('Add a trip or an event, list what you will pay for, and pick the month each cost leaves your account.'),
            $t('Plan a trip'),
            () => tripModal(),
          ),
        )
      : list
        ? card(null, null, null, table())
        : h('div', { class: 'tgrid' }, cards),
  );
};
