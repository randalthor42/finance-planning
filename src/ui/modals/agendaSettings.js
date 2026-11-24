/**
 * @file "Customise your calendar" (My calendar): its name, the person's own calendars and their colours, what of the
 * plan it shows (layers and spending categories), and the number on each day. Every change is saved at once, like the
 * calendar settings, and everything changed while the window is open is one step for Undo.
 */
import { $t, plural } from '../../core/i18n.js';
import { uid } from '../../core/util.js';
import { AGENDA_MAX, AGENDA_TONES } from '../../models/agenda.js';
import { CATS } from '../../models/categories.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn, ibtn } from '../components/button.js';
import { PLAN_GROUPS } from '../components/calendarData.js';
import { confirmModal, modal } from '../components/modal.js';
import { h } from '../dom.js';

const TONE_NAMES = () => ({
  acc: $t('Blue'),
  good: $t('Green'),
  trip: $t('Purple'),
  wish: $t('Pink'),
  save: $t('Teal'),
  debt: $t('Orange'),
  warn: $t('Amber'),
  bad: $t('Red'),
  cash: $t('Sky blue'),
  muted: $t('Grey'),
});
const FIGURES = () => [
  ['balance', $t('Balance')],
  ['net', $t('Net')],
  ['spent', $t('Spent')],
  ['none', $t('Nothing')],
];

/** An on/off button of a set (a layer, a category), like the calendar's legend. */
const toggleButton = (focusKey, label, on, onClick, tone) =>
  h(
    'button',
    {
      type: 'button',
      class: 'cal-lg' + (tone ? ' cal-c-' + tone : ''),
      'aria-pressed': String(on),
      'data-focus': focusKey,
      onclick: onClick,
    },
    tone ? h('i', { class: 'cal-dot', 'aria-hidden': 'true' }) : null,
    h('span', { text: label }),
  );

/**
 * Opens "Customise your calendar" for the open plan (see the top of this file).
 * @returns {HTMLElement} the open window
 */
export function agendaSettingsModal() {
  // every change made in this window is one Undo step (Store.commit merges steps with the same tag)
  const tag = 'a' + uid();
  const body = h('div', { class: 'form agenda-set' });
  const change = fn => {
    const active = document.activeElement;
    const focusKey = active && body.contains(active) ? active.dataset.focus : null;
    Store.tag = tag;
    try {
      fn();
    } finally {
      Store.tag = null;
    }
    draw();
    const target = focusKey && body.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (target) {
      target.focus();
    }
  };
  const set = values => change(() => Actions.setAgenda(values));
  const section = (title, hint, ...content) =>
    h(
      'div',
      { class: 'fld' },
      h('span', { class: 'fld-l', text: title }),
      ...content,
      hint ? h('span', { class: 'fld-h', text: hint }) : null,
    );

  function draw() {
    const agenda = Store.plan.agenda;
    const names = TONE_NAMES();
    const name = h('input', {
      class: 'inp',
      type: 'text',
      value: agenda.name,
      maxlength: 40,
      placeholder: $t('My calendar'),
      'data-focus': 'name',
      onchange: () => set({ name: name.value }),
    });
    const calRow = cal => {
      const input = h('input', {
        class: 'inp',
        type: 'text',
        value: cal.name,
        maxlength: 40,
        'aria-label': $t('Name of the calendar'),
        'data-focus': 'cal:' + cal.id,
        onchange: () => set({ cals: agenda.cals.map(c => (c.id === cal.id ? { ...c, name: input.value } : c)) }),
      });
      const count = agenda.entries.filter(e => e.cal === cal.id).length;
      return h(
        'div',
        { class: 'agenda-cal-r' },
        h('i', { class: 'cal-dot cal-c-' + cal.tone, 'aria-hidden': 'true' }),
        input,
        h(
          'div',
          { class: 'agenda-swatches', role: 'group', 'aria-label': $t('Colour of {0}', cal.name) },
          AGENDA_TONES.map(tone =>
            h('button', {
              type: 'button',
              class: 'agenda-sw cal-c-' + tone,
              'aria-pressed': String(cal.tone === tone),
              'aria-label': names[tone],
              title: names[tone],
              'data-focus': 'tone:' + cal.id + ':' + tone,
              onclick: () => set({ cals: agenda.cals.map(c => (c.id === cal.id ? { ...c, tone } : c)) }),
            }),
          ),
        ),
        agenda.cals.length > 1
          ? ibtn(
              $t('Delete the calendar {0}', cal.name),
              () => {
                const go = () => change(() => Actions.removeCal(cal.id));
                if (!count) {
                  return go();
                }
                confirmModal(
                  $t('Delete the calendar “{0}”?', cal.name),
                  $t('Its appointments ({0}) go with it. You can undo this afterwards.', plural(count, 'appointment')),
                  $t('Delete'),
                  go,
                );
              },
              'ghost sm',
              'trash',
            )
          : null,
      );
    };
    const addCal = () => {
      const used = new Set(agenda.cals.map(c => c.tone));
      const tone = AGENDA_TONES.find(t => !used.has(t)) || 'acc';
      set({ cals: [...agenda.cals, { id: uid(), name: $t('Calendar {0}', agenda.cals.length + 1), tone }] });
    };
    const layers = new Set(agenda.layers);
    const cats = new Set(agenda.cats);
    const figure = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': $t('Number on each day') },
      FIGURES().map(([key, label]) =>
        h('button', {
          type: 'button',
          'aria-pressed': String(agenda.figure === key),
          'data-focus': 'figure:' + key,
          text: label,
          onclick: () => set({ figure: key }),
        }),
      ),
    );
    body.replaceChildren(
      section($t('Name'), null, name),
      section(
        $t('Your calendars'),
        $t('Each has its own colour, and can be shown or hidden from the legend.'),
        h('div', { class: 'agenda-cals' }, agenda.cals.map(calRow)),
        agenda.cals.length < AGENDA_MAX.cals ? btn($t('Add a calendar'), addCal, 'sm ghost', 'plus') : null,
      ),
      section(
        $t('From your plan'),
        $t('Shown next to your appointments. Records you add one by one are always shown.'),
        h(
          'div',
          { class: 'cal-legend agenda-layers', role: 'group', 'aria-label': $t('From your plan') },
          PLAN_GROUPS.map(g =>
            toggleButton(
              'layer:' + g.key,
              g.label,
              layers.has(g.key),
              () =>
                set({ layers: layers.has(g.key) ? agenda.layers.filter(x => x !== g.key) : [...agenda.layers, g.key] }),
              g.tone,
            ),
          ),
        ),
      ),
      section(
        $t('Spending categories'),
        cats.size
          ? $t('Only bills, budgets and transactions of these categories are shown.')
          : $t('Every category is shown. Pick some to see only those.'),
        h(
          'div',
          { class: 'cal-legend agenda-cats', role: 'group', 'aria-label': $t('Spending categories') },
          CATS.map(([key, label]) =>
            toggleButton('cat:' + key, label, cats.has(key), () =>
              set({ cats: cats.has(key) ? agenda.cats.filter(x => x !== key) : [...agenda.cats, key] }),
            ),
          ),
          cats.size ? btn($t('Every category'), () => set({ cats: [] }), 'sm ghost') : null,
        ),
      ),
      section(
        $t('Number on each day'),
        $t('The end-of-day balance, the net or what was spent, as in the Month planner.'),
        figure,
      ),
    );
  }
  draw();
  const d = modal({
    title: $t('Customise your calendar'),
    wide: true,
    body,
    foot: [h('span', { class: 'sp' }), btn($t('Done'), () => d.close(), 'primary')],
  });
  return d;
}
