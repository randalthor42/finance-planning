/**
 * @file The Android app's icon, drawn from the logo of build/icons.js on the grid of an adaptive icon: a 108-unit
 * square of which Android shows the middle, cut to the phone's own shape (circle, squircle, rounded square). The
 * logo's line stays inside the 66-unit circle that every shape keeps. The same line is drawn as Android vector
 * drawables (build/android.js) and as SVG for the splash drawn by the page and its preview (build/apkSplash.js).
 */
import { LOGO } from './icons.js';

/** Side of the adaptive icon's grid, in units (dp at the icon's size of 108 dp). */
export const GRID = 108;
/** How much bigger the logo's line is drawn than on its own 32-unit grid. */
const SCALE = 2.5;

/**
 * The logo's line on the 108-unit grid: the path data and the line's width.
 * @returns {{d: string, width: number}}
 */
export function logoLine() {
  const half = LOGO.size / 2;
  const at = v => +(GRID / 2 + (v - half) * SCALE).toFixed(2);
  const d = 'M' + LOGO.line.map(([x, y]) => `${at(x)},${at(y)}`).join(' L');
  return { d, width: +(LOGO.width * SCALE).toFixed(2) };
}

/**
 * The icon as SVG: the line on a disc (as Android's splash and round icons show it) or on the full square.
 * @param {object} icon the icon settings (apk.config.json): background and foreground colours
 * @param {{shape?: 'disc'|'square'|'none', px?: number, mono?: string}} [o] shape behind the line ('none': the line
 *   only), size in pixels, and one colour for the line instead of the icon's (Android's themed icon)
 * @returns {string}
 */
export function apkIconSvg(icon, { shape = 'disc', px = 108, mono = '' } = {}) {
  const { d, width } = logoLine();
  const behind = {
    disc: `<circle cx="54" cy="54" r="36" fill="${icon.background}"/>`,
    square: `<rect width="108" height="108" fill="${icon.background}"/>`,
    none: '',
  }[shape];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" width="${px}" height="${px}" aria-hidden="true">` +
    behind +
    `<path d="${d}" fill="none" stroke="${mono || icon.foreground}" stroke-width="${width}" ` +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>'
  );
}
