/**
 * @file Unit tests for the building blocks of the simulation: the seeded random numbers and the robust statistics.
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, poisson } from '../../src/core/random.js';
import { mad, median, quantile, describe } from '../../src/logic/sim/stats.js';
import { seededRandom } from '../../src/logic/forecast.js';

test('the same seed gives the same numbers, another seed others, all in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const first = Array.from({ length: 5 }, a);
  assert.deepEqual(first, Array.from({ length: 5 }, b));
  assert.notDeepEqual(first, Array.from({ length: 5 }, c));
  const many = Array.from({ length: 10000 }, mulberry32(7));
  assert.ok(many.every(x => x >= 0 && x < 1));
  const mean = many.reduce((s, x) => s + x, 0) / many.length;
  assert.ok(Math.abs(mean - 0.5) < 0.02, 'about even: ' + mean);
});

test('the Forecast page keeps its generator: it is the same mulberry32', () => {
  assert.deepEqual(Array.from({ length: 3 }, seededRandom(9)), Array.from({ length: 3 }, mulberry32(9)));
});

test('rare events: a Poisson count with the asked mean, never negative', () => {
  const rng = mulberry32(1);
  const draws = Array.from({ length: 20000 }, () => poisson(rng, 0.25));
  const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
  assert.ok(Math.abs(mean - 0.25) < 0.02, 'mean ' + mean);
  assert.ok(draws.every(n => Number.isInteger(n) && n >= 0));
  assert.equal(poisson(rng, 0), 0);
});

test('median and MAD: a single outlier barely moves them, where the mean and spread jump', () => {
  const steady = [300, 310, 290, 305, 295, 300, 302];
  const withOutlier = [...steady.slice(0, 6), 3000];
  assert.equal(median(steady), 300);
  assert.equal(median(withOutlier), 300);
  assert.equal(mad(steady), 5);
  assert.equal(mad(withOutlier), 5);
  const mean = withOutlier.reduce((s, x) => s + x, 0) / withOutlier.length;
  assert.ok(mean > 680, 'the mean is pulled far off: ' + mean);
  assert.equal(median([]), 0);
  assert.equal(mad([4]), 0);
});

test('quantiles interpolate between neighbours (type 7, as spreadsheets do)', () => {
  const sorted = [10, 20, 30, 40, 50];
  assert.equal(quantile(sorted, 0), 10);
  assert.equal(quantile(sorted, 1), 50);
  assert.equal(quantile(sorted, 0.5), 30);
  assert.equal(quantile(sorted, 0.1), 14);
  assert.equal(quantile(sorted, 0.9), 46);
  assert.equal(quantile([7], 0.3), 7);
  assert.equal(quantile([], 0.5), 0);
});

test('describe gives everything the page shows about a list of months', () => {
  const d = describe([100, 200, 300, 400, 1000]);
  assert.deepEqual([d.n, d.median, d.mad, d.p10, d.p90, d.mean], [5, 300, 100, 140, 760, 400]);
});
