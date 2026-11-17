/**
 * @file The QR transfer modules at build time (docs/qr-transfer.md). They are not part of the page: the QR maker and
 * reader (src/ui/qr/, with their vendored libraries) are bundled on their own, with esbuild (the bundler Vite itself
 * uses), and loaded only when a QR transfer starts (src/ui/qrLoader.js):
 * - written next to the page as qr-encode.js and qr-decode.js, for the page served over http(s) (and kept by the
 *   service worker for the installed app offline);
 * - embedded in the file to hand out, runway-money-planner.html, as inert <script type="text/plain"> elements: opened
 *   from a disk, it has no site to load them from, and is still one file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const QR_MODULES = {
  encode: {
    file: 'qr-encode.js',
    entry: 'src/ui/qr/encode.js',
    note: 'qrcode-generator 2.0.4, MIT, (c) 2009 Kazuhiko Arase',
  },
  decode: {
    file: 'qr-decode.js',
    entry: 'src/ui/qr/decode.js',
    note: 'jsQR 1.4.0, Apache-2.0, https://github.com/cozmo/jsQR',
  },
};

/** Bundles both modules: kind → code (an ES module). */
export function qrBundles() {
  const out = {};
  for (const [kind, m] of Object.entries(QR_MODULES)) {
    const result = buildSync({
      entryPoints: [path.join(ROOT, m.entry)],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      minify: true,
      write: false,
      legalComments: 'none',
      logLevel: 'error',
      banner: { js: `/* Runway QR ${kind === 'encode' ? 'maker' : 'reader'}. Includes ${m.note}. */` },
    });
    out[kind] = result.outputFiles[0].text;
  }
  return out;
}

/** Writes the modules next to the page. */
export function writeQr(dir, bundles) {
  for (const [kind, code] of Object.entries(bundles)) {
    fs.writeFileSync(path.join(dir, QR_MODULES[kind].file), code);
  }
}

/**
 * The page with the modules inside, as text the browser does not run ("</script" written so it cannot end the
 * element; ui/qrLoader.js turns it back).
 */
export function embedQr(html, bundles) {
  const tags = Object.entries(bundles)
    .map(
      ([kind, code]) =>
        `<script type="text/plain" id="runway-qr-${kind}">${code.replace(/<\/script/gi, '<\\/script')}</script>`,
    )
    .join('\n');
  return html.replace(/<\/body>/i, `${tags}\n</body>`);
}
