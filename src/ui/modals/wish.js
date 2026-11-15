/**
 * @file Editing window for a wishlist item.
 */
import { M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { wishCalc } from '../../logic/wishes.js';
import { normPlan } from '../../models/plan.js';
import { Store } from '../../state/store.js';
import { NOTE, formModal } from '../components/form.js';
import { find, need, remove, upsert } from '../helpers.js';
import { curK } from '../state.js';

export function wishModal(id, preset) {
  const current = id && find('wishes', id);
  const s0 = Store.proj.summary.s0;
  formModal({
    auto: true,
    title: current ? $t('Edit wish') : $t('Add something you want'),
    values: current || {
      id: uid(),
      name: '',
      price: 0,
      how: 'cash',
      month: M.key(curK() + 3),
      months: 6,
      apr: 0,
      flex: true,
      on: false,
      note: '',
      link: '',
      ...preset,
    },
    fields: [
      { k: 'name', type: 'text', label: $t('What is it?'), ph: $t('A watch, a camera, a gaming PC…') },
      { k: 'price', type: 'money', label: $t('Price'), half: true, hint: $t('A rough guess is fine.') },
      {
        k: 'flex',
        type: 'toggle',
        half: true,
        live: true,
        label: $t('When'),
        text: $t('No date yet'),
        info: $t(
          'Leave this on if you do not know when you can afford it. The wishlist then works out the earliest month your plan can pay for it, and how.',
        ),
      },
      { k: 'month', type: 'month', label: $t('Month you want to buy it'), show: v => !v.flex },
      {
        k: 'how',
        type: 'seg',
        label: $t('How would you pay?'),
        show: v => !v.flex,
        options: [
          ['cash', $t('In one go')],
          ['save', $t('Save up first')],
          ['finance', $t('Finance it')],
        ],
      },
      {
        k: 'months',
        type: 'num',
        half: true,
        min: 1,
        max: 120,
        step: 1,
        label: $t('Months'),
        info: $t(
          'When saving up: how many months before buying you put money aside. When financing: the number of monthly instalments.',
        ),
      },
      {
        k: 'apr',
        type: 'num',
        half: true,
        min: 0,
        max: 60,
        step: 0.01,
        label: $t('Interest (% a year)'),
        info: $t('Use 0 if interest-free. Only know the monthly quote? Adjust until it matches.'),
      },
      { k: 'link', type: 'text', max: 300, label: $t('Link'), ph: 'https://…' },
      NOTE,
      {
        k: 'on',
        type: 'toggle',
        label: $t('Plan'),
        text: $t('Count it in my plan'),
        show: v => !v.flex,
        hint: $t('Off means it is only an idea and nothing in your plan changes.'),
      },
    ],
    preview: v => {
      if (!(v.price > 0) || v.flex || !v.month) {
        return '';
      }
      const c = wishCalc(normPlan({ wishes: [{ ...v, flex: false }] }).wishes[0], s0);
      if (c.how === 'cash' || !c.monthly) {
        return $t('{0} leaves your cash in {1}.', money(v.price), M.label(c.buyK));
      }
      if (c.how === 'save') {
        return $t(
          '{0} a month for {1}, then you buy it in {2}.',
          money(c.monthly),
          plural(c.rows.length, 'month'),
          M.label(c.buyK),
        );
      }
      if (c.extraCost > 0.5) {
        return $t(
          '{0} a month for {1} from {2}. Total {3}, of which {4} is interest.',
          money(c.monthly),
          plural(c.rows.length, 'month'),
          M.label(c.buyK),
          money(c.total),
          money(c.extraCost),
        );
      }
      return $t(
        '{0} a month for {1} from {2}. Total {3}, no interest.',
        money(c.monthly),
        plural(c.rows.length, 'month'),
        M.label(c.buyK),
        money(c.total),
      );
    },
    onSave: v =>
      need(v) ||
      (!(v.price > 0)
        ? $t('Enter a price above zero.')
        : v.link && !/^https?:\/\/\S+$/i.test(v.link.trim())
          ? $t('The link must start with http:// or https://')
          : (upsert('wishes', { ...v, link: (v.link || '').trim() }), '')),
    onDelete: current && (() => remove('wishes', id)),
  });
}
