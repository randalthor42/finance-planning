/**
 * @file QR code reader for camera images, loaded only when a device receives a QR transfer (ui/qrLoader.js), and
 * only used where the browser has no BarcodeDetector. Bundled on its own into qr-decode.js when building
 * (build/qr.js); the library is vendored (src/vendor/README.md).
 */
// a UMD script: loaded as a module, it puts its function on the global object (self.jsQR)
import '../../vendor/jsQR.js';

/** The text of the QR code in an ImageData, or null when none can be read. */
export function decode(image) {
  const found = globalThis.jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
  return found ? found.data : null;
}
