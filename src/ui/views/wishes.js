/**
 * @file Wishlist page: what you want, how you would pay, and when the plan can afford it.
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { firstFit, roomSeries } from '../../logic/advice.js';
import { project } from '../../logic/projection.js';
import { wishCalc } from '../../logic/wishes.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { linkify } from '../components/info.js';
import { dataTable } from '../components/dataTable.js';
import { card, cardDel, chip, empty, page, row, segc } from '../components/layout.js';
import { h } from '../dom.js';
import { wishModal } from '../modals/wish.js';
import { curK } from '../state.js';
import { memo } from '../memo.js';
import { V } from './registry.js';

V.wishes = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const summary = projection.summary;
  const cush = plan.settings.cushion;
  const HOW = { cash: $t('Pay in one go'), save: $t('Save up first'), finance: $t('Finance it') };
  const currentMonth = curK();
  // what-if projections, cached until the plan changes (folding, switching Cards/List or sorting reuses them)
  const run = (others, Wd, how, month) =>
    memo(`wish-run:${Wd.id}:${how}:${month}`, [], () =>
      project({ ...plan, wishes: [...others, { ...Wd, how, month, flex: false, on: true }] }, { today: Store.day }),
    );
  const verdict = (R, base) => {
    const neg = R.months.filter((m, i) => m.status === 'neg' && base.months[i].status !== 'neg').length;
    const tight = R.months.filter((m, i) => m.status === 'tight' && base.months[i].status === 'ok').length;
    return neg
      ? ['bad', $t('{0} below zero', plural(neg, 'month'))]
      : tight
        ? ['warn', $t('{0} under your cushion', plural(tight, 'month'))]
        : ['good', $t('fits')];
  };
  const status = Wd => (Wd.flex ? $t('no date yet') : Wd.on ? $t('in my plan') : $t('just an idea'));
  const cards = plan.wishes.map(Wd => {
    const others = plan.wishes.filter(x => x.id !== Wd.id);
    const base = memo('wish-base:' + Wd.id, [], () => project({ ...plan, wishes: others }, { today: Store.day }));
    const at = (R, k) => R.months[clamp(k - summary.s0, 0, summary.n - 1)];
    const sw = h('input', {
      type: 'checkbox',
      checked: Wd.on,
      'aria-label': $t('Count this in my plan'),
      onchange: () => Actions.toggle('wishes', Wd.id, sw.checked),
    });
    let rows;
    if (Wd.flex) {
      // No date yet: find the earliest month each way of paying works without breaking the plan.
      // one projection per candidate month: only the answer is cached, not every candidate
      const earliest = how =>
        memo(`wish-earliest:${Wd.id}:${how}`, [currentMonth], () => {
          for (let k = how === 'save' ? currentMonth + 2 : currentMonth; k <= summary.endK; k++) {
            const candidate = { ...Wd, how, month: M.key(k), flex: false, on: true };
            const projectionWith = project({ ...plan, wishes: [...others, candidate] }, { today: Store.day });
            if (verdict(projectionWith, base)[0] === 'good') {
              return k;
            }
          }
          return null;
        });
      rows = ['cash', 'save', 'finance'].map(how => {
        const k = how === 'cash' ? firstFit(base, cush, Wd.price, currentMonth) : earliest(how);
        const c = k === null ? null : wishCalc({ ...Wd, month: M.key(k) }, summary.s0, how);
        const description =
          k === null
            ? $t('Does not fit anywhere in your plan yet.')
            : how === 'cash'
              ? $t(
                  'Earliest: {0}. You would still end that month with {1}.',
                  M.label(k, true),
                  money(at(base, k).close - Wd.price),
                )
              : how === 'save'
                ? $t(
                    'Put aside {0} a month for {1} and buy it in {2}.',
                    money(c.monthly),
                    plural(c.rows.length, 'month'),
                    M.label(k, true),
                  )
                : $t(
                    '{0} a month for {1} from {2}{3}.',
                    money(c.monthly),
                    plural(c.rows.length, 'month'),
                    M.label(k, true),
                    c.extraCost > 0.5 ? $t(', {0} interest', money(c.extraCost)) : $t(', no interest'),
                  );
        return row({
          title: HOW[how],
          cls: 'wrap',
          desc: description,
          chips: chip(k === null ? $t('not yet') : $t('fits'), k === null ? 'warn' : 'good'),
          right:
            k === null
              ? null
              : btn(
                  $t('Plan it'),
                  () =>
                    Actions.patch(
                      'wishes',
                      Wd.id,
                      { flex: false, month: M.key(k), how, on: true },
                      $t('Planned “{0}” for {1}', Wd.name, M.label(k)),
                    ),
                  'sm',
                ),
        });
      });
    } else {
      const bk = M.parse(Wd.month);
      rows = ['cash', 'save', 'finance'].map(how => {
        const c = wishCalc(Wd, summary.s0, how);
        const R = run(others, Wd, how, Wd.month);
        const v = verdict(R, base);
        const mb = at(R, bk);
        const first = c.rows[0].k;
        const last = c.rows[c.rows.length - 1].k;
        const description =
          (c.how === 'cash'
            ? $t('{0} leaves your cash in {1}. ', money(Wd.price), M.label(bk, true))
            : c.how === 'save'
              ? $t('{0} a month from {1} to {2}, then you buy it. ', money(c.monthly), M.label(first), M.label(last))
              : $t(
                  '{0} a month from {1} to {2}{3}. ',
                  money(c.monthly),
                  M.label(first),
                  M.label(last),
                  c.extraCost > 0.5 ? $t(', {0} of it interest', money(c.extraCost)) : '',
                )) +
          $t('{0} would end at {1} instead of {2}.', M.label(bk), money(mb.close), money(at(base, bk).close)) +
          (v[0] !== 'good' ? $t(' Tightest month: {0} at {1}.', M.label(R.summary.minK), money(R.summary.min)) : '');
        return row({
          title: how === 'save' && c.how !== 'save' ? $t('{0} (no months left to save)', HOW[how]) : HOW[how],
          cls: 'wrap' + (how === Wd.how ? ' chosen' : ''),
          desc: description,
          chips: chip(v[1], v[0]),
          right:
            how === Wd.how
              ? chip($t('chosen'), 'acc')
              : btn(
                  $t('Choose'),
                  () => Actions.patch('wishes', Wd.id, { how }, `“${Wd.name}”: ${HOW[how].toLowerCase()}`),
                  'sm',
                ),
        });
      });
    }
    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-h' },
        h(
          'div',
          { style: 'min-width:0' },
          h('h2', null, Wd.name, ' ', chip(status(Wd), Wd.on ? 'acc' : '')),
          h(
            'p',
            null,
            `${money(Wd.price)} · ${Wd.flex ? $t('whenever it fits') : M.label(M.parse(Wd.month), true)}`,
            Wd.link ? [' · ', linkify(Wd.link)] : null,
          ),
        ),
        h(
          'div',
          { class: 'acts' },
          Wd.flex ? null : h('label', { class: 'switch', title: $t('Count it in my plan') }, sw),
          ibtn($t('Edit'), () => wishModal(Wd.id), 'sm', 'edit'),
          cardDel('wishes', Wd.id),
        ),
      ),
      Wd.note ? h('p', { class: 'small tnotes' }, linkify(Wd.note)) : null,
      h('div', { class: 'rows' }, rows),
      Wd.flex
        ? null
        : h(
            'p',
            { class: 'small muted', style: 'margin-top:8px' },
            Wd.on
              ? $t('It is counted in your plan: you can see it in the month planner and the forecast. ')
              : $t('It is not counted yet. Switch it on to see it in the month planner and the forecast. '),
          ),
      Wd.flex
        ? null
        : h(
            'div',
            null,
            btn(
              $t('See it in {0}', M.label(M.parse(Wd.month))),
              () => App.go('months', { month: M.parse(Wd.month) }),
              'sm ghost',
              'calendar',
            ),
          ),
    );
  });
  const on = plan.wishes.filter(w => w.on);
  const list = Store.db.wishView === 'list';
  const table = () =>
    dataTable({
      id: 'wishes',
      rows: plan.wishes,
      rowProps: Wd => ({ class: Wd.on || Wd.flex ? '' : 'dim' }),
      columns: [
        { label: $t('Name'), value: Wd => Wd.name, cell: Wd => h('b', { text: Wd.name }) },
        { label: $t('Price'), value: Wd => Wd.price, cell: Wd => money(Wd.price) },
        {
          label: $t('When'),
          value: Wd => (Wd.flex ? null : M.parse(Wd.month)),
          cell: Wd => (Wd.flex ? $t('whenever it fits') : M.label(M.parse(Wd.month), true)),
        },
        { label: $t('How'), value: Wd => (Wd.flex ? null : HOW[Wd.how]), cell: Wd => (Wd.flex ? '–' : HOW[Wd.how]) },
        {
          label: $t('Status'),
          value: Wd => (Wd.flex ? 2 : Wd.on ? 0 : 1),
          cell: Wd => chip(status(Wd), Wd.on ? 'acc' : ''),
        },
        {
          label: '',
          cell: Wd => {
            const box = h('input', {
              type: 'checkbox',
              checked: Wd.on,
              'aria-label': $t('Count this in my plan'),
              onchange: () => Actions.toggle('wishes', Wd.id, box.checked),
            });
            return h(
              'div',
              { class: 'acts', style: 'justify-content:flex-end' },
              Wd.flex ? null : h('label', { class: 'switch', title: $t('Count it in my plan') }, box),
              ibtn($t('Edit'), () => wishModal(Wd.id), 'sm', 'edit'),
              cardDel('wishes', Wd.id),
            );
          },
        },
      ],
    });
  return page(
    $t('Wishlist'),
    $t('Things you want, and the best month to buy them. Nothing counts until you switch it on.'),
    [
      segc(
        [
          ['grid', $t('Cards')],
          ['list', $t('List')],
        ],
        Store.db.wishView,
        v => Store.setPref('wishView', v),
      ),
      btn($t('Add a wish'), () => wishModal(), 'primary', 'plus'),
    ],
    cards.length
      ? [
          h(
            'div',
            { class: 'kpis' },
            h(
              'div',
              { class: 'kpi' },
              h('div', { class: 'l', text: $t('Everything on the list') }),
              h('div', { class: 'v', text: money(plan.wishes.reduce((a, w) => a + w.price, 0)) }),
              h('div', { class: 's', text: plural(plan.wishes.length, 'wish') }),
            ),
            h(
              'div',
              { class: 'kpi' },
              h('div', { class: 'l', text: $t('Counted in your plan') }),
              h('div', { class: 'v', text: money(on.reduce((a, w) => a + projection.wishes[w.id].total, 0)) }),
              h('div', { class: 's', text: $t('{0} of {1} switched on', on.length, plan.wishes.length) }),
            ),
            h(
              'div',
              { class: 'kpi' },
              h('div', { class: 'l', text: $t('Safe to spend now') }),
              h('div', {
                class: 'v',
                text: money(Math.max(0, roomSeries(projection, cush)[currentMonth - summary.s0])),
              }),
              h('div', { class: 's', text: $t('without any later month going under your cushion') }),
            ),
          ),
          list ? card(null, null, null, table()) : h('div', { class: 'cols' }, cards),
        ]
      : card(
          null,
          null,
          null,
          empty(
            $t('Nothing on your wishlist'),
            $t(
              'Add a camera, a laptop, a watch. A rough price is enough: you will see when you can afford it and whether to save or finance.',
            ),
            $t('Add a wish'),
            () => wishModal(),
          ),
        ),
  );
};
