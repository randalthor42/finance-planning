/**
 * @file Seeded random numbers: the same seed always gives the same sequence, so a simulation can be run again and get
 * the same answer (and be tested). Pure, no dependencies.
 */

/**
 * mulberry32: a small, fast 32-bit generator (Tommy Ettinger). Returns a function giving numbers in [0, 1).
 * Good enough for simulations; not for anything secret.
 * @returns {() => number} the generator: each call gives the next number in [0, 1)
 */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How many times something rare happens in a period, when it happens `lambda` times in such a period on average
 * (a Poisson count; Knuth's method, fine for the small means of rare expenses).
 * @returns {number} the count: a whole number, 0 or more
 */
export function poisson(random, lambda) {
  if (!(lambda > 0)) {
    return 0;
  }
  const limit = Math.exp(-lambda);
  let count = 0;
  let product = random();
  while (product > limit) {
    count++;
    product *= random();
  }
  return count;
}
