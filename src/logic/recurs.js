/**
 * @file When a recurring line (an income, a bill) is due. Pure and tiny: the projection and the simulation
 * (logic/sim/fit.js, loaded only when needed) both use it.
 */
import { M } from '../core/dates.js';

/**
 * Is a recurring line charged in month k? `anchor` is used when it has no start month.
 * @returns {boolean}
 */
export function recurs(r, k, anchor) {
  const f = M.parse(r.from);
  const t = M.parse(r.to);
  if (f !== null && k < f) {
    return false;
  }
  if (t !== null && k > t) {
    return false;
  }
  const a = f !== null ? f : anchor;
  return (((k - a) % r.every) + r.every) % r.every === 0;
}
