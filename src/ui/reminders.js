/**
 * @file Bill reminders on the page (Settings › Reminders): which payments are due soon (logic/reminders.js), a
 * notification in the app and, when allowed, one from the system, and the "Due soon" card of the Overview.
 *
 * Runway is a file on the device with no server and no background worker, so reminders come while it is open in a
 * tab: when it starts, every minute, and when the tab comes back. Each payment is told once (what was told is kept in
 * this browser, not in the plan: it is not a change the person made). System notifications say no names and no
 * amounts when the app lock or hidden amounts are on: a notification shows on the phone's or computer's lock screen.
 */
import { D, M } from '../core/dates.js';
import { plainMoney } from '../core/format.js';
import { $t, plural } from '../core/i18n.js';
import { dueReminders, newReminders, pruneSeen } from '../logic/reminders.js';
import { readJSON, writeJSON } from '../services/storage.js';
import { Actions } from '../state/actions.js';
import { Store } from '../state/store.js';
import { App } from './app.js';
import { btn } from './components/button.js';
import { amt, card, row } from './components/layout.js';
import { toast } from './components/toast.js';
import { h } from './dom.js';
import { tickOf } from './helpers.js';
import { Lock } from './lock.js';

const SEEN_KEY = 'runway.reminded.v1';
const readSeen = () => {
  const seen = readJSON(SEEN_KEY);
  return seen && typeof seen === 'object' ? seen : {};
};
const writeSeen = seen => writeJSON(SEEN_KEY, seen);

/**
 * The payments to remind now, with the person's settings. [] when reminders are off.
 * @returns {object[]} the reminders (logic/reminders.js dueReminders)
 */
export function dueNow() {
  const prefs = Store.db.reminders;
  if (!prefs.on || !Store.plan || !Store.proj) {
    return [];
  }
  return dueReminders(Store.proj.months, { today: Store.day, days: prefs.days, kinds: prefs });
}

/**
 * "today", "tomorrow", "in 3 days", "2 days ago".
 * @returns {string}
 */
export function whenText(r) {
  if (r.daysLeft === 0) {
    return $t('today');
  }
  if (r.daysLeft === 1) {
    return $t('tomorrow');
  }
  return r.daysLeft > 1 ? $t('in {0}', plural(r.daysLeft, 'day')) : $t('{0} ago', plural(-r.daysLeft, 'day'));
}
/** One reminder in a sentence, for notifications. */
const sentence = (r, amounts) => {
  const what = amounts ? `${r.label} (${plainMoney(r.amount)})` : r.label;
  if (r.overdue) {
    return $t('{0} was due {1}', what, whenText(r));
  }
  return $t('{0} is due {1}', what, whenText(r));
};

/** The title of a system notification: only the app's name while amounts and names are kept private. */
function notificationTitle(privateText, count) {
  if (privateText) {
    return 'Runway';
  }
  return count === 1 ? $t('Payment due') : $t('Payments due');
}

/**
 * Whether the system can show notifications here, and whether it may.
 * @returns {'unsupported'|'granted'|'denied'|'default'}
 */
export const systemNotifications = () =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission; // 'granted' | 'denied' | 'default'

/**
 * Tells the payments not told yet: in the app (unless it is locked) and, when allowed, from the system.
 * @param {{test?: boolean}} o test: tells the current list even if it was told (the "Try it" button)
 * @returns {object[]} the reminders told now ([] when none)
 */
export function checkReminders({ test = false } = {}) {
  const list = dueNow();
  const seen = pruneSeen(readSeen(), Store.day);
  const fresh = test ? list : newReminders(list, seen);
  if (!fresh.length) {
    writeSeen(seen);
    return fresh;
  }
  const privateText = Lock.enabled() || Store.db.hideAmounts;
  if (!Lock.locked) {
    toast(
      fresh.length === 1
        ? sentence(fresh[0], true)
        : $t('{0} due soon: {1}', plural(fresh.length, 'payment'), fresh.map(r => r.label).join(', ')),
      { kind: fresh.some(r => r.overdue) ? 'bad' : '' },
    );
  }
  if (Store.db.reminders.notify && systemNotifications() === 'granted') {
    try {
      const note = new Notification(notificationTitle(privateText, fresh.length), {
        body: privateText
          ? $t('{0} due soon. Open Runway to see them.', plural(fresh.length, 'payment'))
          : fresh.map(r => sentence(r, true)).join('\n'),
        tag: 'runway-reminders',
      });
      note.onclick = () => {
        window.focus();
        App.go('overview');
        note.close();
      };
    } catch (e) {
      // some browsers (Android Chrome) only show notifications from a service worker: the one in the app is enough
    }
  }
  for (const r of fresh) {
    seen[r.id] = D.key(Store.day);
  }
  writeSeen(seen);
  return fresh;
}

/**
 * Asks the system for notifications (only from a click: browsers ignore it otherwise). Resolves to the answer.
 * @returns {Promise<'unsupported'|'granted'|'denied'|'default'>}
 */
export async function askNotifications() {
  if (systemNotifications() === 'unsupported') {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch (e) {
    return systemNotifications();
  }
}

/**
 * The "Due soon" card of the Overview: each payment, when, how much, and a way to mark it paid. null when none.
 * @returns {?HTMLElement}
 */
export function dueSoonCard() {
  const list = dueNow();
  if (!list.length) {
    return null;
  }
  return card(
    $t('Due soon'),
    $t('Bills and payments in the next {0}, and any overdue.', plural(Store.db.reminders.days || 1, 'day')),
    btn($t('Reminder settings'), () => App.go('settings', { stab: 'reminders' }), 'sm ghost'),
    h(
      'div',
      { class: 'rows' },
      list.map(r =>
        row({
          title: r.label,
          // the month it counts in, only when that is not the month of the date (a pay cycle can start mid-month)
          desc: [
            whenText(r),
            D.label(r.date, { weekday: 'short' }),
            D.key(r.date).startsWith(r.monthKey) ? null : M.label(M.parse(r.monthKey)),
          ]
            .filter(Boolean)
            .join(' · '),
          cls: r.overdue ? 'overdue' : '',
          right: [
            amt(-r.amount),
            btn(
              r.overdue ? $t('Paid') : $t('Mark as paid'),
              () => Actions.setPaid(r.monthKey, tickOf(r.entry), true),
              'sm',
            ),
          ],
          onclick: () => App.go('months', { month: M.parse(r.monthKey) }),
        }),
      ),
    ),
  );
}
