/**
 * @file Notes shown in the month planner: the offer to cover a short month, and what the last check against real money found.
 */
import { D, M } from '../../core/dates.js';
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { r2 } from '../../core/util.js';
import { Actions } from '../../state/actions.js';
import { Store } from '../../state/store.js';
import { btn } from './button.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';

/** Plain-words explanation of a real-balance snapshot for a month. */
/** A month that ends below zero: offer the money that could cover it. Debit and cash are already what the plan spends, so savings come first, then credit cards. */
export function coverNote(m) {
  if (m.close >= 0 || m.end < Store.day) {
    return null;
  }
  const plan = Store.plan;
  const projection = Store.proj;
  const i = m.k - projection.summary.s0;
  const short = r2(-m.close);
  const src = [
    ...plan.accounts.filter(a => a.type === 'savings' && a.balance > 0).map(a => [a, a.balance]),
    ...plan.accounts
      .filter(a => a.type === 'credit')
      .map(a => [a, r2(Math.max(0, a.limit - projection.cards[a.id].series[i]))])
      .filter(x => x[1] > 0),
  ];
  return h(
    'div',
    { class: 'note warn', style: 'margin-bottom:10px' },
    icon('alert'),
    h(
      'div',
      { class: 'grow' },
      h('div', {
        text:
          $t('{0} ends {1} short.', M.label(m.k), money(short)) +
          ' ' +
          (src.length
            ? $t('Your debit and cash money is already used up by then. Cover the rest from savings or a credit card?')
            : $t(
                'There is no savings account or credit card with room left to cover it. Lower a cost, or move one to a later month.',
              )),
      }),
      src.length
        ? h(
            'div',
            { class: 'acts', style: 'margin-top:8px' },
            src.map(([a, room]) => {
              const v = r2(Math.min(short, room));
              return btn(
                a.type === 'credit'
                  ? $t('Put {0} on {1}', money(v), a.name)
                  : $t('Take {0} from {1}', money(v), a.name),
                () => Actions.cover(m.key, a.id, v),
                'sm',
              );
            }),
          )
        : null,
      src.some(x => x[0].type === 'credit')
        ? h('div', {
            class: 'small muted',
            style: 'margin-top:6px',
            text: $t(
              'Money put on a card is added to what you owe on it. Your card payment bill then pays it off in the months after.',
            ),
          })
        : null,
    ),
  );
}
/** What the last check against real money found, in plain words. */
export function fixNote(m) {
  const f = m.fix;
  if (!f) {
    return null;
  }
  const on = f.d === null ? M.label(m.k) : D.label(f.d, { weekday: 'short' });
  return h(
    'div',
    { class: 'notes' },
    f.a
      ? h(
          'div',
          { class: 'note info' },
          icon('info'),
          h('div', {
            class: 'grow',
            text:
              f.a < 0
                ? $t(
                    'Checked on {0}: you had {1} less than the paid lines add up to. It is counted as spending that is not in the plan, so the numbers here match your real money.',
                    on,
                    money(-f.a),
                  )
                : $t(
                    'Checked on {0}: you had {1} more than the paid lines add up to. It is counted as money that is not in the plan, so the numbers here match your real money.',
                    on,
                    money(f.a),
                  ),
          }),
        )
      : h(
          'div',
          { class: 'note good' },
          icon('check'),
          h('div', { class: 'grow', text: $t('Checked on {0}: the planner and your real money agree.', on) }),
        ),
  );
}
