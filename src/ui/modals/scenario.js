/**
 * @file A what-if scenario of the simulation (Forecast › Simulation): a name and up to eight changes, each from a
 * month on: income changes by a percentage, a new cost every month, a one-off purchase, or saving more (or less)
 * every month, into a savings goal or simply set aside. Only the simulation uses it: the plan is not changed.
 */
import { M } from '../../core/dates.js';
import { $t } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { CHANGE_KINDS } from '../../models/sim.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn, ibtn } from '../components/button.js';
import { modal } from '../components/modal.js';
import { moneyInp } from '../components/moneyInput.js';
import { monthField } from '../components/pickers.js';
import { h } from '../dom.js';
import { UI, nowK } from '../state.js';

const KIND_LABELS = () => ({
  income: $t('Income changes by'),
  cost: $t('A new cost every month'),
  oneoff: $t('A one-off purchase'),
  saving: $t('Save more (or less) every month'),
});

/**
 * Opens scenario `current` (or a new one). `created(id)` is called with the id of a new scenario once it is saved
 * (the page then compares with it).
 * @returns {void}
 */
export function scenarioModal(current, created) {
  const plan = Store.plan;
  const goals = plan.goals.filter(g => g.on);
  const s = current
    ? JSON.parse(JSON.stringify(current))
    : { id: uid(), name: '', changes: [{ kind: 'income', amount: 0, percent: -10, from: M.key(nowK()), goal: null }] };
  const err = h('div', { class: 'form-err', role: 'alert' });
  const rows = h('div', { class: 'sim-changes' });
  const name = h('input', {
    class: 'inp',
    type: 'text',
    maxlength: 60,
    value: s.name,
    placeholder: $t('A new car, a lower salary, saving more…'),
    'aria-label': $t('Name'),
    oninput: () => {
      s.name = name.value;
    },
  });
  const labels = KIND_LABELS();
  const draw = () =>
    rows.replaceChildren(
      ...s.changes.map((c, i) => {
        const kind = h(
          'select',
          {
            class: 'inp',
            'aria-label': $t('Change'),
            onchange: () => {
              c.kind = kind.value;
              draw();
            },
          },
          CHANGE_KINDS.map(k => h('option', { value: k, text: labels[k], selected: k === c.kind })),
        );
        const value =
          c.kind === 'income'
            ? h(
                'label',
                { class: 'sim-pct' },
                h('input', {
                  class: 'inp num',
                  type: 'number',
                  step: 1,
                  min: -100,
                  max: 1000,
                  value: c.percent,
                  'aria-label': $t('Percent'),
                  oninput: e => {
                    c.percent = Number(e.target.value) || 0;
                  },
                }),
                h('span', { text: '%' }),
              )
            : moneyInp({
                value: c.amount,
                neg: c.kind === 'saving',
                label: $t('Amount'),
                onInput: v => {
                  c.amount = v || 0;
                },
              });
        const goal =
          c.kind === 'saving' && goals.length
            ? h(
                'select',
                {
                  class: 'inp',
                  'aria-label': $t('Into'),
                  onchange: e => {
                    c.goal = e.target.value || null;
                  },
                },
                h('option', { value: '', text: $t('Set aside (no goal)'), selected: !c.goal }),
                goals.map(g => h('option', { value: g.id, text: g.name, selected: g.id === c.goal })),
              )
            : null;
        return h(
          'div',
          { class: 'sim-change' },
          kind,
          value,
          h('span', { class: 'muted small', text: c.kind === 'oneoff' ? $t('in') : $t('from') }),
          monthField({
            value: c.from,
            sm: true,
            onChange: v => {
              c.from = v;
            },
          }),
          goal,
          s.changes.length > 1
            ? ibtn(
                $t('Remove this change'),
                () => {
                  s.changes.splice(i, 1);
                  draw();
                },
                'ghost sm',
                'x',
              )
            : null,
        );
      }),
    );
  draw();
  const save = () => {
    if (!s.name.trim()) {
      err.textContent = $t('Give it a name.');
      return;
    }
    if (s.changes.some(c => !c.from)) {
      err.textContent = $t('Pick a month for every change.');
      return;
    }
    Actions.saveScenario(s);
    if (!current && created) {
      created(s.id);
    }
    d.close();
  };
  const d = modal({
    title: current ? $t('Edit the what-if') : $t('New what-if'),
    wide: true,
    err,
    body: h(
      'div',
      { class: 'form' },
      h('label', { class: 'fld' }, h('span', { class: 'fld-l', text: $t('Name') }), name),
      h(
        'div',
        { class: 'fld' },
        h('span', { class: 'fld-l', text: $t('Changes') }),
        rows,
        s.changes.length < 8
          ? btn(
              $t('Add a change'),
              () => {
                s.changes.push({ kind: 'cost', amount: 0, percent: 0, from: M.key(nowK()), goal: null });
                draw();
              },
              'sm ghost',
              'plus',
            )
          : null,
        h('span', {
          class: 'fld-h',
          text: $t('Your plan does not change: the simulation runs with and without these, side by side.'),
        }),
      ),
    ),
    foot: [
      current
        ? btn(
            $t('Delete'),
            () => {
              d.close();
              if (UI.simScenario === current.id) {
                UI.simScenario = null;
              }
              Actions.removeScenario(current.id);
            },
            'danger ghost',
            'trash',
          )
        : null,
      h('span', { class: 'sp' }),
      btn($t('Cancel'), () => d.close(), 'ghost'),
      btn($t('Save'), save, 'primary'),
    ],
  });
  name.focus();
}
