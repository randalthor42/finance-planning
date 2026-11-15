/**
 * @file Plan settings window, and "roll forward" which moves the first month of the plan to today.
 */
import { M, Period } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { CATS, INCATS, SHIFTS } from '../../models/categories.js';
import { normPlan } from '../../models/plan.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { formModal } from '../components/form.js';
import { need } from '../helpers.js';
import { UI, monthAt, nowK } from '../state.js';
import { toast } from '../components/toast.js';

/** The fields of a plan's settings: shared by "Plan settings" and "New plan". */
const planFields = () => [
  { k: 'name', type: 'text', label: $t('Plan name'), max: 40 },
  { k: 'startMonth', type: 'month', label: $t('First month of the plan'), half: true },
  { k: 'horizon', type: 'num', label: $t('Months to plan ahead'), half: true, min: 3, max: 120, step: 1 },
  {
    k: 'opening',
    type: 'money',
    neg: true,
    blank: true,
    label: $t('Starting balance'),
    half: true,
    info: $t('Balance the day before the plan starts.'),
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
    info: $t('Your months run payday to payday. Leave empty for calendar months.'),
  },
  { k: 'payShift', type: 'select', half: true, label: $t('If payday is on a weekend'), options: SHIFTS },
  {
    k: 'payFor',
    type: 'select',
    label: $t('Salary covers'),
    options: [
      ['next', $t('The following month (paid 26 Oct → November)')],
      ['same', $t('The month it arrives')],
    ],
    info: $t(
      'With “the following month”, a salary on 26 October is November’s money and November runs from 26 October to 25 November. Either way a month ends the day before the next salary.',
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
];

export function settingsModal() {
  const plan = Store.plan;
  formModal({
    title: $t('Plan settings'),
    wide: true,
    values: { name: plan.name, ...plan.settings, payDay: plan.settings.payDay || null, autosave: Store.db.autosave },
    fields: planFields(),
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
    saveLabel: $t('Start from {0}', M.label(now)),
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

/** A new plan: ask for everything a plan needs up front, starting from the open plan's looks and payday. */
export function newPlanModal() {
  // the very first plan has nothing to copy the payday and formats from, so it starts from the defaults
  const first = !Store.plan;
  const settings = first ? normPlan({}).settings : Store.plan.settings;
  formModal({
    title: $t('New plan'),
    wide: true,
    saveLabel: $t('Create plan'),
    values: {
      name: first ? $t('My plan') : '',
      ...settings,
      startMonth: M.key(Period.now(settings)),
      opening: 0,
      cushion: 0,
      payDay: settings.payDay || null,
      incomeLines: [{ name: $t('Salary'), cat: 'salary', amount: 0 }],
      billLines: [{ name: $t('Rent'), cat: 'housing', amount: 0 }],
    },
    fields: [
      ...planFields(),
      { type: 'sec', label: $t('Money coming in each month (optional)') },
      {
        k: 'incomeLines',
        type: 'lines',
        label: $t('Income'),
        ph: $t('Salary'),
        cats: INCATS,
        add: $t('Add income'),
        hint: $t('Lines with no amount are left out. You can add and change everything later.'),
      },
      { type: 'sec', label: $t('Bills and living costs each month (optional)') },
      { k: 'billLines', type: 'lines', label: $t('Bills'), ph: $t('Rent'), cats: CATS, add: $t('Add a bill') },
    ],
    onSave: v => {
      const message = need(v);
      if (message) {
        return message;
      }
      const { name, incomeLines, billLines, ...rest } = v;
      const named = (rows, fallback) =>
        rows.filter(row => row.amount > 0).map(row => ({ ...row, name: row.name.trim() || fallback }));
      UI.month = null;
      if (first) {
        UI.view = 'overview';
      }
      const created = Store.addPlan({
        name: name.trim(),
        settings: { ...rest, opening: rest.opening || 0, payDay: rest.payDay || 0 },
        incomes: named(incomeLines, $t('Income')),
        bills: named(billLines, $t('Bill')),
      });
      if (!created) {
        toast($t('Plan limit reached'), { kind: 'bad' });
      }
      return '';
    },
  });
}

/** Rename any plan, open or not. */
export function renamePlanModal(id) {
  const plan = Store.db.plans[id];
  formModal({
    title: $t('Rename plan'),
    values: { name: plan.name },
    fields: [{ k: 'name', type: 'text', label: $t('Plan name'), max: 40 }],
    onSave: v => need(v) || (Store.renamePlan(id, v.name.trim()), ''),
  });
}
