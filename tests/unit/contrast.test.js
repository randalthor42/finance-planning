/**
 * @file The colours of the app pass WCAG AA: every text colour on every surface it is used on, in the light and the
 * dark theme, read straight from src/styles/tokens.css (a colour changed there is checked here). Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');
/** The custom properties of one block of tokens.css (`:root {` or `:root[data-theme='dark'] {`). */
function tokens(selector) {
  const start = css.indexOf(selector + ' {');
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map(m => [m[1], m[2]]));
}
const light = tokens(':root');
const dark = { ...light, ...tokens(":root[data-theme='dark']") };

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a, b) {
  const lum = hex => {
    const [r, g, bl] = [1, 3, 5]
      .map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const SURFACES = ['bg', 'surface', 'surface-2', 'surface-3'];
const TEXT = ['text', 'muted', 'faint'];

for (const [name, t] of [
  ['light', light],
  ['dark', dark],
]) {
  test(`${name} theme: text, muted and faint text are readable on every surface (4.5:1)`, () => {
    for (const fg of TEXT) {
      for (const bg of SURFACES) {
        const ratio = contrast(t[fg], t[bg]);
        assert.ok(ratio >= 4.5, `--${fg} on --${bg}: ${ratio.toFixed(2)}:1`);
      }
    }
  });
  test(`${name} theme: good, bad, warn and accent text are readable on the page and on cards (4.5:1)`, () => {
    for (const fg of ['good', 'bad', 'warn', 'accent']) {
      for (const bg of ['bg', 'surface']) {
        const ratio = contrast(t[fg], t[bg]);
        assert.ok(ratio >= 4.5, `--${fg} on --${bg}: ${ratio.toFixed(2)}:1`);
      }
    }
  });
  test(`${name} theme: faint stays lighter than muted (the order of emphasis is kept)`, () => {
    assert.ok(contrast(t.faint, t.surface) < contrast(t.muted, t.surface));
  });
}

test('the ratio itself: black on white is 21, a colour on itself is 1', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#5f6978', '#5f6978'), 1);
});
