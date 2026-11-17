/**
 * @file The PIN window (Settings › Lock and privacy): a new PIN (typed twice), a change (the current one first), or
 * the current one to confirm something (turning the lock or the encryption off). The numeric keyboard on phones.
 */
import { $t } from '../../core/i18n.js';
import { validPin } from '../../logic/lock.js';
import { btn } from '../components/button.js';
import { modal } from '../components/modal.js';
import { h } from '../dom.js';

/**
 * @param {{mode: 'new'|'change'|'confirm', title: string, text?: string, check?: (pin: string) => Promise<boolean>,
 *   save: (pin: string) => Promise<void>}} o  check: the current PIN (change, confirm); save: what to do with the PIN
 *   (the new one, or the current one when confirming). A failing save shows its message and keeps the window open.
 * @returns {HTMLElement} the open window
 */
export function pinModal({ mode, title, text = '', check, save }) {
  const field = (label, id) =>
    h(
      'label',
      { class: 'fld half' },
      h('span', { class: 'fld-l', text: label }),
      h('input', {
        class: 'inp pin-inp',
        id,
        type: 'password',
        inputmode: 'numeric',
        autocomplete: 'off',
        maxlength: 12,
      }),
    );
  let nowField = null;
  if (mode !== 'new') {
    nowField = field(mode === 'confirm' ? $t('Your PIN') : $t('Current PIN'), 'pin-now');
  }
  const fields = [
    nowField,
    mode !== 'confirm' ? field($t('New PIN'), 'pin-new') : null,
    mode !== 'confirm' ? field($t('New PIN again'), 'pin-again') : null,
  ].filter(Boolean);
  const err = h('div', { class: 'form-err', role: 'alert' });
  const value = id => (form.querySelector('#' + id) || {}).value || '';
  const ok = btn(mode === 'confirm' ? $t('Confirm') : $t('Save'), () => form.requestSubmit(), 'primary');
  const form = h(
    'form',
    {
      class: 'form',
      novalidate: true,
      onsubmit: async e => {
        e.preventDefault();
        err.textContent = '';
        if (mode !== 'new' && !(await check(value('pin-now')))) {
          err.textContent = $t('That is not your PIN.');
          return;
        }
        if (mode !== 'confirm') {
          if (!validPin(value('pin-new'))) {
            err.textContent = $t('A PIN is 4 to 12 digits.');
            return;
          }
          if (value('pin-new') !== value('pin-again')) {
            err.textContent = $t('The two PINs are not the same.');
            return;
          }
        }
        ok.disabled = true;
        err.textContent = $t('One moment…');
        try {
          await save(mode === 'confirm' ? value('pin-now') : value('pin-new'));
          d.close();
        } catch (error) {
          ok.disabled = false;
          err.textContent = String((error && error.message) || error);
        }
      },
    },
    text ? h('p', { class: 'muted', style: 'grid-column:1/-1', text }) : null,
    fields,
    h('button', { type: 'submit', hidden: true }),
  );
  const d = modal({
    title,
    body: form,
    err,
    foot: [h('span', { class: 'sp' }), btn($t('Cancel'), () => d.close(), 'ghost'), ok],
  });
  d.classList.add('narrow');
  const first = form.querySelector('input');
  if (first) {
    first.focus();
  }
  return d;
}
