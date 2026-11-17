# Vendored libraries

Copied unchanged from their npm packages, so the app builds and runs with no network and no install step for them.
They are not part of the main page: the QR modules (`src/ui/qr/`) that use them are bundled into their own files
(`qr-encode.js`, `qr-decode.js`) and loaded only when a QR transfer starts (`src/ui/qrLoader.js`).

| File | Package | Version | License | Used for |
| --- | --- | --- | --- | --- |
| `qrcode.mjs` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 2.0.4 (`dist/qrcode.mjs`) | MIT, © 2009 Kazuhiko Arase (header of the file) | drawing the QR codes a device sends |
| `jsQR.js` | [jsqr](https://github.com/cozmo/jsQR) | 1.4.0 (`dist/jsQR.js`) | Apache-2.0 (`jsQR.LICENSE`) | reading QR codes from the camera where the browser has no `BarcodeDetector` |

To update one: download the package (`npm pack <name>@<version>`), copy the same file from its `dist/` here, update
the table, and run `npm run test:qr`.
