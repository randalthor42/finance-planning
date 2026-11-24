/**
 * @file Every change a user can make to a plan. The UI calls these and nothing else writes to the store.
 */
import { D, M } from '../core/dates.js';
// labels for the activity log keep their amounts even while amounts are hidden on screen (toasts mask them)
import { plainMoney as money } from '../core/format.js';
import { $t, plural } from '../core/i18n.js';
import { has, isObj, r2, uid } from '../core/util.js';
import { deleteOccurrence, draftMoney, editOccurrence, moveDrafts, moveTicks } from '../logic/agenda.js';
import { agendaChanges } from './agendaLog.js';
import { project } from '../logic/projection.js';
import { CAT_NAME } from '../models/categories.js';
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
/**
 * What a tick did, in one sentence for the notification and the activity log: ticking moves the amount between
 * "You have now" and "Still to pay" / "Coming in" (the month end does not change), so the sentence says where it went.
 */
function tickLabel(entry, on, monthName) {
  const amount = money(Math.abs(entry.amount || 0));
  if (entry.amount > 0) {
    return on
      ? $t('“{0}” received in {1} · {2} moved to “You have now”', entry.label, monthName, amount)
      : $t('“{0}” unticked in {1} · {2} back in “Coming in”', entry.label, monthName, amount);
  }
  return on
    ? $t('“{0}” paid in {1} · {2} moved to “You have now”', entry.label, monthName, amount)
    : $t('“{0}” unticked in {1} · {2} back in “Still to pay”', entry.label, monthName, amount);
}
/** What of the calendar counts in the plan: appointments whose money is switched on. */
const countedOf = agenda => JSON.stringify(agenda.entries.filter(e => e.on && e.amount > 0));
/**
 * A change of the appointments of My calendar: `change(agenda)` is tried on a copy first, so the commit knows whether
 * any money that counts moved (an appointment with money switched on added, changed or deleted). When none did, the
 * projection is kept (sameMoney); otherwise the plan is worked out again. `change` must do the same both times.
 */
function agendaCommit(change, label, opts, alsoOnPlan = null) {
  const trial = JSON.parse(JSON.stringify(Store.plan.agenda));
  change(trial);
  const same = countedOf(trial) === countedOf(Store.plan.agenda);
  return Store.commit(
    p => {
      change(p.agenda);
      if (alsoOnPlan) {
        alsoOnPlan(p); // in the same commit: one undo step
      }
    },
    label,
    { ...opts, sameMoney: same },
  );
}
/**
 * Where a day of appointment `entry` goes when day `day` is edited for `scope` and moved by `by` days, for its tick
 * (logic/agenda.js moveTicks): the edited day gets the new id `newId` ('one'), the days from it on do ('following'),
 * or every day moves by `by` (the whole appointment).
 */
function tickMap(entry, day, scope, by, newId) {
  const repeats = entry.repeat !== 'none';
  return (id, d) => {
    if (id !== entry.id) {
      return null;
    }
    if (repeats && scope === 'one') {
      return d === day ? [newId, d + by] : null;
    }
    if (repeats && scope === 'following' && day > D.parse(entry.date)) {
      return d >= day ? [newId, d + by] : null;
    }
    return by ? [id, d + by] : null;
  };
}
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
      tickLabel(e, on, M.label(monthIndex)),
      { undo: true },
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
      on
        ? $t('Marked everything paid in {0}', M.label(monthIndex))
        : $t('Unticked everything in {0}', M.label(monthIndex)),
      { undo: true },
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

  /* --- My calendar (models/agenda.js). Only plan.agenda changes, so the projection is kept (sameMoney), except
         when drafts are applied: then they are part of the plan and everything is worked out again. --- */

  /** Adds or updates an appointment (the whole of it; one day of a repeat is editOccurrence). */
  saveEntry(entry) {
    const isNew = !Store.plan.agenda.entries.some(x => x.id === entry.id);
    return agendaCommit(
      agenda => {
        const i = agenda.entries.findIndex(x => x.id === entry.id);
        if (i > -1) {
          agenda.entries[i] = entry;
        } else {
          agenda.entries.push(entry);
        }
      },
      isNew ? $t('Added “{0}” to your calendar', entry.title) : $t('Updated “{0}” in your calendar', entry.title),
    );
  },
  removeEntry(id) {
    const x = Store.plan.agenda.entries.find(y => y.id === id);
    return (
      !!x &&
      agendaCommit(
        agenda => {
          agenda.entries = agenda.entries.filter(y => y.id !== id);
        },
        $t('Deleted “{0}” from your calendar', x.title),
        { undo: true },
      )
    );
  },
  /**
   * Saves `values` for the day `day` (a day number) of appointment `id`: for that day only ('one'), that day and the
   * following ones ('following') or every day ('all'). See logic/agenda.js editOccurrence.
   */
  editOccurrence(id, day, values, scope) {
    const x = Store.plan.agenda.entries.find(y => y.id === id);
    if (!x) {
      return false;
    }
    const ids = [uid()];
    const when = D.label(day, { year: 'numeric' });
    const by = D.parse(values.date) - day;
    let label;
    if (scope === 'one') {
      label = $t('Changed “{0}” on {1} only', values.title, when);
    } else if (scope === 'following') {
      label = $t('Changed “{0}” from {1} on', values.title, when);
    } else {
      label = $t('Updated “{0}” in your calendar', values.title);
    }
    return agendaCommit(
      agenda => {
        let i = 0;
        editOccurrence(agenda, id, day, values, scope, () => ids[i++]);
      },
      label,
      undefined,
      p => moveTicks(p, tickMap(x, day, scope, by, ids[0])),
    );
  },
  /** Deletes day `day` of appointment `id`, that day and the following ones, or every day of it. */
  deleteOccurrence(id, day, scope) {
    const x = Store.plan.agenda.entries.find(y => y.id === id);
    if (!x) {
      return false;
    }
    const when = D.label(day, { year: 'numeric' });
    let label;
    if (scope === 'one' && x.repeat !== 'none') {
      label = $t('“{0}” left out on {1}', x.title, when);
    } else if (scope === 'following') {
      label = $t('Deleted “{0}” from {1} on', x.title, when);
    } else {
      label = $t('Deleted “{0}” from your calendar', x.title);
    }
    return agendaCommit(agenda => deleteOccurrence(agenda, id, day, scope), label, { undo: true });
  },
  /** Leaves one day (a day number) out of a repeating appointment; the other days stay. */
  skipDay(id, day) {
    return Actions.deleteOccurrence(id, day, 'one');
  },
  /**
   * Changes how the calendar looks: name, own calendars, what of the plan it shows, the number on each day, pins.
   * The log says exactly what changed (agendaChanges), one line per change even inside one Undo step (logEach).
   */
  setAgenda(values) {
    const before = Store.plan.agenda;
    const words = agendaChanges(before, { ...before, ...values }, Store.plan);
    return Store.commit(
      p => {
        Object.assign(p.agenda, values);
      },
      words.join(' · ') || $t('Updated your calendar'),
      { sameMoney: true, logEach: true },
    );
  },
  /** Deletes one own calendar with its appointments (normAgenda keeps at least one calendar). */
  removeCal(id) {
    const cal = Store.plan.agenda.cals.find(c => c.id === id);
    return (
      !!cal &&
      agendaCommit(
        agenda => {
          agenda.cals = agenda.cals.filter(c => c.id !== id);
          agenda.entries = agenda.entries.filter(e => e.cal !== id);
        },
        $t('Deleted the calendar “{0}”', cal.name),
        { undo: true, logEach: true },
      )
    );
  },
  /** Adds or updates a draft of `list` ('items' or 'trips'): shaped like a record of the plan, counted for nothing. */
  saveDraft(list, obj) {
    const isNew = !Store.plan.agenda.drafts[list].some(x => x.id === obj.id);
    return Store.commit(
      p => {
        const drafts = p.agenda.drafts[list];
        const i = drafts.findIndex(x => x.id === obj.id);
        if (i > -1) {
          drafts[i] = obj;
        } else {
          drafts.push(obj);
        }
      },
      isNew ? $t('Added the draft “{0}”', obj.name) : $t('Updated the draft “{0}”', obj.name),
      { sameMoney: true },
    );
  },
  removeDraft(list, id) {
    const x = Store.plan.agenda.drafts[list].find(y => y.id === id);
    return (
      !!x &&
      Store.commit(
        p => {
          p.agenda.drafts[list] = p.agenda.drafts[list].filter(y => y.id !== id);
        },
        $t('Deleted the draft “{0}”', x.name),
        { undo: true, sameMoney: true },
      )
    );
  },
  /* --- Forecast › Simulation (plan.sim, models/sim.js): nothing the projection reads, so it is kept (sameMoney).
         Every change says what it was in the activity log. --- */

  /** Months ahead, runs, seed, safety buffer. */
  setSim(values) {
    const parts = [];
    if (values.horizon !== undefined) {
      parts.push($t('{0} ahead', plural(values.horizon, 'month')));
    }
    if (values.runs !== undefined) {
      parts.push($t('{0} runs', values.runs));
    }
    if (values.seed !== undefined) {
      parts.push($t('seed {0}', values.seed));
    }
    if (values.buffer !== undefined) {
      parts.push(
        values.buffer === null ? $t('safety buffer: your cushion') : $t('safety buffer {0}', money(values.buffer)),
      );
    }
    return Store.commit(
      p => {
        Object.assign(p.sim, values);
      },
      $t('Simulation: {0}', parts.join(' · ')),
      { sameMoney: true },
    );
  },
  /**
   * The person's own values for something the simulation learned: a category (`section` 'cats', key: category),
   * an income ('incomes', key: its id) or the large irregular expenses ('events'). null goes back to what was learned.
   */
  setSimOverride(section, key, value) {
    let name;
    if (section === 'cats') {
      name = CAT_NAME[key] || key;
    } else if (section === 'incomes') {
      name = (Store.plan.incomes.find(i => i.id === key) || {}).name || key;
    } else {
      name = $t('Large irregular expenses');
    }
    return Store.commit(
      p => {
        if (section === 'events') {
          p.sim.events = value || {};
        } else if (value) {
          p.sim[section][key] = value;
        } else {
          delete p.sim[section][key];
        }
      },
      value ? $t('Simulation: your own values for {0}', name) : $t('Simulation: {0} back to what was learned', name),
      { sameMoney: true },
    );
  },
  /** Adds or updates a what-if scenario. */
  saveScenario(scenario) {
    const isNew = !Store.plan.sim.scenarios.some(x => x.id === scenario.id);
    return Store.commit(
      p => {
        const list = p.sim.scenarios;
        const i = list.findIndex(x => x.id === scenario.id);
        if (i > -1) {
          list[i] = scenario;
        } else {
          list.push(scenario);
        }
      },
      isNew ? $t('Added the what-if “{0}”', scenario.name) : $t('Updated the what-if “{0}”', scenario.name),
      { sameMoney: true },
    );
  },
  removeScenario(id) {
    const x = Store.plan.sim.scenarios.find(y => y.id === id);
    return (
      !!x &&
      Store.commit(
        p => {
          p.sim.scenarios = p.sim.scenarios.filter(y => y.id !== id);
        },
        $t('Deleted the what-if “{0}”', x.name),
        { undo: true, sameMoney: true },
      )
    );
  },

  /** Makes the chosen drafts part of the plan, in one step (one Undo takes all of them back to drafts). */
  applyDrafts(ids) {
    const agenda = Store.plan.agenda;
    const chosen = [
      ...agenda.drafts.items,
      ...agenda.drafts.trips,
      ...agenda.entries.filter(draftMoney).map(e => ({ id: e.id, name: e.title })),
    ].filter(x => ids.includes(x.id));
    if (!chosen.length) {
      return false;
    }
    return Store.commit(
      p => {
        moveDrafts(p, ids);
      },
      chosen.length === 1
        ? $t('Added “{0}” to your plan', chosen[0].name)
        : $t('Added {0} to your plan', plural(chosen.length, 'draft')),
      { undo: true },
    );
  },
};
