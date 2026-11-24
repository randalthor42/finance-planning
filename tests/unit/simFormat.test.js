/**
 * @file Unit tests for how the simulation says its numbers: no false precision. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { money, setFmt } from '../../src/core/format.js';
import { chance, chanceAbout, rough } from '../../src/ui/simFormat.js';

test('chances: never 0% or 100%, whole percents under one in ten, steps of 5 above', () => {
  assert.equal(chance(0), 'under 1%');
  assert.equal(chance(0.004), 'under 1%');
  assert.equal(chance(0.0749), '7%');
  assert.equal(chance(0.2349), '25%');
  assert.equal(chance(0.2249), '20%');
  assert.equal(chance(0.996), 'over 99%');
  assert.equal(chance(1), 'over 99%');
});

test('in a sentence a chance is "about", except at the ends', () => {
  assert.equal(chanceAbout(0.35), 'about 35%');
  assert.equal(chanceAbout(0), 'under 1%');
  assert.equal(chanceAbout(1), 'over 99%');
});

test('amounts of the future have two significant figures, in the plan’s format', () => {
  setFmt({ currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy', cents: true });
  assert.match(rough(4321), /^4\.300,00\s€$/u, 'the plan’s own format: here with cents, the European way');
  assert.equal(rough(4321), money(4300));
  assert.equal(rough(-4321), money(-4300));
  assert.equal(rough(98765), money(99000));
  assert.equal(rough(87), money(87));
  assert.equal(rough(3.4), money(3));
  assert.equal(rough(0), money(0));
});
