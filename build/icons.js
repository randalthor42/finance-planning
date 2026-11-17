/**
 * @file The app icon, drawn at build time with no dependencies: the same logo as the menu (ui/app.js), a rounded
 * square in the accent colour with the rising line, as SVG and as PNG. The PNGs are needed where SVG is not taken
 * (Android's install icons, the iOS home screen). Used by build/pwa.js only; none of this reaches the browser except
 * the finished images, inlined as data: URIs.
 */
import zlib from 'node:zlib';

/** The logo on a 32-unit grid (ui/app.js draws the same). */
export const LOGO = {
  size: 32,
  radius: 8,
  line: [
    [7, 22],
    [13, 15],
    [17, 19],
    [25, 9],
  ],
  width: 2.6,
};
/** The square's colour: the app's accent. */
export const ACCENT = '#2457d6';
/** The line's colour. */
export const INK = '#ffffff';

const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));

/**
 * The SVG. variant 'any': the rounded square on transparent; 'full': the square to the edges (the platform cuts its
 * own shape), with the line scaled by `scale` around the centre.
 * @param {'any'|'full'} [variant]
 * @param {number} [scale] size of the line, 1 = as in the logo
 * @returns {string} the SVG text
 */
export function iconSvg(variant = 'any', scale = 1) {
  const s = LOGO.size;
  const pts = LOGO.line.map(([x, y]) => [s / 2 + (x - s / 2) * scale, s / 2 + (y - s / 2) * scale]);
  const d = 'M' + pts.map(p => p.map(n => +n.toFixed(3)).join(' ')).join('L');
  const bg =
    variant === 'full'
      ? `<rect width="${s}" height="${s}" fill="${ACCENT}"/>`
      : `<rect width="${s}" height="${s}" rx="${LOGO.radius}" fill="${ACCENT}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">${bg}` +
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${+(LOGO.width * scale).toFixed(3)}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

/* --- drawing: signed distances give smooth (anti-aliased) edges without a graphics library --- */

/** Distance from (px, py) to the segment a-b. */
function segment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** Signed distance to a rounded square of side s and corner r (negative inside). */
function roundedSquare(px, py, s, r) {
  const qx = Math.abs(px - s / 2) - (s / 2 - r);
  const qy = Math.abs(py - s / 2) - (s / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * RGBA pixels of the icon at `px` pixels, drawn with signed distances for smooth edges. Same variants as iconSvg.
 * @param {number} px width and height
 * @param {'any'|'full'} [variant]
 * @param {number} [scale]
 * @returns {Uint8Array} px × px × 4 bytes, row by row
 */
export function iconPixels(px, variant = 'any', scale = 1) {
  const s = LOGO.size;
  const unit = px / s; // pixels per grid unit
  const pts = LOGO.line.map(([x, y]) => [s / 2 + (x - s / 2) * scale, s / 2 + (y - s / 2) * scale]);
  const half = (LOGO.width * scale) / 2;
  const [ar, ag, ab] = hex(ACCENT);
  const [ir, ig, ib] = hex(INK);
  const out = new Uint8Array(px * px * 4);
  const cover = distance => Math.max(0, Math.min(1, 0.5 - distance * unit)); // distance in units, edge 1 px wide
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const gx = (x + 0.5) / unit;
      const gy = (y + 0.5) / unit;
      const bg = variant === 'full' ? 1 : cover(roundedSquare(gx, gy, s, LOGO.radius));
      let line = Infinity;
      for (let i = 1; i < pts.length; i++) {
        line = Math.min(line, segment(gx, gy, pts[i - 1], pts[i]));
      }
      const ink = Math.min(bg, cover(line - half));
      const o = (y * px + x) * 4;
      // colour of the square, the line over it; the alpha is the square's (the line lies inside it)
      out[o] = Math.round(ar + (ir - ar) * (bg ? ink / bg : 0));
      out[o + 1] = Math.round(ag + (ig - ag) * (bg ? ink / bg : 0));
      out[o + 2] = Math.round(ab + (ib - ab) * (bg ? ink / bg : 0));
      out[o + 3] = Math.round(bg * 255);
    }
  }
  return out;
}

/* --- PNG encoding (RGBA, 8 bits), with Node's zlib --- */

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
/**
 * A PNG file of RGBA pixels (8 bits per channel, no filter, zlib at level 9).
 * @param {Uint8Array} rgba width × height × 4 bytes, row by row
 * @param {number} width
 * @param {number} height
 * @returns {Buffer} the PNG file
 */
export function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits per channel
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The icon as a PNG data: URI, for the page head (the iOS home screen icon).
 * @param {number} px width and height
 * @param {'any'|'full'} [variant]
 * @param {number} [scale]
 * @returns {string}
 */
export const pngDataUri = (px, variant, scale) =>
  'data:image/png;base64,' + encodePng(iconPixels(px, variant, scale), px, px).toString('base64');
/**
 * The icon as an SVG data: URI, for the page head (the favicon).
 * @param {'any'|'full'} [variant]
 * @param {number} [scale]
 * @returns {string}
 */
export const svgDataUri = (variant, scale) => 'data:image/svg+xml,' + encodeURIComponent(iconSvg(variant, scale));
