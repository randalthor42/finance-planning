/**
 * @file Tools page: small calculators (hours of work, cost per use, savings growth, loan check, split a bill, unit price).
 */
import { M } from '../../core/dates.js';
import { FMT, fmtNum, money } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { pmt } from '../../core/util.js';
import { firstFit, roomSeries } from '../../logic/advice.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { dataTable } from '../components/dataTable.js';
import { card, page } from '../components/layout.js';
import { moneyInp } from '../components/moneyInput.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { loanModal } from '../modals/loan.js';
import { wishModal } from '../modals/wish.js';
import { UI, curK, monthAt } from '../state.js';
import { V } from './registry.js';

export const TOOLS = [
  ['hours', $t('Hours of work')],
  ['afford', $t('When can I afford it?')],
  ['use', $t('Cost per use')],
  ['grow', $t('Savings growth')],
  ['loan', $t('Loan check')],
  ['split', $t('Split a bill')],
  ['unit', $t('Unit price')],
];
V.tools = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const summary = projection.summary;
  const currentMonth = curK();
  const T = UI.tools;
  const tab = TOOLS.some(x => x[0] === UI.ttab) ? UI.ttab : 'hours';
  const inc =
    monthAt(currentMonth)
      // regular income only: refunds and one-off money in are not what an hour of work earns
      .entries.filter(e => e.key.startsWith('inc:'))
      .reduce((a, e) => a + e.amount, 0) || summary.avgInc;
  const rate = inc / plan.settings.hoursMonth;
  const hrs = v => {
    const x = rate > 0 ? v / rate : 0;
    const hh = Math.floor(x);
    const mm = Math.round((x - hh) * 60);
    return rate > 0 ? $t('{0} h {1} min', hh, mm) : '–';
  };
  const days = v => (rate > 0 ? $t('{0} working days', fmtNum(Math.round((v / rate / 8) * 10) / 10)) : '');
  const out = h('div', { class: 'preview' });
  const two = (...x) => h('div', { class: 'form', style: 'margin-bottom:10px' }, x);
  const fld = (label, k, ph, o) =>
    h(
      'label',
      { class: 'fld half' },
      h('span', { class: 'fld-l', text: label }),
      moneyInp({
        value: T[k],
        ph: ph || '0',
        onInput: n => {
          T[k] = n;
          upd();
        },
        ...o,
      }),
    );
  let upd = () => {};
  const tools = {
    hours: () => {
      const things = [
        ...plan.wishes.map(w => [w.name, w.price, $t('Wishlist')]),
        ...plan.trips.map(t => [t.name, t.items.reduce((a, i) => a + i.amount, 0), $t('Trip')]),
        ...monthAt(currentMonth)
          .entries.filter(e => e.key.startsWith('item:') && e.amount < 0)
          .map(e => [e.label, -e.amount, $t('Bought this month')]),
        ...plan.bills
          .filter(b => b.cat === 'subs')
          .map(b => [$t('{0} (a year)', b.name), (b.amount / b.every) * 12, $t('Subscription')]),
      ].filter(x => x[1] > 0);
      const hm = h('input', {
        class: 'inp num',
        type: 'number',
        min: 1,
        max: 744,
        step: 1,
        value: plan.settings.hoursMonth,
        'aria-label': $t('Hours you work in a month'),
        onchange: () => Actions.settings(plan.name, { hoursMonth: parseFloat(hm.value) || 160 }),
      });
      const nm = h('input', {
        class: 'inp',
        type: 'text',
        maxlength: 60,
        placeholder: $t('What'),
        value: T.name,
        oninput: () => {
          T.name = nm.value;
          upd();
        },
      });
      upd = () => {
        out.textContent =
          T.price > 0
            ? $t('{0} costs you {1} of work, about {2}.', T.name || $t('That'), hrs(T.price), days(T.price))
            : $t('Type a price to see it in hours of your life.');
      };
      return card(
        $t('What does it cost in hours of work?'),
        $t('{0} a month ÷ {1} hours = {2} an hour.', money(inc), fmtNum(plan.settings.hoursMonth), money(rate)),
        h(
          'label',
          { class: 'fld', style: 'width:120px' },
          h('span', { class: 'fld-l', text: $t('Hours a month') }),
          hm,
        ),
        two(
          h('label', { class: 'fld half' }, h('span', { class: 'fld-l', text: $t('What') }), nm),
          fld($t('Price'), 'price'),
        ),
        out,
        things.length
          ? h(
              'div',
              { style: 'margin-top:12px' },
              dataTable({
                id: 'tools-hours',
                rows: things.map(([name, price, source]) => ({ name, price, source })),
                maxHeight: '340px',
                columns: [
                  { label: $t('From your plan'), value: row => row.name, cell: row => row.name },
                  { label: $t('Source'), align: 'left', value: row => row.source, cell: row => row.source },
                  { label: $t('Price'), value: row => row.price, cell: row => money(row.price) },
                  { label: $t('Work time'), value: row => row.price, cell: row => h('b', { text: hrs(row.price) }) },
                  { label: '', cell: row => days(row.price), cellProps: () => ({ class: 'muted' }) },
                ],
              }),
            )
          : null,
      );
    },
    afford: () => {
      const fit = h('div', { class: 'notes' });
      upd = () => {
        const room = roomSeries(projection, plan.settings.cushion);
        const k = T.cost > 0 ? firstFit(projection, plan.settings.cushion, T.cost, currentMonth) : null;
        fit.replaceChildren(
          !(T.cost > 0)
            ? h('p', { class: 'muted', text: $t('Type an amount.') })
            : h(
                'div',
                { class: 'note ' + (k === null ? 'warn' : k === currentMonth ? 'good' : 'info') },
                icon(k === null ? 'alert' : 'check'),
                h('div', {
                  class: 'grow',
                  text:
                    k === null
                      ? $t(
                          'Not within your plan. The most you can spare in any month is {0}.',
                          money(Math.max(0, ...room)),
                        )
                      : k === currentMonth
                        ? $t(
                            'Now. You can spend {0} this month and no later month drops under your cushion.',
                            money(T.cost),
                          )
                        : $t('From {0}. Before that, a later month would drop under your cushion.', M.label(k, true)),
                }),
                k !== null
                  ? btn(
                      $t('Add to wishlist'),
                      () => wishModal(null, { price: T.cost, flex: false, month: M.key(k), how: 'cash' }),
                      'sm',
                    )
                  : null,
              ),
        );
      };
      return card(
        $t('When can I afford it?'),
        $t('The earliest month a one-off cost fits without any later month dropping under your cushion.'),
        null,
        two(fld($t('Amount'), 'cost', 'e.g. 300')),
        fit,
      );
    },
    use: () => {
      upd = () => {
        out.textContent =
          T.uPrice > 0 && T.uses > 0
            ? $t(
                '{0} {1} per use. In work time: {2} each time.',
                fmtNum(T.uPrice / T.uses),
                FMT.cur,
                hrs(T.uPrice / T.uses),
              )
            : $t('Price and how many times you expect to use it.');
      };
      return card(
        $t('Cost per use'),
        $t('A dear thing you use daily can be cheaper than a bargain you use twice.'),
        null,
        two(fld($t('Price'), 'uPrice'), fld($t('Times used'), 'uses')),
        out,
      );
    },
    grow: () => {
      upd = () => {
        const r = (T.gRate || 0) / 1200;
        const n = Math.round((T.gYears || 0) * 12);
        const put = (T.gStart || 0) + (T.gMonthly || 0) * n;
        const fv = (T.gStart || 0) * Math.pow(1 + r, n) + (T.gMonthly || 0) * (r ? (Math.pow(1 + r, n) - 1) / r : n);
        out.textContent =
          n > 0
            ? $t(
                'After {0} years you would have {1}: {2} you put in and {3} interest.',
                fmtNum(T.gYears),
                money(fv),
                money(put),
                money(fv - put),
              )
            : $t('How much, how often, how long.');
      };
      return card(
        $t('Savings growth'),
        $t('What regular saving adds up to, with interest on top.'),
        null,
        two(
          fld($t('Start with'), 'gStart'),
          fld($t('Add each month'), 'gMonthly'),
          fld($t('Interest (% a year)'), 'gRate'),
          fld($t('Years'), 'gYears'),
        ),
        out,
      );
    },
    loan: () => {
      upd = () => {
        const n = Math.round(T.lMonths || 0);
        const pay = T.lAmount > 0 && n > 0 ? pmt(T.lAmount, (T.lRate || 0) / 1200, n) : 0;
        const room = roomSeries(projection, plan.settings.cushion);
        out.textContent = pay
          ? $t(
              '{0} a month for {1}. You pay back {2}, of which {3} is interest. ',
              money(pay),
              plural(n, 'month'),
              money(pay * n),
              money(pay * n - T.lAmount),
            ) +
            (Math.min(...room.slice(currentMonth - summary.s0)) >= 0 && summary.avgNet >= pay
              ? $t('Your plan leaves about {0} a month, so the payment fits.', money(summary.avgNet))
              : $t('Your plan leaves about {0} a month, so this payment would be a strain.', money(summary.avgNet)))
          : $t('Amount, interest rate and number of months.');
      };
      return card(
        $t('Loan check'),
        $t('A quick look at any loan offer before you add it to your plan.'),
        null,
        two(fld($t('Amount'), 'lAmount'), fld($t('Interest (% a year)'), 'lRate'), fld($t('Months'), 'lMonths')),
        out,
        h(
          'div',
          { class: 'acts', style: 'margin-top:10px' },
          btn($t('Add it as a loan'), () => loanModal(), 'sm', 'plus'),
        ),
      );
    },
    split: () => {
      upd = () => {
        const tot = (T.sTotal || 0) * (1 + (T.sTip || 0) / 100);
        const n = Math.max(1, Math.round(T.sPeople || 1));
        out.textContent =
          T.sTotal > 0
            ? $t(
                '{0} {1} each for {2}. Total with tip: {3} {4}.',
                fmtNum(tot / n),
                FMT.cur,
                plural(n, 'person'),
                fmtNum(tot),
                FMT.cur,
              )
            : $t('The bill, how many of you, and a tip if you like.');
      };
      return card(
        $t('Split a bill'),
        null,
        null,
        two(fld($t('Bill'), 'sTotal'), fld($t('People'), 'sPeople', '2'), fld($t('Tip (%)'), 'sTip')),
        out,
      );
    },
    unit: () => {
      upd = () => {
        const a = T.aPrice > 0 && T.aQty > 0 ? T.aPrice / T.aQty : 0;
        const b = T.bPrice > 0 && T.bQty > 0 ? T.bPrice / T.bQty : 0;
        out.textContent =
          a && b
            ? Math.abs(a - b) < 1e-9
              ? $t('They cost the same per unit.')
              : $t(
                  '{0} is cheaper: {1} against {2} {3} per unit, {4}% less.',
                  a < b ? $t('The first') : $t('The second'),
                  fmtNum(Math.min(a, b)),
                  fmtNum(Math.max(a, b)),
                  FMT.cur,
                  Math.round((1 - Math.min(a, b) / Math.max(a, b)) * 100),
                )
            : $t('Price and size of two packs (grams, litres, pieces: any unit, the same for both).');
      };
      return card(
        $t('Unit price'),
        $t('Which pack is the better deal?'),
        null,
        two(
          fld($t('First: price'), 'aPrice'),
          fld($t('First: size'), 'aQty'),
          fld($t('Second: price'), 'bPrice'),
          fld($t('Second: size'), 'bQty'),
        ),
        out,
      );
    },
  };
  const body = tools[tab]();
  upd();
  return page(
    $t('Tools'),
    $t('Small calculators. The first two use the numbers in your plan. None of them changes anything.'),
    null,
    h(
      'div',
      { class: 'subnav', role: 'tablist' },
      TOOLS.map(x =>
        h('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': String(x[0] === tab),
          text: x[1],
          onclick: () => App.go('tools', { ttab: x[0] }),
        }),
      ),
    ),
    h('div', { style: 'max-width:760px' }, body),
  );
};
