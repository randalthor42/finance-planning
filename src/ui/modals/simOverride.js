/**
 * @file Your own values for something the simulation learned (Forecast › Simulation): a category of everyday spending,
 * the large irregular expenses, or an income. Empty fields keep what was learned; "Use what was learned" forgets
 * every own value of it. Saved in the plan (plan.sim, models/sim.js) and written down in the activity log.
 */
import { $t } from '../../core/i18n.js';
import { CAT_NAME } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { formModal } from '../components/form.js';
import { rough } from '../simFormat.js';

const pct = v => (v === undefined || v === null ? null : Math.round(v * 1000) / 10);
const share = v => (v === null || v === undefined || v === '' ? undefined : Math.min(1, Math.max(0, v / 100)));
/** Only what was filled in: an empty field means "as learned". */
const filled = o =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false));

/**
 * @param {'cats'|'events'|'incomes'} section
 * @param {?string} key the category, or the income's id
 * @param {object} model what was learned (logic/sim/fit.js)
 * @returns {HTMLElement} the open window
 */
export function simOverrideModal(section, key, model) {
  const sim = Store.plan.sim;
  const reset = [[$t('Use what was learned'), () => Actions.setSimOverride(section, key, null)]];
  if (section === 'cats') {
    const c = model.cats.find(x => x.cat === key);
    const o = sim.cats[key] || {};
    const spread = c.basis === 'history' ? c.stats.mad : null;
    return formModal({
      title: $t('Your values for {0}', CAT_NAME[key] || key),
      values: { median: o.median ?? null, spread: o.spread ?? null, off: !!o.off },
      fields: [
        {
          k: 'median',
          type: 'money',
          blank: true,
          half: true,
          label: $t('A usual month'),
          ph: rough(c.center),
          hint: $t('Learned: {0} (the median month).', rough(c.center)),
        },
        {
          k: 'spread',
          type: 'money',
          blank: true,
          half: true,
          label: $t('How much it varies'),
          ph: spread !== null ? rough(spread) : $t('wide'),
          info: $t(
            'The usual distance of a month from the usual month (median absolute deviation). Double it and the simulated months spread twice as far, keeping the shape of your real months.',
          ),
        },
        { k: 'off', type: 'toggle', label: $t('Simulation'), text: $t('Leave this category out') },
      ],
      extra: reset,
      onSave: v => (Actions.setSimOverride('cats', key, Object.keys(filled(v)).length ? filled(v) : null), ''),
    });
  }
  if (section === 'events') {
    const e = model.events;
    const o = sim.events;
    return formModal({
      title: $t('Large irregular expenses'),
      values: { perYear: o.perYear ?? null, size: o.size ?? null, off: !!o.off },
      fields: [
        {
          k: 'perYear',
          type: 'num',
          blank: true,
          half: true,
          min: 0,
          max: 100,
          step: 0.1,
          label: $t('How many a year'),
          ph: String(e.perYear),
        },
        {
          k: 'size',
          type: 'money',
          blank: true,
          half: true,
          label: $t('Typical size'),
          ph: e.typical ? rough(e.typical) : '',
        },
        { k: 'off', type: 'toggle', label: $t('Simulation'), text: $t('Leave them out') },
      ],
      extra: reset,
      onSave: v => (Actions.setSimOverride('events', null, Object.keys(filled(v)).length ? filled(v) : null), ''),
    });
  }
  const income = model.incomes.find(i => i.id === key);
  const o = sim.incomes[key] || {};
  return formModal({
    title: $t('Your values for {0}', income.name),
    values: {
      mode: o.mode || '',
      spread: pct(o.spread),
      delay: pct(o.delay),
      cutChance: pct(o.cutChance),
      cutPct: pct(o.cutPct),
      raiseChance: pct(o.raiseChance),
      raisePct: pct(o.raisePct),
    },
    fields: [
      {
        k: 'mode',
        type: 'seg',
        label: $t('This income is'),
        options: [
          ['', $t('As learned')],
          ['fixed', $t('Fixed')],
          ['variable', $t('Varies')],
        ],
        live: true,
      },
      {
        k: 'spread',
        type: 'num',
        blank: true,
        min: 0,
        max: 100,
        step: 1,
        label: $t('How much it varies (%)'),
        ph: String(Math.round(income.spread * 100)),
        show: v => (v.mode || income.mode) === 'variable',
      },
      {
        k: 'delay',
        type: 'num',
        blank: true,
        half: true,
        min: 0,
        max: 100,
        step: 1,
        label: $t('Chance a payment is late (%)'),
        hint: $t('It then arrives the month after.'),
      },
      { k: 'sec', type: 'sec', label: $t('A lasting change') },
      {
        k: 'cutChance',
        type: 'num',
        blank: true,
        half: true,
        min: 0,
        max: 100,
        step: 1,
        label: $t('Chance of a cut, per year (%)'),
      },
      { k: 'cutPct', type: 'num', blank: true, half: true, min: 0, max: 90, step: 1, label: $t('Cut by (%)') },
      {
        k: 'raiseChance',
        type: 'num',
        blank: true,
        half: true,
        min: 0,
        max: 100,
        step: 1,
        label: $t('Chance of a raise, per year (%)'),
      },
      { k: 'raisePct', type: 'num', blank: true, half: true, min: 0, max: 100, step: 1, label: $t('Raise by (%)') },
    ],
    extra: reset,
    onSave: v => {
      const value = filled({
        mode: v.mode || undefined,
        spread: share(v.spread),
        delay: share(v.delay),
        cutChance: share(v.cutChance),
        cutPct: share(v.cutPct),
        raiseChance: share(v.raiseChance),
        raisePct: share(v.raisePct),
      });
      Actions.setSimOverride('incomes', key, Object.keys(value).length ? value : null);
      return '';
    },
  });
}
