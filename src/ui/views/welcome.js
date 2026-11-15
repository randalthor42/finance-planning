/**
 * @file First screen when there is no plan yet.
 */
import { M, Period } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { samplePlan } from '../../models/samplePlan.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { moneyInp } from '../components/moneyInput.js';
import { h } from '../dom.js';
import { importFlow } from '../modals/backup.js';
import { V } from './registry.js';

V.welcome = () => {
  const v = { currency: 'EUR', opening: 0, salary: 0, payDay: 0 };
  const current = h(
    'select',
    {
      class: 'inp',
      onchange: () => {
        v.currency = current.value;
      },
    },
    ['EUR', 'USD', 'GBP', 'CHF', 'RON', 'RSD', 'PLN', 'SEK', 'CAD', 'AUD'].map(c => h('option', { value: c, text: c })),
  );
  const pd = h('input', {
    class: 'inp num',
    type: 'number',
    min: 1,
    max: 31,
    step: 1,
    placeholder: $t('Optional'),
    oninput: () => {
      v.payDay = clamp(parseInt(pd.value) || 0, 0, 31);
    },
  });
  const start = () => {
    const st = { currency: v.currency, opening: v.opening, payDay: v.payDay, payShift: 'next' };
    Store.addPlan({
      name: $t('My plan'),
      settings: { ...st, startMonth: M.key(Period.now(st)) },
      incomes: v.salary ? [{ name: $t('Salary'), amount: v.salary, cat: 'salary' }] : [],
    });
    App.go('overview');
  };
  return h(
    'div',
    { class: 'welcome' },
    h('h1', { text: $t('Plan your money, month by month.') }),
    h('p', {
      class: 'muted',
      style: 'margin-bottom:18px',
      text: $t(
        'Bills, budgets, one-offs, trips, loans and savings in one plan, so you can see what every decision does to your cash in the months ahead. Everything is stored in this browser only. Nothing is sent anywhere.',
      ),
    }),
    h(
      'form',
      {
        class: 'card form',
        onsubmit: e => {
          e.preventDefault();
          start();
        },
      },
      h(
        'label',
        { class: 'fld half' },
        h('span', { class: 'fld-l', text: $t('Cash you have right now') }),
        moneyInp({
          value: 0,
          onInput: n => {
            v.opening = n;
          },
        }),
      ),
      h(
        'label',
        { class: 'fld half' },
        h('span', { class: 'fld-l', text: $t('Monthly income after tax') }),
        moneyInp({
          value: 0,
          onInput: n => {
            v.salary = n;
          },
        }),
      ),
      h(
        'label',
        { class: 'fld half' },
        h('span', { class: 'fld-l', text: $t('Day of the month your salary arrives') }),
        pd,
      ),
      h('label', { class: 'fld half' }, h('span', { class: 'fld-l', text: $t('Currency') }), current),
      h('div', { class: 'fld' }, h('button', { type: 'submit', class: 'btn primary', text: $t('Start my plan') })),
    ),
    h(
      'div',
      { class: 'acts', style: 'margin-top:14px' },
      btn(
        $t('Look around with a sample plan'),
        () => {
          Store.addPlan(samplePlan());
          App.go('overview');
        },
        'ghost',
      ),
      btn($t('Import a backup'), importFlow, 'ghost', 'upload'),
    ),
  );
};
