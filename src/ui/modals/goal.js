/**
 * @file Editing window for a savings goal. Target, monthly amount and target date fill each other in.
 */
import { M } from '../../core/dates.js';
import { fmtNum, money } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { find, need, remove, upsert } from '../helpers.js';
import { curK } from '../state.js';

/**
 * Savings goal. Target, monthly amount and target month are linked: change one and the others follow.
 * `preset` fills in a new goal (for example the month it starts).
 */
export function goalModal(id, preset) {
  const current = id && find('goals', id);
  const s0 = Store.proj.summary.s0;
  const first = v => Math.max(M.parse(v.from) === null ? s0 : M.parse(v.from), curK());
  const gap = v => Math.max(0, (v.target || 0) - (v.saved || 0));
  const fromDate = v => {
    if (v.by && gap(v) > 0) {
      const n = Math.max(1, M.parse(v.by) - first(v) + 1);
      v.monthly = Math.ceil((gap(v) / n) * 100) / 100;
      return ['monthly'];
    }
    return [];
  };
  const fromMonthly = v => {
    if (v.monthly > 0 && gap(v) > 0) {
      v.by = M.key(Math.min(first(v) + Math.ceil(gap(v) / v.monthly) - 1, 2200 * 12));
      return ['by'];
    }
    return [];
  };
  formModal({
    auto: true,
    title: current ? $t('Edit savings goal') : $t('Add a savings goal'),
    values: current || {
      id: uid(),
      name: '',
      target: 0,
      saved: 0,
      monthly: 0,
      from: null,
      to: null,
      by: null,
      rate: 0,
      release: null,
      ...preset,
    },
    fields: [
      { k: 'name', type: 'text', label: $t('Name'), ph: $t('Emergency fund, new laptop, mortgage deposit…') },
      {
        k: 'target',
        type: 'money',
        label: $t('Target'),
        half: true,
        hint: $t('Leave empty to keep saving with no limit.'),
        then: v => (v.by ? fromDate(v) : fromMonthly(v)),
      },
      {
        k: 'saved',
        type: 'money',
        label: $t('Already saved'),
        half: true,
        then: v => (v.by ? fromDate(v) : fromMonthly(v)),
      },
      { type: 'sec', label: $t('Fill in one of these two and the other follows') },
      { k: 'monthly', type: 'money', label: $t('Put aside each month'), half: true, then: fromMonthly },
      {
        k: 'by',
        type: 'month',
        label: $t('Reach the target by'),
        empty: $t('No date in mind'),
        half: true,
        then: fromDate,
      },
      { type: 'sec', label: $t('Optional') },
      {
        k: 'rate',
        type: 'num',
        label: $t('Interest on these savings (% a year)'),
        half: true,
        min: 0,
        max: 30,
        step: 0.01,
      },
      {
        k: 'from',
        type: 'month',
        label: $t('Start saving'),
        empty: $t('From the start'),
        half: true,
        then: v => (v.by ? fromDate(v) : fromMonthly(v)),
      },
      { k: 'to', type: 'month', label: $t('Stop saving after'), empty: $t('When the target is reached'), half: true },
      {
        k: 'release',
        type: 'month',
        label: $t('Take the money out to spend it'),
        empty: $t('Keep it saved'),
        half: true,
        hint: $t('The pot returns to your cash in this month, ready for the purchase.'),
      },
      NOTE,
    ],
    preview: v => {
      if (!(v.monthly > 0)) {
        return gap(v) > 0 ? $t('Enter a monthly amount or a date.') : '';
      }
      const n = gap(v) > 0 ? Math.ceil(gap(v) / v.monthly) : 0;
      if (!n) {
        return $t('{0} a month comes out of every month from {1}.', money(v.monthly), M.label(first(v)));
      }
      return $t(
        '{0} a month comes out of every month from {1}, for about {2} ({3} years). It shows in your overview, month planner and forecast.',
        money(v.monthly),
        M.label(first(v)),
        plural(n, 'month'),
        fmtNum(Math.round((n / 12) * 10) / 10),
      );
    },
    onSave: v =>
      need(v) ||
      (!(v.target > 0) && !(v.monthly > 0)
        ? $t('Enter a target or a monthly amount.')
        : v.target > 0 && v.saved > v.target
          ? $t('You have already saved more than the target.')
          : (upsert('goals', v), '')),
    onDelete: current && (() => remove('goals', id)),
  });
}
