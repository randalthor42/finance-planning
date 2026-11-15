/**
 * @file Cache for derived data that is expensive to work out (what-if projections, the Monte Carlo range).
 * A value is reused while the plan is unchanged (Store.rev) and its inputs are the same; any change recalculates it.
 */
import { Store } from '../state/store.js';

/** key -> { rev, inputs, value } */
const cache = new Map();

/**
 * The value of fn(), reused while Store.rev and `inputs` are unchanged.
 * @param {string} key one name per kind of value, e.g. 'tripFit:' + trip id
 * @param {Array<string|number|boolean|null>} inputs everything besides the plan that the value depends on
 * @param {() => any} fn the calculation (must only read Store.plan / Store.proj and `inputs`)
 */
export function memo(key, inputs, fn) {
  const hit = cache.get(key);
  if (hit && hit.rev === Store.rev && sameInputs(hit.inputs, inputs)) {
    return hit.value;
  }
  const value = fn();
  if (hit && hit.rev !== Store.rev) {
    dropStale();
  }
  cache.set(key, { rev: Store.rev, inputs, value });
  return value;
}

function sameInputs(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Forgets every value of an older revision, so the cache never holds more than one revision. */
function dropStale() {
  for (const [key, entry] of cache) {
    if (entry.rev !== Store.rev) {
      cache.delete(key);
    }
  }
}
