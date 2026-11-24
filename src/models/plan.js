/**
 * @file The plan schema. normPlan is the single validation and migration gate: every plan passes through it.
 */
import { APP } from '../config.js';
import { D, M, Period } from '../core/dates.js';
import { $t } from '../core/i18n.js';
import { ID_RE, clamp, isObj, newId, r2 } from '../core/util.js';
import { project } from '../logic/projection.js';
import { normAgenda } from './agenda.js';
import { normSim } from './sim.js';
import { CATS, EVERY, INCATS, KEY_RE, SHIFTS } from './categories.js';
import {
  DELETED_FULL,
  DELETED_MAX,
  PLAN_FIELDS,
  byDeletion,
  deletedRef,
  isDeletedRef,
  normKeyTimes,
  timestamp as ts,
} from './records.js';

/**
 * Returns a clean, complete plan no matter what it is given. Idempotent. Also migrates older versions (missing fields
 * get defaults).
 *
 * Records (models/records.js): every account, income, bill, item, trip, trip cost, loan, goal and wish keeps its id
 * (a missing or repeated one gets a UUID) and its dates: createdAt, updatedAt, deletedAt (epoch ms; null when not
 * set). The lists hold live records only: a record with deletedAt is moved to `deleted`, where deleted records are
 * kept (the newest DELETED_MAX of each kind) for a future sync. Setting the dates is the store's job (stampPlan).
 */
export function normPlan(p) {
  p = isObj(p) ? p : {};
  const ids = new Set();
  /** live records get unique ids; deleted ones keep theirs (checked against the live ones at the end) */
  let dead = false;
  const id = v => {
    let x = typeof v === 'string' && ID_RE.test(v) ? v : newId();
    if (dead) {
      return x;
    }
    while (ids.has(x)) {
      x = newId();
    }
    ids.add(x);
    return x;
  };
  /** Records found in a list but marked deleted: kind → [[record, owner trip id]]. */
  const moved = {};
  const str = (v, max = 80) =>
    typeof v === 'string'
      ? v
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .trim()
          .slice(0, max)
      : '';
  const num = (v, lo, hi, fallback) => {
    v = typeof v === 'string' ? parseFloat(v) : v;
    return typeof v === 'number' && isFinite(v) ? clamp(r2(v), lo, hi) : fallback;
  };
  const int = (v, lo, hi, fallback) => Math.round(num(v, lo, hi, fallback));
  const mon = v => (M.parse(v) === null ? null : v);
  const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
  /** A list of records of one kind: live ones, cleaned by fn, each with its dates. */
  const list = (v, fn, max = APP.maxList, kind, owner) => {
    if (!Array.isArray(v)) {
      return [];
    }
    let live = v;
    if (v.some(x => isObj(x) && ts(x.deletedAt) !== null)) {
      live = [];
      for (const x of v) {
        if (isObj(x) && ts(x.deletedAt) !== null) {
          (moved[kind] || (moved[kind] = [])).push([x, owner]);
        } else {
          live.push(x);
        }
      }
    }
    return live
      .slice(0, max)
      .filter(isObj)
      .map(x => {
        const r = fn(x);
        r.createdAt = ts(x.createdAt) ?? ts(x.updatedAt); // left out of the stored text when equal (planText)
        r.updatedAt = ts(x.updatedAt);
        r.deletedAt = null;
        return r;
      });
  };
  const monthMap = (v, fn) => {
    const o = {};
    if (isObj(v)) {
      for (const k of Object.keys(v).sort()) {
        if (M.parse(k) !== null) {
          const x = fn(v[k]);
          if (x !== undefined) {
            o[k] = x;
          }
        }
      }
    }
    return o;
  };
  const keyMap = (v, fn) => {
    const o = {};
    if (isObj(v)) {
      for (const k of Object.keys(v).sort()) {
        if (KEY_RE.test(k)) {
          const x = fn(v[k]);
          if (x !== undefined) {
            o[k] = x;
          }
        }
      }
    }
    return Object.keys(o).length ? o : undefined;
  };
  const catIds = CATS.map(c => c[0]);
  const inIds = INCATS.map(c => c[0]);
  const shifts = SHIFTS.map(s => s[0]);
  const when = x => ({ day: int(x.day, 0, 31, 0), shift: pick(x.shift, shifts, 'none') });
  const note = x => str(x.note, 400);
  const day = v => (D.parse(v) === null ? null : v);
  const url = v => {
    v = str(v, 300);
    return /^https?:\/\/[^\s<>"']+$/i.test(v) ? v : '';
  };
  // accounts: where the money is today. Spendable = debit + cash. A credit card holds what you could still borrow (available) and what you owe.
  // accounts: where the money is. Spendable = bank accounts + cash. A credit card has a limit and what you owe on it;
  // what is still available (limit - owed) is emergency money, never money to spend. One spendable account is the main one.
  const accountOf = x => {
    const type = pick(x.type, ['debit', 'cash', 'savings', 'credit'], 'debit');
    const cr = type === 'credit';
    const owed = cr ? num(x.owed, 0, 1e9, 0) : 0;
    return {
      id: id(x.id),
      name: str(x.name, 40) || $t('Account'),
      type,
      balance: cr ? 0 : num(x.balance, -1e9, 1e9, 0),
      limit: cr
        ? x.limit === undefined
          ? Math.max(owed, num(x.balance, 0, 1e9, 0))
          : Math.max(owed, num(x.limit, 0, 1e9, 0))
        : 0,
      owed:
        cr && x.limit === undefined
          ? Math.max(0, r2(Math.max(owed, num(x.balance, 0, 1e9, 0)) - num(x.balance, 0, 1e9, 0)))
          : owed,
      apr: cr ? num(x.apr, 0, 100, 0) : 0,
      main: !cr && type !== 'savings' && !!x.main,
      note: note(x),
    };
  };
  const accounts = list(p.accounts, accountOf, 30, 'accounts');
  {
    const pay = accounts.filter(a => a.type === 'debit' || a.type === 'cash');
    const m = pay.find(a => a.main) || pay.find(a => a.type === 'debit') || pay[0];
    accounts.forEach(a => {
      a.main = a === m;
    });
  }
  const accIds = accounts.map(a => a.id);

  const st = isObj(p.settings) ? p.settings : {};
  let guess = 'eu';
  try {
    const l =
      typeof st.locale === 'string' && st.locale
        ? st.locale
        : (typeof navigator !== 'undefined' && navigator.language) || 'en-GB';
    guess = new Intl.NumberFormat(l).format(1.5).includes(',') ? 'eu' : 'us';
  } catch (e) {}
  const settings = {
    currency: typeof st.currency === 'string' && /^[A-Z]{3}$/.test(st.currency) ? st.currency : 'EUR',
    numFmt: pick(st.numFmt, ['eu', 'us'], guess),
    dateFmt: pick(st.dateFmt, ['dmy', 'mdy'], st.locale === 'en-US' ? 'mdy' : 'dmy'),
    startMonth: mon(st.startMonth) || M.key(M.now()),
    horizon: int(st.horizon, 3, 120, 24),
    opening: num(st.opening, -1e9, 1e9, 0),
    cushion: num(st.cushion, 0, 1e9, 0),
    cents: !!st.cents,
    hoursMonth: num(st.hoursMonth, 1, 744, 160),
    payDay: int(st.payDay, 0, 31, 0),
    payShift: pick(st.payShift, shifts, 'none'),
  };
  settings.payFor = pick(st.payFor, ['same', 'next'], settings.payDay > 15 ? 'next' : 'same');
  const range = x => {
    const from = mon(x.from);
    let to = mon(x.to);
    if (from && to && M.parse(to) < M.parse(from)) {
      to = from;
    }
    return { from, to };
  };
  const rec = (x, cats, fallback) => ({
    id: id(x.id),
    name: str(x.name) || $t('Untitled'),
    amount: num(x.amount, 0, 1e9, 0),
    cat: pick(x.cat, cats, fallback),
    every: pick(
      +x.every,
      EVERY.map(e => e[0]),
      1,
    ),
    ...range(x),
    ...when(x),
    note: note(x),
    account: accIds.includes(x.account) ? x.account : null,
  });

  const loanOf = x => ({
    id: id(x.id),
    name: str(x.name) || $t('Loan'),
    on: x.on !== false,
    amount: num(x.amount, 0, 1e9, 0),
    rate: num(x.rate, 0, 100, 0),
    term: int(x.term, 1, 600, 12),
    first: mon(x.first) || M.key(M.parse(settings.startMonth) + 1),
    ...when(x),
    note: note(x),
    feePct: num(x.feePct, 0, 20, 0),
    feeMin: num(x.feeMin, 0, 1e6, 0),
    feeFin: !!x.feeFin,
    payout: pick(x.payout, ['direct', 'cash'], 'direct'),
    extra: num(x.extra, 0, 1e9, 0),
    extras: monthMap(x.extras, v => num(v, 0, 1e9, undefined)),
    early1: num(x.early1, 0, 10, 0),
    early2: num(x.early2, 0, 10, 0),
  });
  const loans = list(p.loans, loanOf, 50, 'loans');
  const loanIds = loans.map(l => l.id);
  const creditIds = accounts.filter(a => a.type === 'credit').map(a => a.id);
  const billOf = x => ({
    ...rec(x, catIds, 'other'),
    budget: !!x.budget,
    // a budget either sets its money aside every month (reserve) or only counts what you really spend from it
    reserve: !x.budget || x.reserve !== false,
    vary: !x.budget && !!x.vary,
    payTo: !x.budget && creditIds.includes(x.payTo) ? x.payTo : null,
    untilLoan: loanIds.includes(x.untilLoan) ? x.untilLoan : null,
  });
  const bills = list(p.bills, billOf, APP.maxList, 'bills');
  const incomeOf = x => rec(x, inIds, 'salary');
  const budgetIds = bills.filter(b => b.budget).map(b => b.id);

  /** A one-off: a purchase, a spend from a budget, money in. Also cleans the drafts of My calendar (models/agenda.js). */
  const itemOf = x => {
    const kind = pick(x.kind, ['out', 'in'], 'out');
    const dn = D.parse(x.date);
    // an exact day decides which budget period the item belongs to
    return {
      id: id(x.id),
      name: str(x.name) || $t('Untitled'),
      amount: num(x.amount, 0, 1e9, 0),
      kind,
      month: dn !== null ? M.key(Period.of(settings, dn)) : mon(x.month) || settings.startMonth,
      date: dn !== null ? x.date : null,
      cat: kind === 'in' ? pick(x.cat, inIds, 'other') : pick(x.cat, catIds, 'other'),
      budget: kind === 'out' && budgetIds.includes(x.budget) ? x.budget : null,
      account: accIds.includes(x.account) ? x.account : null,
      cover: kind === 'in' && accIds.includes(x.cover) ? x.cover : null,
      note: note(x),
    };
  };
  const tripItemOf = i => ({
    id: id(i.id),
    name: str(i.name),
    amount: num(i.amount, 0, 1e9, 0),
    pay: mon(i.pay),
    note: note(i),
  });
  /** A trip, event or someday idea with its costs. Also cleans the drafts of My calendar. */
  const tripOf = x => {
    // kind 'idea' = somewhere you would like to go one day: never counted until you plan it
    const kind = pick(x.kind, ['trip', 'event', 'idea'], 'trip');
    const from = day(x.from);
    let to = day(x.to);
    if (!from || (to && D.parse(to) < D.parse(from))) {
      to = from ? (to && D.parse(to) >= D.parse(from) ? to : null) : null;
    }
    const tripId = id(x.id);
    return {
      id: tripId,
      name: str(x.name) || $t('Trip'),
      kind,
      month: mon(x.month) || settings.startMonth,
      from,
      to,
      on: kind === 'idea' ? false : x.on !== false,
      budget: num(x.budget, 0, 1e9, 0),
      reserve: x.reserve !== false,
      note: note(x),
      items: list(x.items, tripItemOf, 100, 'tripItems', tripId),
    };
  };
  const goalOf = x => ({
    id: id(x.id),
    name: str(x.name) || $t('Goal'),
    on: x.on !== false,
    target: num(x.target, 0, 1e9, 0),
    saved: num(x.saved, 0, 1e9, 0),
    monthly: num(x.monthly, 0, 1e9, 0),
    ...range(x),
    by: mon(x.by),
    rate: num(x.rate, 0, 30, 0),
    release: mon(x.release),
    note: note(x),
  });
  const wishOf = x => ({
    id: id(x.id),
    name: str(x.name) || $t('Wish'),
    price: num(x.price, 0, 1e9, 0),
    how: pick(x.how, ['cash', 'save', 'finance'], 'cash'),
    month: mon(x.month) || settings.startMonth,
    months: int(x.months, 1, 120, 12),
    apr: num(x.apr, 0, 60, 0),
    flex: !!x.flex,
    on: !x.flex && !!x.on,
    note: note(x),
    link: url(x.link),
  });

  const out = {
    id: typeof p.id === 'string' && ID_RE.test(p.id) ? p.id : newId(),
    name: str(p.name, 40) || $t('My plan'),
    settings,
    accounts,
    incomes: list(p.incomes, incomeOf, APP.maxList, 'incomes'),
    bills,
    items: list(p.items, itemOf, 5000, 'items'),
    trips: list(p.trips, tripOf, 200, 'trips'),
    loans,
    goals: list(p.goals, goalOf, 100, 'goals'),
    wishes: list(p.wishes, wishOf, 100, 'wishes'),
    // a correction for one month: on day d, what you really had differed from the paid lines by a (negative = spending that is not in the plan)
    fixes: monthMap(p.fixes, v =>
      isObj(v) && num(v.a, -1e9, 1e9, undefined) !== undefined ? { d: day(v.d), a: num(v.a, -1e9, 1e9, 0) } : undefined,
    ),
    overrides: monthMap(p.overrides, v => keyMap(v, a => num(a, 0, 1e9, undefined))),
    // a budget can be reserved or tracked for one month only, whatever its usual choice is
    reserveOver: monthMap(p.reserveOver, v => keyMap(v, a => (typeof a === 'boolean' ? a : undefined))),
    // a tick: true (old data), or { d: day it was ticked, a: account it was paid from, v: amount moved, t: card it paid off }
    paid: monthMap(p.paid, v =>
      keyMap(v, a =>
        a === true
          ? true
          : isObj(a)
            ? {
                d: day(a.d),
                a: accIds.includes(a.a) ? a.a : null,
                v: num(a.v, -1e9, 1e9, 0),
                t: creditIds.includes(a.t) ? a.t : null,
              }
            : undefined,
      ),
    ),
    notes: monthMap(p.notes, v => (typeof v === 'string' && v.trim() ? v.slice(0, 600) : undefined)),
  };
  // My calendar, last: the plan's own records claim their ids first (a draft never takes the id of one), and its pins
  // are checked against the clean lists
  out.agenda = normAgenda(p.agenda, { id, str, num, day, note, item: itemOf, trip: tripOf, records: out });
  // Forecast › Simulation: settings, the person's own values for what it learned, what-if scenarios (models/sim.js)
  out.sim = normSim(p.sim, { id, incomeIds: out.incomes.map(x => x.id), goalIds: out.goals.map(x => x.id) });
  // deleted records: those kept in `deleted`, and those found in a list with deletedAt. Each keeps its id (a live
  // record with the same id wins); the newest deletion of an id is kept, the newest DELETED_MAX of each kind.
  dead = true;
  const kept = isObj(p.deleted) ? p.deleted : {};
  const deletedOf = (kind, build) => {
    const found = new Map();
    const add = (x, owner) => {
      const key = isObj(x) && typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : null;
      const at = key && ts(x.deletedAt);
      if (at === null || key === null || ids.has(key)) {
        return;
      }
      const before = found.get(key);
      if (!before || at >= ts(before[0].deletedAt)) {
        found.set(key, [x, owner]);
      }
    };
    (Array.isArray(kept[kind]) ? kept[kind] : []).forEach(x => add(x, isObj(x) ? x.tripId : null));
    (moved[kind] || []).forEach(([x, owner]) => add(x, owner));
    const sorted = [...found.values()]
      .sort((a, b) =>
        byDeletion({ id: a[0].id, deletedAt: ts(a[0].deletedAt) }, { id: b[0].id, deletedAt: ts(b[0].deletedAt) }),
      )
      .slice(-DELETED_MAX);
    // the older ones are kept as markers only (models/records.js keepDeleted)
    const firstFull = sorted.length - DELETED_FULL;
    return sorted.map(([x, owner], i) => {
      // older ones, and markers that arrived as markers, stay markers (id and dates only)
      const marker = i < firstFull || isDeletedRef(x);
      const r = marker ? { id: x.id } : build(x);
      r.createdAt = ts(x.createdAt) ?? ts(x.updatedAt);
      r.updatedAt = ts(x.updatedAt);
      r.deletedAt = ts(x.deletedAt);
      if (kind === 'tripItems') {
        r.tripId = typeof owner === 'string' && ID_RE.test(owner) ? owner : null;
      }
      return marker ? deletedRef(r) : r;
    });
  };
  out.deleted = {
    accounts: deletedOf('accounts', accountOf),
    incomes: deletedOf('incomes', incomeOf),
    bills: deletedOf('bills', billOf),
    items: deletedOf('items', itemOf),
    trips: deletedOf('trips', tripOf),
    loans: deletedOf('loans', loanOf),
    goals: deletedOf('goals', goalOf),
    wishes: deletedOf('wishes', wishOf),
    tripItems: deletedOf('tripItems', tripItemOf),
  };
  const times = isObj(p.fieldsUpdatedAt) ? p.fieldsUpdatedAt : {};
  out.fieldsUpdatedAt = Object.fromEntries(PLAN_FIELDS.map(f => [f, ts(times[f])]));
  out.keysUpdatedAt = normKeyTimes(p.keysUpdatedAt, out.settings.startMonth);
  out.createdAt = ts(p.createdAt) ?? ts(p.updatedAt);
  out.updatedAt = ts(p.updatedAt);
  out.deletedAt = null;
  return isObj(p.snaps) || isObj(p.actuals) ? migrateFixes(out, p) : out;
}
/** Versions up to 5 stored "real balance on a day" and "month-end check-in". Both become one correction per month. The result has neither, so this runs once. */
function migrateFixes(plan, old) {
  const settings = plan.settings;
  const todo = [];
  const num = v => (v === null || !isFinite(+v) ? null : +v);
  if (isObj(old.snaps)) {
    for (const k of Object.keys(old.snaps).sort()) {
      const d = D.parse(k);
      const x = old.snaps[k];
      const v = num(isObj(x) ? x.b : x);
      if (d !== null && v !== null) {
        todo.push({ mk: M.key(Period.of(settings, d)), d: k, now: v });
      }
    }
  }
  if (isObj(old.actuals)) {
    for (const k of Object.keys(old.actuals).sort()) {
      if (M.parse(k) !== null && num(old.actuals[k]) !== null) {
        todo.push({ mk: k, d: '9999', end: num(old.actuals[k]) });
      }
    }
  }
  todo.sort((x, y) => (x.mk + x.d < y.mk + y.d ? -1 : 1));
  const had = new Set(Object.keys(plan.fixes));
  todo.forEach((t, i) => {
    if (
      had.has(t.mk) ||
      (t.now !== undefined && todo[i + 1] && todo[i + 1].mk === t.mk && todo[i + 1].now !== undefined)
    ) {
      return;
    } // only the latest real balance of a month counts
    const m = project(plan).months.find(x => x.key === t.mk);
    if (!m) {
      return;
    }
    const f = plan.fixes[t.mk] || { d: t.now !== undefined ? t.d : D.key(m.end), a: 0 };
    f.a = r2(f.a + (t.now !== undefined ? t.now - m.now : t.end - m.close));
    plan.fixes[t.mk] = f;
  });
  return plan;
}
