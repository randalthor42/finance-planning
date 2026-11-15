/**
 * @file The month as one visible sum: You have now + Coming in − Still to pay − Budgets left = Left by payday.
 * Used by the Overview, the Month planner and Accounts, all fed by logic/position.js, so they always agree.
 */
import { money } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { h } from '../dom.js';

/** One term of the sum. A zero is a muted dash, so the sum keeps the same shape every month. */
function term(label, amount, { className = '', sub = null, total = false, sign = null, pulse = false } = {}) {
  const isZero = Math.abs(amount) < 0.005 && !total;
  return h(
    'div',
    { class: 'meq-t' + (total ? ' total' : '') + (pulse ? ' pulse' : '') },
    h('div', { class: 'l', 'data-op': sign, text: label }),
    h('div', { class: 'v ' + (isZero ? 'muted' : className), text: isZero ? '–' : money(amount) }),
    sub,
  );
}
const op = sign => h('div', { class: 'op', 'aria-hidden': 'true', text: sign });

/**
 * @param {ReturnType<import('../../logic/position.js').monthPosition>} position
 * @param {{endLabel: string, endClass?: string, status?: Node|string|null, perDayText?: string|null}} options
 *   status: shown under "You have now" (the balance check chip); perDayText: shown under "Budgets left";
 *   pulse: terms that just changed ('now', 'comingIn', 'toPay'), highlighted briefly so the person sees what moved.
 */
export function monthEquation(position, { endLabel, endClass = '', status = null, perDayText = null, pulse = [] }) {
  const small = text => (text ? h('div', { class: 's', text }) : null);
  const statusNode = typeof status === 'string' ? small(status) : status;
  // the box is a size container: the sum lays itself out by the width of the card it sits in, not of the screen
  return h(
    'div',
    { class: 'meq-box' },
    h(
      'div',
      {
        class: 'meq',
        role: 'group',
        'aria-label': $t(
          '{0} now, plus {1} coming in, minus {2} to pay, minus {3} in budgets: {4}',
          money(position.now),
          money(position.comingIn),
          money(position.toPay),
          money(position.budgetsLeft),
          money(position.close),
        ),
      },
      term($t('You have now'), position.now, {
        className: position.now < 0 ? 'bad' : '',
        sub: statusNode,
        pulse: pulse.includes('now'),
      }),
      op('+'),
      term($t('Coming in'), position.comingIn, { className: 'good', sign: '+', pulse: pulse.includes('comingIn') }),
      op('−'),
      term($t('Still to pay'), position.toPay, { sign: '−', pulse: pulse.includes('toPay') }),
      op('−'),
      term($t('Budgets left'), position.budgetsLeft, { sub: small(perDayText), sign: '−' }),
      op('='),
      term(endLabel, position.close, { className: endClass, total: true, sign: '=' }),
    ),
  );
}
