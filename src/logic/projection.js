/**
 * @file The engine: project(plan) turns a plan into a ledger and balances for every month. Pure.
 */
import { D, M, Period } from '../core/dates.js';
import { $t } from '../core/i18n.js';
import { has, isObj, r2 } from '../core/util.js';
import { loanCalc } from './loans.js';
import { recurs } from './recurs.js';

export { recurs };
import { occurrences, prepareEntries } from './occurrences.js';
import { tripParts } from './trips.js';
import { wishCalc } from './wishes.js';

/** The group of a one-off: a spend from a budget, money drawn from a card or savings (financing), money in, or a cost. */
function itemGroup(item) {
  if (item.budget) {
    return 'bill';
  }
  if (item.cover) {
    return 'transfer';
  }
  return item.kind === 'in' ? 'inc' : 'item';
}

/**
 * THE projection. plan -> { months[], loans{}, goals{}, summary }.
 * Every number shown anywhere in the app is read from this result.
 * Each ledger entry: { key, group, id, label, sub, cat, amount (+in / -out), date (day number or null = no fixed day) }.
 * opts.extra = [{k, amount, label}] adds hypothetical costs without touching the plan (what-if).
 * opts.today = day number, only used to decide whether a budget period is already over.
 */
export function project(plan, opts) {
  opts = opts || {};
  const settings = plan.settings;
  const s0 = M.parse(settings.startMonth);
  const n = settings.horizon;
  const months = [];
  const today = opts.today == null ? D.today() : opts.today;
  for (let k = s0; k < s0 + n; k++) {
    // the month as a "YYYY-MM" label, the name used by overrides and stored records
    const label = M.key(k);
    months.push({ k, key: label, start: Period.start(settings, k), end: Period.end(settings, k), entries: [] });
  }
  const put = (k, e) => {
    const i = k - s0;
    e.amount = r2(e.amount);
    if (e.date === undefined) {
      e.date = null;
    }
    if (i >= 0 && i < n && (e.amount !== 0 || e.skipped || e.budget)) {
      months[i].entries.push(e);
    }
  };
  const over = (monthKey, entryKey) => {
    const o = plan.overrides[monthKey];
    return o && has(o, entryKey) ? o[entryKey] : null;
  };
  const dayIn = (k, x) => Period.dayIn(settings, k, x.day, x.shift);

  // -- loans first: bills may depend on them
  const loans = {};
  for (const L of plan.loans) {
    const c = loanCalc(L);
    if (!c) {
      continue;
    }
    loans[L.id] = c;
    c.on = L.on;
    if (!L.on) {
      continue;
    }
    if (L.payout === 'cash') {
      put(c.f0 - 1, {
        key: `loan:${L.id}:in`,
        group: 'loan',
        id: L.id,
        label: L.name,
        sub: $t('Loan paid into your account'),
        cat: 'debt',
        amount: c.need,
      });
    }
    if (!L.feeFin && c.fee > 0) {
      put(c.f0 - 1, {
        key: `loan:${L.id}:fee`,
        group: 'loan',
        id: L.id,
        label: L.name,
        sub: $t('Opening fee'),
        cat: 'debt',
        amount: -c.fee,
      });
    }
    for (const row of c.sch) {
      const date = dayIn(row.k, L);
      put(row.k, {
        key: `loan:${L.id}`,
        group: 'loan',
        id: L.id,
        label: L.name,
        sub: $t('Payment {0} of {1}', row.m, L.term),
        cat: 'debt',
        amount: -row.pay,
        canExtra: true,
        date,
      });
      if (row.x > 0) {
        put(row.k, {
          key: `loan:${L.id}:x`,
          group: 'loan',
          id: L.id,
          label: L.name,
          sub: row.fe > 0 ? $t('Extra payment, incl. early repayment fee') : $t('Extra payment'),
          cat: 'debt',
          amount: -(row.x + row.fe),
          canExtra: true,
          date,
        });
      }
    }
  }
  // -- money logged against a budget, grouped by period and budget
  const spent = {};
  for (const item of plan.items) {
    if (item.budget) {
      const a = spent[item.month] || (spent[item.month] = {});
      a[item.budget] = r2((a[item.budget] || 0) + item.amount);
    }
  }
  // -- recurring income and bills (with per-month overrides)
  const recur = (rows, group, sign) => {
    for (const r of rows) {
      const takeover =
        group === 'bill' && r.untilLoan && loans[r.untilLoan] && loans[r.untilLoan].on ? loans[r.untilLoan] : null;
      for (const m of months) {
        if (takeover && m.k >= takeover.f0) {
          break;
        }
        if (!recurs(r, m.k, s0)) {
          continue;
        }
        const entryKey = group + ':' + r.id;
        const o = over(m.key, entryKey);
        const amount = o === null ? r.amount : o;
        const e = {
          key: entryKey,
          group,
          id: r.id,
          label: r.name,
          cat: r.cat,
          amount: sign * amount,
          base: r.amount,
          over: o !== null,
          skipped: o === 0,
          vary: !!r.vary,
          note: r.note,
          account: r.account || null,
          payTo: r.payTo || null,
          loanStop: r.untilLoan && loans[r.untilLoan] && loans[r.untilLoan].on ? loans[r.untilLoan].f0 : null,
          date: group === 'inc' && !r.day ? m.start : dayIn(m.k, r),
        };
        if (r.budget) {
          // A budget is spent bit by bit. What was logged is real money out (its own dated entries, below);
          // this entry is only what is still reserved. Once the period is over, the unspent rest is released.
          // Ticking a budget means "done for this month": with spends logged the rest is released, with none it counts as fully used.
          const sp = (spent[m.key] || {})[r.id] || 0;
          const done = has(plan.paid[m.key] || {}, entryKey);
          const over2 = sp > 0 && (m.end < today || done);
          const ro = plan.reserveOver[m.key];
          const reserveOver = !!ro && has(ro, entryKey);
          const reserve = reserveOver ? ro[entryKey] : r.reserve !== false;
          // A limit ("tracked" budget) sets nothing aside in any month: only the spends you logged take money, and they
          // take it from what is free. This holds for future months too (product decision, v0.9: the audit's B1,
          // counting the limit in months that have not started, was tried and dropped).
          e.budget = { planned: amount, spent: sp, left: r2(amount - sp), closed: over2, done, reserve, reserveOver };
          e.amount = !reserve || over2 ? 0 : -Math.max(0, amount - sp);
          e.date = null;
        }
        put(m.k, e);
      }
    }
  };
  recur(plan.incomes, 'inc', 1);
  recur(plan.bills, 'bill', -1);
  // -- one-offs, and spends logged against a budget
  const billName = Object.fromEntries(plan.bills.map(b => [b.id, b.name]));
  for (const item of plan.items) {
    put(M.parse(item.month), {
      key: 'item:' + item.id,
      group: itemGroup(item),
      id: item.id,
      label: item.name,
      cat: item.cat,
      amount: item.kind === 'in' ? item.amount : -item.amount,
      date: D.parse(item.date),
      of: item.budget,
      note: item.note,
      account: item.account,
      cover: item.cover || null,
      sub: item.budget ? $t('From “') + billName[item.budget] + '”' : item.cover ? $t('Covers this month') : undefined,
    });
  }
  // -- trips: each cost lands in the month it is PAID, not the month of the trip
  for (const t of plan.trips) {
    if (!t.on) {
      continue;
    }
    const tripMonth = M.parse(t.month);
    let total = 0;
    for (const item of t.items) {
      total += item.amount;
    }
    for (const x of tripParts(settings, t)) {
      put(x.k, {
        key: `trip:${t.id}:${x.id}`,
        group: 'trip',
        id: t.id,
        label: x.name || $t('Trip cost'),
        sub:
          t.name +
          (x.of
            ? ' · ' + $t('{0} of {1} trip days', x.days, x.of)
            : x.k !== tripMonth
              ? $t(' · trip in ') + M.label(tripMonth)
              : ''),
        cat: 'travel',
        amount: -x.amount,
      });
    }
    if (t.reserve && t.budget > total) {
      put(tripMonth, {
        key: `trip:${t.id}:r`,
        group: 'trip',
        id: t.id,
        label: $t('Trip budget not planned yet'),
        sub: t.name,
        cat: 'travel',
        amount: -(t.budget - total),
      });
    }
  }
  // -- savings goals: money leaves cash and builds a pot (with optional interest); optional release brings it back
  const goals = {};
  for (const G of plan.goals) {
    let bal = G.saved;
    let reached = G.target > 0 && bal >= G.target ? s0 : null;
    let released = false;
    let interest = 0;
    let put2 = 0;
    const series = [];
    const f = M.parse(G.from);
    const t = M.parse(G.to);
    const rel = M.parse(G.release);
    for (const m of months) {
      if (rel !== null && m.k === rel && !released) {
        put(m.k, {
          key: `goal:${G.id}:out`,
          group: 'goal',
          id: G.id,
          label: G.name,
          sub: $t('Savings taken out to spend'),
          cat: 'savings',
          amount: bal,
          date: m.start,
        });
        bal = 0;
        released = true;
      } else if (!released) {
        if (G.rate > 0 && bal > 0) {
          const i = r2((bal * G.rate) / 1200);
          bal = r2(bal + i);
          interest += i;
        }
        if ((rel === null || m.k < rel) && (f === null || m.k >= f) && (t === null || m.k <= t)) {
          // a goal that is switched off keeps what is already in the pot, but takes no new money from the plan
          let c = G.on ? G.monthly : 0;
          if (G.target > 0) {
            c = Math.min(c, Math.max(0, G.target - bal));
          }
          if (c > 0) {
            put(m.k, {
              key: 'goal:' + G.id,
              group: 'goal',
              id: G.id,
              label: G.name,
              sub: $t('Moved to savings'),
              cat: 'savings',
              amount: -c,
              date: m.start,
            });
            bal = r2(bal + c);
            put2 += c;
          }
        }
        if (reached === null && G.target > 0 && bal >= G.target) {
          reached = m.k;
        }
      }
      series.push(bal);
    }
    goals[G.id] = { series, reached, end: bal, released, interest: r2(interest), paidIn: r2(put2) };
  }
  // -- wishlist: only wishes switched "in my plan" touch the ledger
  const wishes = {};
  for (const W of plan.wishes) {
    const c = wishCalc(W, s0);
    wishes[W.id] = c;
    if (W.on) {
      for (const r of c.rows) {
        put(r.k, {
          key: r.key,
          group: 'wish',
          id: W.id,
          label: W.name,
          sub: r.sub,
          cat: 'shopping',
          amount: -r.amount,
        });
      }
    }
  }
  // -- My calendar: appointments with money that counts (switched on, or applied from the calendar's drafts), one
  //    line per occurrence, on its first day, in the budget month of that day
  const counted = plan.agenda ? plan.agenda.entries.filter(e => e.on && e.amount > 0) : [];
  if (counted.length) {
    const first = months[0].start;
    const last = months[n - 1].end;
    for (const p of prepareEntries(counted)) {
      const e = p.entry;
      for (const day of occurrences(p, first, last)) {
        if (day < first) {
          continue; // started before the plan: its money was spent then
        }
        put(Period.of(settings, day), {
          key: `appt:${e.id}:${day}`,
          group: 'item',
          id: e.id,
          label: e.title,
          sub: $t('Appointment'),
          cat: e.cat,
          amount: e.kind === 'in' ? e.amount : -e.amount,
          date: day,
          note: e.note,
          appt: true,
        });
      }
    }
  }
  // -- what-if extras
  for (const x of opts.extra || []) {
    put(x.k, { key: 'whatif', group: 'item', label: x.label || $t('What-if'), cat: 'other', amount: -x.amount });
  }

  // -- roll the ledger into balances
  // -- ticks, and things paid with a credit card: those do not take cash, they add to what is owed on the card
  const cardIds = plan.accounts.filter(a => a.type === 'credit').map(a => a.id);
  const charges = months.map(() => ({}));
  const today_i = Period.of(settings, today) - s0;
  const checked = months.map(m => (plan.fixes[m.key] ? D.parse(plan.fixes[m.key].d) : null));
  const beforeCheck = (i, pr) => checked[i] !== null && D.parse(pr.d) !== null && D.parse(pr.d) <= checked[i];
  months.forEach((m, i) => {
    const paidThisMonth = plan.paid[m.key] || {};
    for (const e of m.entries) {
      const pr = paidThisMonth[e.key];
      e.paid = !!e.of || !!pr;
      e.paidDay = isObj(pr) ? D.parse(pr.d) : null;
      e.paidFrom = isObj(pr) && pr.a ? pr.a : e.account || null;
      // money brought in from a credit card to cover a short month: cash comes in, and the card owes that much more
      if (e.cover && cardIds.includes(e.cover) && !(isObj(pr) && (pr.v !== 0 || beforeCheck(i, pr)))) {
        charges[i][e.cover] = r2((charges[i][e.cover] || 0) + e.amount);
      }
      if (e.amount < 0 && !e.budget && cardIds.includes(e.paidFrom)) {
        // a card purchase is already inside what you owe on the card when its tick moved the money, or when it was ticked
        // no later than the day you last checked your balances; otherwise it is added to the card in its month
        const inside = isObj(pr) && pr.a === e.paidFrom && (pr.v !== 0 || beforeCheck(i, pr));
        if (!inside) {
          charges[i][e.paidFrom] = r2((charges[i][e.paidFrom] || 0) - e.amount);
        }
        e.onCard = e.paidFrom;
        e.charged = -e.amount;
        e.amount = 0;
      }
    }
  });
  // -- each credit card month by month: interest, new charges, and the bills that pay it off
  const cards = {};
  for (const a of plan.accounts) {
    if (a.type !== 'credit') {
      continue;
    }
    let owed = a.owed;
    const ser = [];
    // per month: what the plan still puts on the card, and what the plan still pays off (both not yet inside "owed")
    const added = [];
    const paidOff = [];
    months.forEach((m, i) => {
      let addedNow = 0;
      let paidNow = 0;
      if (i >= today_i) {
        if (i > today_i && a.apr > 0) {
          owed = r2(owed * (1 + a.apr / 1200));
        }
        addedNow = charges[i][a.id] || 0;
        owed = r2(owed + addedNow);
        for (const e of m.entries) {
          const pr = (plan.paid[m.key] || {})[e.key];
          const done = pr === true || (isObj(pr) && (pr.t === a.id || beforeCheck(i, pr)));
          if (e.payTo === a.id && e.amount < 0 && !done) {
            paidNow = r2(paidNow + Math.min(owed, -e.amount));
            owed = r2(Math.max(0, owed + e.amount));
          }
        }
        if (
          plan.bills.some(
            b =>
              b.payTo === a.id &&
              b.untilLoan &&
              loans[b.untilLoan] &&
              loans[b.untilLoan].on &&
              m.k >= loans[b.untilLoan].f0,
          )
        ) {
          owed = 0;
        } // a loan took the card debt over
      }
      ser.push(owed);
      added.push(r2(addedNow));
      paidOff.push(paidNow);
    });
    cards[a.id] = { series: ser, limit: a.limit, added, paidOff };
  }
  let bal = settings.opening;
  const sum = { min: Infinity, minK: s0, negN: 0, tightN: 0, firstNeg: null, net: 0, inc: 0, out: 0 };
  months.forEach((m, i) => {
    m.open = bal;
    let inc = 0;
    let out = 0;
    let moved = 0;
    let paid = 0;
    const g = { inc: 0, bill: 0, item: 0, trip: 0, loan: 0, goal: 0, wish: 0, transfer: 0 };
    for (const e of m.entries) {
      // Money in and money out describe what you earn and spend (v0.9 audit, B2):
      // - money drawn from a credit card or savings is financing, not income: it moves cash but is neither;
      // - a refund is spending that came back, so it lowers money out instead of raising money in.
      if (e.group === 'transfer') {
        moved += e.amount;
      } else if (e.amount > 0 && e.cat === 'refund') {
        out -= e.amount;
      } else if (e.amount > 0) {
        inc += e.amount;
      } else {
        out -= e.amount;
      }
      g[e.group] += e.amount;
      if (e.paid && e.amount < 0) {
        paid -= e.amount;
      }
    }
    m.inc = r2(inc);
    m.out = r2(out);
    m.net = r2(inc - out);
    m.moved = r2(moved);
    m.paidOut = r2(paid);
    m.g = g;
    // What you should have right now = what the month started with, plus every line that is already paid (ticked, or a logged spend).
    // What is still to come = every line that is not. The month ends at one plus the other, so ticking moves an amount from
    // "to come" to "have now" and the end stays the same. A correction ("I really have X") is one more paid line: the difference
    // between X and the paid lines on that day, which is money that moved without being in the plan.
    const fix = plan.fixes[m.key] || null;
    let now = m.open;
    let todo = 0;
    for (const e of m.entries) {
      e.still = e.paid ? 0 : e.amount;
      if (e.paid) {
        now += e.amount;
      } else {
        todo += e.amount;
      }
    }
    if (fix) {
      m.entries.push({
        key: 'adjust',
        group: 'adjust',
        label: fix.a < 0 ? $t('Unplanned spending') : $t('Unplanned income'),
        amount: fix.a,
        date: D.parse(fix.d),
        paid: true,
        still: 0,
        fix: true,
      });
      now += fix.a;
    }
    m.now = r2(now);
    m.todo = r2(todo);
    m.fix = fix ? { d: D.parse(fix.d), a: fix.a } : null;
    bal = r2(bal + m.net + m.moved + (fix ? fix.a : 0));
    m.close = bal;
    m.cardDebt = r2(Object.values(cards).reduce((s, c) => s + c.series[i], 0));
    m.credit = r2(Object.values(cards).reduce((s, c) => s + Math.max(0, c.limit - c.series[i]), 0));
    m.debt = r2(
      plan.loans.reduce((s, L) => s + (L.on && loans[L.id] ? loans[L.id].balAt(m.k) : 0), 0) +
        plan.wishes.reduce((s, W) => s + (W.on ? wishes[W.id].owed(m.k) : 0), 0) +
        m.cardDebt,
    );
    m.savings = r2(
      plan.goals.reduce((s, G) => s + goals[G.id].series[i], 0) +
        plan.wishes.reduce((s, W) => s + (W.on ? wishes[W.id].pot(m.k) : 0), 0),
    );
    m.worth = r2(m.close + m.savings - m.debt);
    m.status = bal < 0 ? 'neg' : bal < settings.cushion ? 'tight' : 'ok';
    if (bal < sum.min) {
      sum.min = bal;
      sum.minK = m.k;
    }
    if (m.status === 'neg') {
      sum.negN++;
      if (sum.firstNeg === null) {
        sum.firstNeg = m.k;
      }
    } else if (m.status === 'tight') {
      sum.tightN++;
    }
    sum.net += m.net;
    sum.inc += m.inc;
    sum.out += m.out;
  });
  const last = months[n - 1];
  const on = plan.loans.filter(L => L.on && loans[L.id]);
  Object.assign(sum, {
    end: last.close,
    endK: last.k,
    avgNet: sum.net / n,
    avgInc: sum.inc / n,
    avgOut: sum.out / n,
    debtFree: on.length ? Math.max(...on.map(L => loans[L.id].end)) : null,
    s0,
    n,
  });
  return { months, loans, goals, wishes, cards, summary: sum };
}
