/**
 * @file My calendar (Plans and goals): the person's own calendar page. Their appointments, in calendars of their own,
 * next to what they choose to see of the plan; and drafts (spending, income, trips, events) that count for nothing
 * until they apply them. Leaving the page with new drafts asks whether to add them to the plan.
 * The data is plan.agenda (models/agenda.js); the calendar options are in components/agendaData.js.
 */
import { D, M, Period } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { draftCount, draftIds, draftImpact } from '../../logic/agenda.js';
import { Store } from '../../state/store.js';
import { AGENDA_CAL, agendaCalendar, dayForNew, draftChoices, draftsTitle } from '../components/agendaData.js';
import { btn } from '../components/button.js';
import { calendar, calendarState } from '../components/calendar.js';
import { page } from '../components/layout.js';
import { modal } from '../components/modal.js';
import { ctxMenu } from '../components/popover.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { memo } from '../memo.js';
import { agendaSettingsModal } from '../modals/agendaSettings.js';
import { applyDraftsModal } from '../modals/applyDrafts.js';
import { appointmentModal } from '../modals/appointment.js';
import { pinPicker } from '../modals/pinPicker.js';
import { UI } from '../state.js';
import { LEAVE, V } from './registry.js';

/** What every draft together would do, in one line for the drafts bar. One projection, kept while nothing changes. */
function impactLine(plan) {
  const agenda = plan.agenda;
  const ids = draftIds(agenda.drafts, agenda);
  // calendar-only changes keep Store.rev (the projection is the same), so the drafts themselves are part of the key
  const key = JSON.stringify([agenda.drafts, agenda.entries.filter(e => ids.includes(e.id))]);
  return memo('agendaImpact', [key], () => {
    const im = draftImpact(plan, Store.proj, ids, Store.day);
    const parts = [];
    if (im.out) {
      parts.push($t('{0} out', money(im.out)));
    }
    if (im.in) {
      parts.push($t('{0} in', signed(im.in)));
    }
    if (im.after.negative > im.before.negative) {
      parts.push($t('{0} below zero', plural(im.after.negative, 'month')));
    } else if (im.after.lowest !== im.before.lowest) {
      parts.push($t('lowest month end {0}', money(im.after.lowest)));
    }
    return { text: parts.join(' · '), bad: im.after.negative > im.before.negative };
  });
}

function draftsBar(plan) {
  const count = draftCount(plan.agenda.drafts, plan.agenda);
  if (!count) {
    return null;
  }
  const impact = impactLine(plan);
  return h(
    'div',
    { class: 'note agenda-drafts' + (impact.bad ? ' warn' : '') },
    icon('info'),
    h(
      'div',
      { class: 'grow' },
      h('b', { text: $t('{0} not in your plan yet', plural(count, 'draft')) }),
      impact.text ? h('div', { class: 'small', text: $t('Added to your plan: {0}.', impact.text) }) : null,
    ),
    btn($t('Review and apply'), () => applyDraftsModal(), 'sm primary'),
  );
}

/** "Add a draft": the same choices as the day menu, for the day chosen (or today, or the month's first day). */
function addDraftMenu(e) {
  const settings = Store.plan.settings;
  const day = dayForNew(calendarState(AGENDA_CAL));
  const c = { date: D.key(day), month: M.key(Period.of(settings, day)) };
  ctxMenu(e, [draftsTitle(), ...draftChoices().map(([label, open]) => [label, () => open(c)])]);
}

V.agenda = () => {
  const plan = Store.plan;
  const agenda = plan.agenda;
  const wide = matchMedia('(min-width: 768px)').matches;
  return page(
    agenda.name || $t('My calendar'),
    $t('Your own appointments next to the money in your plan. Drafts count for nothing until you apply them.'),
    [
      btn($t('Customise'), () => agendaSettingsModal(), 'ghost', 'gear'),
      btn($t('Add from your plan'), () => pinPicker(), 'ghost', 'list'),
      h(
        'button',
        { type: 'button', class: 'btn', 'aria-haspopup': 'menu', onclick: addDraftMenu },
        icon('plus'),
        h('span', { text: $t('Add a draft') }),
      ),
      btn(
        $t('New appointment'),
        () => appointmentModal(null, { date: D.key(dayForNew(calendarState(AGENDA_CAL))) }),
        'primary',
        'plus',
      ),
    ],
    draftsBar(plan),
    h(
      'section',
      { class: 'card agenda-card' },
      calendar({ ...agendaCalendar(), id: AGENDA_CAL, mode: wide ? 'full' : 'compact' }),
    ),
  );
};

/**
 * Leaving the page while drafts made or changed in this visit are still drafts: ask whether to add them to the plan.
 * Whatever the answer, it is not asked again for them (only for drafts made or changed afterwards).
 */
LEAVE.agenda = proceed => {
  const plan = Store.plan;
  const ids = plan ? new Set(draftIds(plan.agenda.drafts, plan.agenda)) : new Set();
  const pending = [...UI.agendaTouched].some(id => ids.has(id));
  UI.agendaTouched.clear();
  if (!pending) {
    return false;
  }
  const count = ids.size;
  const d = modal({
    title: $t('Add your drafts to your plan?'),
    body: h('p', {
      class: 'muted',
      text: $t(
        'You have {0} on your calendar. They count in your months and balances only once you add them to your plan.',
        plural(count, 'draft'),
      ),
    }),
    foot: [
      h('span', { class: 'sp' }),
      btn(
        $t('Keep as drafts'),
        () => {
          d.close();
          proceed();
        },
        'ghost',
      ),
      btn(
        $t('Review and apply'),
        () => {
          d.close();
          applyDraftsModal({ then: proceed });
        },
        'primary',
      ),
    ],
  });
  d.classList.add('narrow');
  return true;
};
