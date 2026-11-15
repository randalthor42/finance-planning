/**
 * @file Plan settings window, and "roll forward" which moves the first month of the plan to today.
 */
import { M } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { SHIFTS } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { formModal } from '../components/form.js';
import { need } from '../helpers.js';
import { UI, monthAt, nowK } from '../state.js';

export function settingsModal() {
  const plan = Store.plan;
  formModal({
    title: $t('Plan settings'),
    wide: true,
    values: { name: plan.name, ...plan.settings, payDay: plan.settings.payDay || null, autosave: Store.db.autosave },
    fields: [
      { k: 'name', type: 'text', label: $t('Plan name'), max: 40 },
      { k: 'startMonth', type: 'month', label: $t('First month of the plan'), half: true },
      { k: 'horizon', type: 'num', label: $t('Months to plan ahead'), half: true, min: 3, max: 120, step: 1 },
      {
        k: 'opening',
        type: 'money',
        neg: true,
        blank: true,
        label: $t('Cash at the start'),
        half: true,
        info: $t(
          'What you had just before the first month of the plan began. It can be negative if you were overdrawn. To correct the plan to what you have today, use “What I have today” instead.',
        ),
      },
      {
        k: 'cushion',
        type: 'money',
        label: $t('Safety cushion'),
        half: true,
        info: $t('An amount you do not want to go under. Months that end below it are flagged as tight.'),
      },
      { type: 'sec', label: $t('Salary and budget months') },
      {
        k: 'payDay',
        type: 'num',
        blank: true,
        half: true,
        min: 1,
        max: 31,
        step: 1,
        ph: $t('Calendar months'),
        label: $t('Payday'),
        info: $t(
          'The day of the month your salary arrives. With a payday, each budget month runs from one salary to the day before the next. Leave empty to plan by calendar month.',
        ),
      },
      { k: 'payShift', type: 'select', half: true, label: $t('If payday is on a weekend'), options: SHIFTS },
      {
        k: 'payFor',
        type: 'select',
        label: $t('A salary pays for'),
        options: [
          ['next', $t('The month after it arrives')],
          ['same', $t('The month it arrives in')],
        ],
        info: $t(
          'With “the month after”, a salary on 26 October is November’s money and November runs from 26 October to 25 November. Either way a month ends the day before the next salary.',
        ),
      },
      { type: 'sec', label: $t('How things look and behave') },
      {
        k: 'currency',
        type: 'select',
        label: $t('Currency'),
        half: true,
        options: [
          'EUR',
          'USD',
          'GBP',
          'CHF',
          'RON',
          'RSD',
          'PLN',
          'CZK',
          'HUF',
          'BGN',
          'SEK',
          'NOK',
          'DKK',
          'TRY',
          'CAD',
          'AUD',
          'NZD',
          'JPY',
          'INR',
          'BRL',
          'MXN',
          'ZAR',
        ].map(c => [c, c]),
      },
      { k: 'cents', type: 'toggle', half: true, label: $t('Amounts'), text: $t('Show cents') },
      {
        k: 'numFmt',
        type: 'seg',
        half: true,
        label: $t('Numbers'),
        options: [
          ['eu', '1.234,56'],
          ['us', '1,234.56'],
        ],
      },
      {
        k: 'dateFmt',
        type: 'seg',
        half: true,
        label: $t('Dates'),
        options: [
          ['dmy', $t('26 Nov 2026')],
          ['mdy', $t('Nov 26, 2026')],
        ],
      },
    ],
    onSave: v =>
      need(v) ||
      ((UI.month = null), Actions.settings(v.name, { ...v, opening: v.opening || 0, payDay: v.payDay || 0 }), ''),
  });
}
export function rollModal() {
  const now = nowK();
  const summary = Store.proj.summary;
  const guess = now >= summary.s0 && now < summary.s0 + summary.n ? monthAt(now).open : Store.plan.settings.opening;
  formModal({
    title: $t('Roll the plan forward'),
    saveLabel: $t('Start from ') + M.label(now),
    values: { opening: guess },
    fields: [
      {
        k: 'opening',
        type: 'money',
        neg: true,
        blank: true,
        label: $t('Your real balance at the start of {0}', M.label(now, true)),
        hint: $t(
          'The plan will start from this month and this balance. Everything you planned for later months stays.',
        ),
      },
    ],
    onSave: v => (Actions.rollForward(M.key(now), v.opening || 0), (UI.month = null), ''),
  });
}
