/**
 * @file Unit tests for the arithmetic of touch gestures (core/gesture.js): which way a finger is going, whether a
 * swipe changes the month, where a bottom sheet settles. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { axisOf, resist, sheetSnap, swipeStep, velocity } from '../../src/core/gesture.js';

test('the way a finger goes is decided once it has moved a little, and only when it clearly goes one way', () => {
  assert.equal(axisOf(4, 3), null, 'not far enough yet');
  assert.equal(axisOf(30, 5), 'x');
  assert.equal(axisOf(-30, 8), 'x');
  assert.equal(axisOf(6, -40), 'y');
  assert.equal(axisOf(20, 19), 'y', 'diagonal: the page keeps its vertical scroll');
});

test('a swipe changes the month when it goes far enough, or fast enough', () => {
  assert.equal(swipeStep(-120, 400, 360), 1, 'a third of the width to the left: the next month');
  assert.equal(swipeStep(130, 400, 360), -1, 'to the right: the month before');
  assert.equal(swipeStep(-40, 400, 360), 0, 'a short slow drag goes back');
  assert.equal(swipeStep(-40, 60, 360), 1, 'a short quick flick is enough');
  assert.equal(swipeStep(-12, 20, 360), 0, 'but not a twitch');
});

test('dragging past the first or last month gives way only a little', () => {
  assert.equal(resist(90, true), 90);
  assert.equal(resist(90, false), 30);
  assert.equal(resist(-90, false), -30);
});

test('velocity is measured over the last moments of a drag', () => {
  const samples = [
    { t: 0, v: 0 },
    { t: 200, v: 10 },
    { t: 280, v: 50 },
    { t: 300, v: 70 },
  ];
  assert.equal(velocity(samples), 0.6, 'from the sample 100 ms before the last: 60 px in 100 ms');
  assert.equal(velocity([{ t: 0, v: 5 }]), 0);
});

test('a bottom sheet settles where it is let go, or where it is flung', () => {
  const stops = { peek: 300, full: 700 };
  assert.equal(sheetSnap(320, 0, stops), 'peek', 'near the peek: stays there');
  assert.equal(sheetSnap(620, 0, stops), 'full', 'pulled most of the way up: opens');
  assert.equal(sheetSnap(150, 0, stops), 'closed', 'pulled well down: closes');
  assert.equal(sheetSnap(330, 0.8, stops), 'full', 'flung up from the peek: opens');
  assert.equal(sheetSnap(650, -0.8, stops), 'peek', 'flung down from full: back to the peek');
  assert.equal(sheetSnap(280, -0.8, stops), 'closed', 'flung down from the peek: closes');
  assert.equal(sheetSnap(900, 0, stops), 'full', 'never above full');
});
