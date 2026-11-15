/**
 * @file Settings › Calendar: how the calendars on the Overview and in the Month planner look, and what their context
 * menus offer. The values live in Store.db.calendar (models/calendarPrefs.js), saved in this browser for every plan,
 * like the theme. Each change is saved at once; the menu options are read from calendarData.js, so the switches here
 * always match the menus.
 */
import { $t } from '../../core/i18n.js';
import { calendarDefaults } from '../../models/calendarPrefs.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { PLAN_GROUPS, addChoices, lineChoices } from '../components/calendarData.js';
import { card, segc } from '../components/layout.js';
import { confirmModal } from '../components/modal.js';
import { toast } from '../components/toast.js';
import { h } from '../dom.js';

/** Saves a change. The page is drawn again, so the focus goes back to the control that made the change. */
function save(change, focusKey) {
  Store.setPref('calendar', { ...Store.db.calendar, ...change });
  const target = focusKey && document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
  if (target) {
    target.focus();
  }
}

/** One setting: its name and what it does on the left, the control on the right (the Appearance rows). */
const option = (label, hint, control) =>
  h(
    'div',
    { class: 'row opt' },
    h(
      'div',
      { class: 'grow' },
      h('div', { class: 't', text: label }),
      hint ? h('div', { class: 'd', text: hint }) : null,
    ),
    control,
  );

/** An on/off switch. */
const toggle = (focusKey, label, checked, onChange) =>
  h(
    'label',
    { class: 'switch' },
    h('input', {
      type: 'checkbox',
      checked,
      'aria-label': label,
      'data-focus': focusKey,
      onchange: event => onChange(event.target.checked),
    }),
  );

/** A tick box with its name, one tile of a grid of choices (the day menu). */
const pick = (focusKey, label, checked, onChange) =>
  h(
    'label',
    { class: 'cal-pick' },
    h('input', {
      type: 'checkbox',
      class: 'check',
      checked,
      'data-focus': focusKey,
      onchange: event => onChange(event.target.checked),
    }),
    h('span', { text: label }),
  );

/** One choice out of a few (a segmented control), named for screen readers. */
function choice(focusKey, label, options, current, onPick) {
  const control = segc(options, current, value => onPick(value, focusKey + ':' + value));
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', label);
  [...control.children].forEach((button, i) => {
    button.dataset.focus = focusKey + ':' + options[i][0];
  });
  return control;
}

/** The line under "Use context menus" while they are off: what a right click and "+" do then. */
function menusHint(prefs) {
  if (prefs.menus) {
    return null;
  }
  return prefs.add.expense
    ? $t('Off: “+” adds an expense, and a right click shows the browser’s own menu.')
    : $t('Off: a right click shows the browser’s own menu.');
}
/** The cards of Settings › Calendar: general look, the Overview calendar, the Month planner calendar, the menus. */
export function calendarSettingsCards() {
  const prefs = Store.db.calendar;
  const set = (key, value, focusKey) => save({ [key]: value }, focusKey || key);

  const general = card(
    $t('Calendar'),
    $t('For the calendars on the Overview and in the Month planner. Saved in this browser, for every plan.'),
    btn(
      $t('Reset'),
      // settings have no Undo: ask before putting every choice back
      () =>
        confirmModal(
          $t('Reset the calendar settings?'),
          $t('Every calendar setting on this page goes back to how it started, in this browser.'),
          $t('Reset'),
          () => {
            Store.setPref('calendar', calendarDefaults());
            toast($t('Calendar settings are back to how they started.'));
          },
          'primary',
        ),
      'sm ghost',
    ),
    h(
      'div',
      { class: 'rows' },
      option(
        $t('Week starts on'),
        null,
        choice(
          'weekStart',
          $t('Week starts on'),
          [
            [1, $t('Monday')],
            [0, $t('Sunday')],
          ],
          prefs.weekStart,
          (value, focusKey) => set('weekStart', value, focusKey),
        ),
      ),
      option(
        $t('Always six weeks'),
        $t('Every month takes the same height, so the page does not jump when you change month.'),
        toggle('fixedWeeks', $t('Always six weeks'), prefs.fixedWeeks, value => set('fixedWeeks', value)),
      ),
      option(
        $t('Lines per day'),
        $t('How many lines a day shows in the full page layout before “+2 more”.'),
        choice(
          'maxChips',
          $t('Lines per day'),
          [1, 2, 3, 4, 5, 6].map(n => [n, String(n)]),
          prefs.maxChips,
          (value, focusKey) => set('maxChips', value, focusKey),
        ),
      ),
      option(
        $t('Trips as bars'),
        $t('Trips and events with dates are drawn across their days.'),
        toggle('trips', $t('Trips as bars'), prefs.trips, value => set('trips', value)),
      ),
      option(
        $t('Legend'),
        $t('The coloured groups above the grid, which also show or hide each group.'),
        toggle('legend', $t('Legend'), prefs.legend, value => set('legend', value)),
      ),
    ),
  );

  // the groups the Overview shows: at least one stays on
  const groupButtons = h(
    'div',
    { class: 'cal-picks', role: 'group', 'aria-label': $t('What it shows') },
    PLAN_GROUPS.map(group => {
      const on = prefs.overviewGroups.includes(group.key);
      const last = on && prefs.overviewGroups.length === 1;
      return h(
        'button',
        {
          type: 'button',
          class: 'cal-pick cal-c-' + group.tone,
          'aria-pressed': String(on),
          'data-focus': 'group:' + group.key,
          disabled: last,
          title: last ? $t('At least one group stays on.') : null,
          onclick: () =>
            set(
              'overviewGroups',
              on ? prefs.overviewGroups.filter(key => key !== group.key) : [...prefs.overviewGroups, group.key],
              'group:' + group.key,
            ),
        },
        h('i', { class: 'cal-dot', 'aria-hidden': 'true' }),
        h('span', { text: group.label }),
      );
    }),
  );
  const overview = card(
    $t('Overview'),
    null,
    null,
    h(
      'div',
      { class: 'rows' },
      option(
        $t('Show the calendar on the Overview'),
        null,
        toggle('overview', $t('Show the calendar on the Overview'), prefs.overview, value => set('overview', value)),
      ),
      prefs.overview
        ? [
            option(
              $t('What it shows'),
              $t('At first, what is ahead: income, bills, planned one-offs, loans and trips.'),
              groupButtons,
            ),
          ]
        : null,
    ),
  );

  const planner = card(
    $t('Month planner'),
    $t('The Calendar view, next to “By type” and “Day by day”.'),
    null,
    h(
      'div',
      { class: 'rows' },
      option(
        $t('Number on each day'),
        null,
        choice(
          'plannerFigure',
          $t('Number on each day'),
          [
            ['balance', $t('End-of-day balance')],
            ['net', $t('Net of the day')],
            ['spent', $t('Spent that day')],
          ],
          prefs.plannerFigure,
          (value, focusKey) => set('plannerFigure', value, focusKey),
        ),
      ),
    ),
  );

  // the context menus: a switch for the menus, then one per thing they can add or do, in menu order
  const addPick = (key, label) =>
    pick('add:' + key, label, prefs.add[key], value => save({ add: { ...prefs.add, [key]: value } }, 'add:' + key));
  const menus = card(
    $t('Context menus'),
    $t('Right-click a day or a line in a calendar. On touch screens, use “+”, Add and the “⋯” button of a line.'),
    null,
    h(
      'div',
      { class: 'rows' },
      option(
        $t('Use context menus'),
        menusHint(prefs),
        toggle('menus', $t('Use context menus'), prefs.menus, value => set('menus', value)),
      ),
    ),
    prefs.menus
      ? [
          h('div', { class: 'grp-h', text: $t('Add on a day') }),
          // a grid of tick boxes per section: eleven switches one under the other made the longest card of Settings
          addChoices().map(([title, choices]) =>
            h(
              'div',
              { class: 'cal-set', role: 'group', 'aria-label': title },
              h('div', { class: 'cal-set-h', text: title }),
              h(
                'div',
                { class: 'cal-picks' },
                choices.map(([key, , label]) => addPick(key, label)),
              ),
            ),
          ),
          h('div', { class: 'grp-h', text: $t('Actions on a line') }),
          h(
            'div',
            { class: 'rows' },
            option($t('Edit'), $t('Always there.'), h('span', { class: 'chip', text: $t('Always') })),
            lineChoices().map(([key, label, hint]) =>
              option(
                label,
                hint,
                toggle('line:' + key, label, prefs.line[key], value =>
                  save({ line: { ...prefs.line, [key]: value } }, 'line:' + key),
                ),
              ),
            ),
          ),
        ]
      : null,
  );
  return [general, overview, planner, menus];
}
