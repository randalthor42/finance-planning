/**
 * @file "Review and apply": the drafts of My calendar, each with a tick box, what the ticked ones would do to the
 * months, and one button that adds them to the plan in one step (one Undo takes them all back to drafts).
 */
import { D, M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t, plural } from '../../core/i18n.js';
import { draftImpact, draftMoney, moneyOf } from '../../logic/agenda.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from '../components/button.js';
import { modal } from '../components/modal.js';
import { h } from '../dom.js';

/**
 * Every draft as { list, rec, name }, in the order they are shown: one-offs, trips and events, then appointments whose
 * money is not counted yet (list 'entries').
 * @returns {{list: string, rec: object, name: string}[]}
 */
export const allDrafts = agenda => [
  ...agenda.drafts.items.map(rec => ({ list: 'items', rec, name: rec.name })),
  ...agenda.drafts.trips.map(rec => ({ list: 'trips', rec, name: rec.name })),
  ...agenda.entries.filter(draftMoney).map(rec => ({ list: 'entries', rec, name: rec.title })),
];
const REPEAT_WORDS = () => ({
  day: $t('every day'),
  week: $t('every week'),
  month: $t('every month'),
  year: $t('every year'),
});

/**
 * When a draft happens, in a few words: its day or days, or its month.
 * @returns {string}
 */
export function draftWhen({ list, rec }) {
  if (list === 'entries') {
    const day = D.label(D.parse(rec.date), { weekday: 'short', year: 'numeric' });
    return rec.repeat === 'none' ? day : $t('{0}, then {1}', day, REPEAT_WORDS()[rec.repeat]);
  }
  const from = D.parse(list === 'items' ? rec.date : rec.from);
  const to = list === 'trips' ? D.parse(rec.to) : null;
  if (from === null) {
    return M.label(M.parse(rec.month), true);
  }
  return to === null
    ? D.label(from, { weekday: 'short', year: 'numeric' })
    : $t('{0} to {1}', D.label(from), D.label(to, { year: 'numeric' }));
}
/**
 * What a draft would move, signed like a ledger line: money in is positive. A trip counts its costs.
 * @returns {?number} positive for money in, negative for money out (null: an appointment without money)
 */
export function draftAmount({ list, rec }) {
  if (list === 'entries') {
    return moneyOf(rec);
  }
  if (list === 'items') {
    return rec.kind === 'in' ? rec.amount : -rec.amount;
  }
  return -rec.items.reduce((sum, i) => sum + i.amount, 0);
}

/**
 * What the chosen drafts would do, as [label, before, after, tone] rows: money in and out over the plan, the lowest
 * month end, months below zero, the end of the plan. `tone` marks an after that is worse ('bad' below zero, 'warn').
 * @returns {[string, ?string, string, string][]} the rows that apply (rows of nothing are left out)
 */
export function impactRows(im, cushion) {
  const lowTone = v => {
    if (v < 0) {
      return 'bad';
    }
    if (v < cushion) {
      return 'warn';
    }
    return '';
  };
  const low = o => $t('{0} in {1}', money(o.lowest), M.label(o.lowestK));
  const neg = o => (o.negative ? $t('{0}, from {1}', plural(o.negative, 'month'), M.label(o.firstNeg)) : $t('None'));
  return [
    im.out ? [$t('Money out over the plan'), null, signed(-im.out), ''] : null,
    im.in ? [$t('Money in over the plan'), null, signed(im.in), 'good'] : null,
    [$t('Lowest month end'), low(im.before), low(im.after), lowTone(im.after.lowest)],
    [$t('Months below zero'), neg(im.before), neg(im.after), im.after.negative > im.before.negative ? 'bad' : ''],
    [$t('End of the plan'), money(im.before.end), money(im.after.end), lowTone(im.after.end)],
  ].filter(Boolean);
}

/**
 * Opens the review. `only`: ids to tick at first (default every draft). `then`: called after the drafts are applied
 * (leaving the page goes on; see views/agenda.js).
 * @returns {HTMLElement} the open window
 */
export function applyDraftsModal({ only = null, then = null } = {}) {
  const plan = Store.plan;
  const drafts = allDrafts(plan.agenda);
  const chosen = new Set(only || drafts.map(d => d.rec.id));
  const impact = h('div', { class: 'agenda-impact', 'aria-live': 'polite' });
  const apply = btn(
    '',
    () => {
      const ids = drafts.filter(d => chosen.has(d.rec.id)).map(d => d.rec.id);
      if (!ids.length) {
        return;
      }
      d.close();
      Actions.applyDrafts(ids);
      if (then) {
        then();
      }
    },
    'primary',
  );
  const drawImpact = () => {
    const ids = drafts.filter(x => chosen.has(x.rec.id)).map(x => x.rec.id);
    apply.textContent = $t('Add {0} to my plan', ids.length);
    apply.disabled = !ids.length;
    if (!ids.length) {
      impact.replaceChildren(h('p', { class: 'muted small', text: $t('Tick the drafts to add.') }));
      return;
    }
    const im = draftImpact(plan, Store.proj, ids, Store.day);
    impact.replaceChildren(
      h('div', { class: 'agenda-impact-h', text: $t('What it changes') }),
      ...impactRows(im, plan.settings.cushion).map(([label, before, after, tone]) =>
        h(
          'div',
          { class: 'agenda-impact-r' },
          h('span', { class: 'l', text: label }),
          before !== null ? h('span', { class: 'b num', text: before }) : null,
          before !== null ? h('span', { class: 'arrow', 'aria-hidden': 'true', text: '→' }) : null,
          h('b', { class: 'num ' + tone, text: after }),
        ),
      ),
    );
  };
  const rows = drafts.map(draft => {
    const input = h('input', {
      type: 'checkbox',
      class: 'check',
      checked: chosen.has(draft.rec.id),
      onchange: () => {
        if (input.checked) {
          chosen.add(draft.rec.id);
        } else {
          chosen.delete(draft.rec.id);
        }
        drawImpact();
      },
    });
    const amount = draftAmount(draft);
    let amountTag = null;
    if (amount) {
      amountTag = h('span', { class: 'amt' + (amount > 0 ? ' good' : ''), text: signed(amount) });
    }
    return h(
      'label',
      { class: 'row agenda-apply-r' },
      input,
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 't', text: draft.name }),
        h('div', {
          class: 'd',
          text: [draftWhen(draft), kindOf(draft)].filter(Boolean).join(' · '),
        }),
      ),
      amountTag,
    );
  });
  const d = modal({
    title: $t('Apply drafts to your plan'),
    wide: true,
    body: h(
      'div',
      null,
      h('p', {
        class: 'muted',
        text: $t(
          'Added to your plan, they count in your months and balances like anything else, and stay on your calendar.',
        ),
      }),
      drafts.length
        ? h('div', { class: 'rows agenda-apply' }, rows)
        : h('p', { class: 'muted', text: $t('There are no drafts.') }),
      impact,
    ),
    foot: [h('span', { class: 'sp' }), btn($t('Cancel'), () => d.close(), 'ghost'), apply],
  });
  drawImpact();
  return d;
}
/** What a draft is, in a word. */
const kindOf = ({ list, rec }) => {
  if (list === 'entries') {
    return $t('Appointment');
  }
  if (list === 'trips') {
    if (rec.kind === 'event') {
      return $t('Event');
    }
    if (rec.kind === 'idea') {
      return $t('Someday idea');
    }
    return $t('Trip');
  }
  return '';
};
