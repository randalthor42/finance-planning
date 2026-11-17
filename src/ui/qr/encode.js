/**
 * @file QR code maker, loaded only when a device sends a QR transfer (ui/qrLoader.js). Bundled on its own into
 * qr-encode.js when building (build/qr.js); the library is vendored (src/vendor/README.md).
 */
import { qrcode } from '../../vendor/qrcode.mjs';

/**
 * Draws one QR code of text on a canvas: black on white, with the quiet zone (4 modules) scanners need, each module a
 * whole number of pixels so the code stays sharp. size: the canvas width wanted, in pixels.
 * @returns {number} the number of modules across (the code's size)
 */
export function drawFrame(canvas, text, { size = 480, level = 'M', margin = 4 } = {}) {
  const qr = qrcode(0, level);
  qr.addData(text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const cells = count + margin * 2;
  const scale = Math.max(2, Math.floor(size / cells));
  canvas.width = canvas.height = cells * scale;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        g.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
      }
    }
  }
  return count;
}
