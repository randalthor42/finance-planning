/**
 * @file Where trip costs land when a trip crosses a payday. Pure.
 */
import { D, M, Period } from '../core/dates.js';
import { r2 } from '../core/util.js';

/** The budget months a trip with dates runs through, with the days in each: [[k, days], …]. One entry unless it crosses a payday. */
export function tripSpan(S, t) {
  const a = D.parse(t.from);
  const b = D.parse(t.to);
  if (a === null || b === null || b <= a) {
    return [];
  }
  const out = [];
  for (let k = Period.of(S, a), last = Period.of(S, b); k <= last; k++) {
    out.push([k, Math.min(b, Period.end(S, k)) - Math.max(a, Period.start(S, k)) + 1]);
  }
  return out;
}
/** Where each trip cost lands: [{ id, name, amount, k, days?, of? }]. A cost with its own month goes there. Otherwise it goes to
 *  the trip month, or, when the trip crosses a payday, it is shared between the salary months by the trip days in each. */
export function tripParts(S, t) {
  const tripMonth = M.parse(t.month);
  const span = tripSpan(S, t);
  const n = span.reduce((s, x) => s + x[1], 0);
  const unit = S.cents ? 100 : 1;
  const out = [];
  for (const item of t.items) {
    if (!item.amount) {
      continue;
    }
    if (item.pay || span.length < 2) {
      out.push({ id: item.id, name: item.name, amount: item.amount, k: item.pay ? M.parse(item.pay) : tripMonth });
      continue;
    }
    let rest = item.amount;
    span.forEach(([k, days], i) => {
      const v = i === span.length - 1 ? r2(rest) : Math.round(((item.amount * days) / n) * unit) / unit;
      rest -= v;
      if (v) {
        out.push({ id: item.id, name: item.name, amount: v, k, days, of: n });
      }
    });
  }
  return out;
}

/* ===== 4. DATA LAYER =================================================
   Everything below this line down to section 6 is the "backend" of the app: storage, state, and
   the list of changes a user can make. None of it touches the page. In a Vue + Symfony version:
     LocalStorageAdapter -> an HTTP client for your API
     PlanStore           -> a Pinia store (same methods)
     Actions             -> one API endpoint / controller action each
     normPlan            -> server-side validation (and reuse on the client)
     project()           -> shared calculation service
   ===================================================================== */
