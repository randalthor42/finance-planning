/**
 * @file Every change a user can make to a plan. The UI calls these and nothing else writes to the store.
 */
import { D, M } from '../core/dates.js';
import { money } from '../core/format.js';
import { $t } from '../core/i18n.js';
import { has, isObj, r2, uid } from '../core/util.js';
import { project } from '../logic/projection.js';
import { Store } from './store.js';

/**
 * ACTIONS: every change a user can make to a plan, by name, with plain data in. The page calls these and nothing else.
 * Each one is a future API endpoint (e.g. Actions.save('bills', bill) -> PUT /plans/{id}/bills/{billId}).
 */
const KIND = {
  incomes: $t('income'),
  bills: $t('bill'),
  items: $t('purchase'),
  trips: $t('trip'),
  loans: $t('loan'),
  goals: $t('savings goal'),
  wishes: $t('wish'),
  accounts: $t('account'),
};
export const Actions = {
  save(list, obj) {
    const isNew = !Store.plan[list].some(x => x.id === obj.id);
    const kind = list === 'items' && obj.budget ? $t('spend') : KIND[list];
    return Store.commit(
      p => {
        const i = p[list].findIndex(x => x.id === obj.id);
        if (i > -1) {
          p[list][i] = obj;
        } else {
          p[list].push(obj);
        }
      },
      `${isNew ? $t('Added') : $t('Updated')} ${kind} “${obj.name}”`,
    );
  },
  remove(list, id) {
    const x = Store.plan[list].find(y => y.id === id);
    return (
      !!x &&
      Store.commit(
        p => {
          p[list] = p[list].filter(y => y.id !== id);
        },
        $t('Deleted {0} “{1}”', KIND[list], x.name),
        { undo: true },
      )
    );
  },
  duplicate(list, id) {
    const x = Store.plan[list].find(y => y.id === id);
    return (
      !!x &&
      Store.commit(
        p => {
          const c = JSON.parse(JSON.stringify(x));
          c.id = uid();
          c.name = $t('{0} copy', x.name).slice(0, 80);
          if (c.items) {
            c.items.forEach(i => {
              i.id = uid();
            });
          }
          p[list].splice(p[list].findIndex(y => y.id === id) + 1, 0, c);
        },
        $t('Copied {0} “{1}”', KIND[list], x.name),
      )
    );
  },
  move(list, from, to) {
    return Store.commit(
      p => {
        p[list].splice(to, 0, p[list].splice(from, 1)[0]);
      },
      $t('Reordered {0}s', KIND[list]),
    );
  },
  toggle(list, id, on) {
    const x = Store.plan[list].find(y => y.id === id);
    return Store.commit(
      p => {
        p[list].find(y => y.id === id).on = on;
      },
      $t('{0} {1} “{2}” in the plan', on ? $t('Counting') : $t('Not counting'), KIND[list], x.name),
    );
  },
  patch(list, id, values, label) {
    const x = Store.plan[list].find(y => y.id === id);
    return Store.commit(
      p => {
        Object.assign(
          p[list].find(y => y.id === id),
          values,
        );
      },
      label || $t('Updated {0} “{1}”', KIND[list], x.name),
    );
  },
  /** A recurring amount changes from a month on (a raise, a rent increase): end the old line the month before and start a copy with the new amount. */
  changeFrom(list, id, monthKey, amount) {
    const x = Store.plan[list].find(y => y.id === id);
    const monthIndex = M.parse(monthKey);
    return Store.commit(
      p => {
        const i = p[list].findIndex(y => y.id === id);
        const old = p[list][i];
        const next = { ...old, id: uid(), amount, from: monthKey };
        old.to = M.key(monthIndex - 1);
        p[list].splice(i + 1, 0, next);
        if (list === 'bills') {
          p.items.forEach(item => {
            if (item.budget === old.id && M.parse(item.month) >= monthIndex) {
              item.budget = next.id;
            }
          });
        }
      },
      $t('“{0}” changes to {1} from {2}', x.name, money(amount), M.label(monthIndex)),
    );
  },
  /**
   * Tick or untick a line. e = { key, label, amount (signed), payTo, account }. accountId: where it was paid from
   * (default: the account the line is planned from, else the main account). A tick must never change what a line costs.
   * Money only moves between accounts once the month has been checked against reality ("What I have today"): before that,
   * a tick means "this was already paid", so it is already inside the balances you entered.
   */
  setPaid(monthKey, e, on, accountId) {
    const monthIndex = M.parse(monthKey);
    const moves = !!Store.plan.fixes[monthKey];
    return Store.commit(
      p => {
        const o = p.paid[monthKey] || (p.paid[monthKey] = {});
        Actions._tick(p, o, e, on, accountId, moves);
      },
      `${on ? $t('Ticked off') : $t('Unticked')} “${e.label}” in ${M.label(monthIndex)}`,
    );
  },
  _tick(p, o, e, on, accountId, moves) {
    const acc = id => p.accounts.find(a => a.id === id);
    const old = o[e.key];
    const move = (rec, sign) => {
      if (!rec.v) {
        return;
      }
      const A = acc(rec.a);
      if (A) {
        if (A.type === 'credit') {
          if (rec.v < 0) {
            A.owed = Math.max(0, r2(A.owed - sign * rec.v));
          }
        } else {
          A.balance = r2(A.balance + sign * rec.v);
        }
      }
      const C = acc(rec.t);
      if (C && C.type === 'credit') {
        C.owed = Math.max(0, r2(C.owed + sign * rec.v));
      }
    };
    if (isObj(old)) {
      move(old, -1);
    } // undo what the previous tick moved
    if (!on) {
      delete o[e.key];
      return;
    }
    const a = accountId || e.account || (p.accounts.find(x => x.main) || {}).id || null;
    const rec = { d: D.key(D.today()), a, v: moves ? e.amount : 0, t: moves ? e.payTo || null : null };
    o[e.key] = rec;
    move(rec, 1);
  },
  setPaidAll(monthKey, entries, on) {
    const monthIndex = M.parse(monthKey);
    return Store.commit(
      p => {
        const o = p.paid[monthKey] || (p.paid[monthKey] = {});
        for (const e of entries) {
          Actions._tick(p, o, e, on, null, false);
        }
      },
      $t('{0} everything in {1}', on ? $t('Ticked off') : $t('Unticked'), M.label(monthIndex)),
    );
  },
  /**
   * "This is what I really have", in one step that leaves only ordinary data behind: lines you say are already paid get ticked,
   * budget money you say is gone becomes a logged spend, and whatever still does not add up becomes this month's correction.
   */
  reconcile(accounts, monthKey, real, paidEntries, left) {
    const day = D.key(D.today());
    return Store.commit(
      p => {
        p.accounts = accounts;
        if (!monthKey) {
          return;
        }
        const o = p.paid[monthKey] || (p.paid[monthKey] = {});
        for (const e of paidEntries || []) {
          if (!o[e.key]) {
            o[e.key] = { d: day, a: null, v: 0, t: null };
          }
        }
        const spend = (id, amount, name) => {
          const b = p.bills.find(x => x.id === id);
          p.items.push({
            id: uid(),
            name,
            amount: r2(amount),
            kind: 'out',
            month: monthKey,
            date: day,
            cat: b ? b.cat : 'other',
            budget: id,
            account: null,
            note: '',
          });
        };
        let m = project(p).months.find(x => x.key === monthKey);
        if (!m) {
          return;
        }
        for (const e of m.entries) {
          if (e.budget && !e.paid && has(left || {}, e.id) && e.budget.left - left[e.id] > 0.004) {
            spend(e.id, e.budget.left - left[e.id], e.label);
          }
        }
        m = project(p).months.find(x => x.key === monthKey);
        p.fixes[monthKey] = { d: day, a: r2(((p.fixes[monthKey] || {}).a || 0) + real - m.now) };
      },
      $t('Checked: you have {0}', money(real)),
    );
  },
  /** A month that ends below zero: bring money in from savings or from a credit card. One step, so one undo takes all of it back. */
  cover(monthKey, accountId, amount) {
    const a = Store.plan.accounts.find(x => x.id === accountId);
    return Store.commit(
      p => {
        p.items.push({
          id: uid(),
          name: $t('From {0}', a.name),
          amount,
          kind: 'in',
          month: monthKey,
          date: null,
          cat: 'other',
          budget: null,
          account: null,
          cover: accountId,
          note: '',
        });
        const s = p.accounts.find(x => x.id === accountId);
        if (s.type !== 'credit') {
          s.balance = r2(s.balance - amount);
        }
      },
      $t('Covered {0} in {1} from “{2}”', money(amount), M.label(M.parse(monthKey)), a.name),
    );
  },
  clearFix(monthKey) {
    return Store.commit(
      p => {
        delete p.fixes[monthKey];
      },
      $t('Removed the correction for {0}', M.label(M.parse(monthKey))),
    );
  },
  /** A month that is over: "it really ended at X". */
  setEnd(monthKey, value) {
    return Store.commit(
      p => {
        const m = project(p).months.find(x => x.key === monthKey);
        if (m) {
          p.fixes[monthKey] = { d: D.key(m.end), a: r2(((p.fixes[monthKey] || {}).a || 0) + value - m.close) };
        }
      },
      $t('{0} really ended at {1}', M.label(M.parse(monthKey)), money(value)),
    );
  },
  setMain(id) {
    const a = Store.plan.accounts.find(x => x.id === id);
    return Store.commit(
      p => {
        p.accounts.forEach(x => {
          x.main = x.id === id;
        });
      },
      $t('“{0}” is now the main account', a.name),
    );
  },
  setOverride(monthKey, entryKey, value, name) {
    return Store.commit(
      p => {
        const o = p.overrides[monthKey] || (p.overrides[monthKey] = {});
        if (value === null) {
          delete o[entryKey];
        } else {
          o[entryKey] = value;
        }
      },
      value === null
        ? $t('“{0}” back to its usual amount in {1}', name, M.label(M.parse(monthKey)))
        : $t('“{0}” set to {1} for {2} only', name, money(value), M.label(M.parse(monthKey))),
    );
  },
  /** Reserve (true) or only track (false) one budget in one month. null goes back to the budget's usual choice. */
  setReserve(monthKey, entryKey, value, name) {
    return Store.commit(
      p => {
        const o = p.reserveOver[monthKey] || (p.reserveOver[monthKey] = {});
        if (value === null) {
          delete o[entryKey];
        } else {
          o[entryKey] = value;
        }
      },
      value === null
        ? $t('“{0}” back to its usual choice in {1}', name, M.label(M.parse(monthKey)))
        : value
          ? $t('“{0}” is set aside in {1} only', name, M.label(M.parse(monthKey)))
          : $t('“{0}” is only tracked in {1}', name, M.label(M.parse(monthKey))),
    );
  },
  setNote(monthKey, text) {
    return Store.commit(
      p => {
        if (String(text).trim()) {
          p.notes[monthKey] = text;
        } else {
          delete p.notes[monthKey];
        }
      },
      $t('Updated the note for {0}', M.label(M.parse(monthKey))),
    );
  },
  setLoanExtra(id, monthKey, value) {
    const L = Store.plan.loans.find(l => l.id === id);
    return Store.commit(
      p => {
        const l = p.loans.find(x => x.id === id);
        if (value === null) {
          delete l.extras[monthKey];
        } else {
          l.extras[monthKey] = value;
        }
      },
      $t(
        'Extra payment on “{0}” in {1}: {2}',
        L.name,
        M.label(M.parse(monthKey)),
        value === null ? $t('back to usual') : money(value),
      ),
    );
  },
  settings(name, values) {
    return Store.commit(p => {
      p.name = name;
      Object.assign(p.settings, values);
    }, $t('Updated the plan settings'));
  },
  rollForward(monthKey, opening) {
    return Store.commit(
      p => {
        p.settings.startMonth = monthKey;
        p.settings.opening = opening;
      },
      $t('Rolled the plan forward to {0}', M.label(M.parse(monthKey))),
    );
  },
  addMonth() {
    return Store.commit(p => {
      p.settings.horizon++;
    }, $t('Added one more month to the plan'));
  },
};
