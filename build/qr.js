/**
 * @file The QR transfer modules at build time (docs/qr-transfer.md). They are not part of the page: the QR maker and
 * reader (src/ui/qr/, with their vendored libraries) are bundled on their own, with esbuild (the bundler Vite itself
 * uses), and loaded only when a QR transfer starts (src/ui/qrLoader.js):
 * - written next to the page as qr-encode.js and qr-decode.js, for the page served over http(s) (and kept by the
 *   service worker for the installed app offline);
 * - embedded in the file to hand out, runway-money-planner.html, as inert <script type="text/plain"> elements: opened
 *   from a disk, it has no site to load them from, and is still one file.
 * Every copy carries the libraries' licences (src/vendor/README.md): the MIT notice of the maker's library, and the
 * Apache-2.0 notice and full licence text of the reader's.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The MIT licence of qrcode-generator (its LICENSE file; the vendored file's header only links to it). */
const QRCODE_MIT = `qrcode-generator 2.0.4 - https://github.com/kazuhikoarase/qrcode-generator

The MIT License (MIT)

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

The word 'QR Code' is registered trademark of DENSO WAVE INCORPORATED.`;

/** The notice of jsQR, put before its licence text (read from src/vendor/jsQR.LICENSE when building). */
const JSQR_NOTICE = `jsQR 1.4.0 - https://github.com/cozmo/jsQR

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance
with the License. Unless required by applicable law or agreed to in writing, software distributed under the
License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied. The full text of the License follows at the end of this file.`;

/**
 * The two QR modules: kind ('encode', 'decode') → the file written next to the page, its entry point in src/, what
 * it is called in its first line, and the licence of the library inside (licence(): the text, read when building;
 * notice: put first, the full text at the end when it is long).
 * @type {Object<string, {file: string, entry: string, name: string, notice: string, licence: function(): string}>}
 */
export const QR_MODULES = {
  encode: {
    file: 'qr-encode.js',
    entry: 'src/ui/qr/encode.js',
    name: 'Runway QR maker',
    notice: QRCODE_MIT,
    licence: () => '',
  },
  decode: {
    file: 'qr-decode.js',
    entry: 'src/ui/qr/decode.js',
    name: 'Runway QR reader',
    notice: JSQR_NOTICE,
    licence: () => fs.readFileSync(path.join(ROOT, 'src/vendor/jsQR.LICENSE'), 'utf8'),
  },
};

/** Text as a block comment; refused if it would end the comment early or the <script> element it is embedded in. */
function comment(text) {
  if (text.includes('*/') || /<\/script/i.test(text)) {
    throw new Error('A licence text cannot be put in a comment as it is');
  }
  return `/*!\n${text.trim()}\n*/`;
}

/**
 * Bundles both modules, each with the licence of its library (esbuild's legalComments: 'none' drops the libraries'
 * own comments; the banner and footer below are kept as written).
 * @returns {Object<string, string>} kind → code (an ES module)
 */
export function qrBundles() {
  const out = {};
  for (const [kind, m] of Object.entries(QR_MODULES)) {
    const licence = m.licence();
    const result = buildSync({
      entryPoints: [path.join(ROOT, m.entry)],
      bundle: true,
      format: 'esm',
      target: 'es2022',
      minify: true,
      write: false,
      legalComments: 'none',
      logLevel: 'error',
      banner: { js: `/* ${m.name}. Includes: */\n${comment(m.notice)}` },
      footer: { js: licence ? comment(licence) : '' },
    });
    out[kind] = result.outputFiles[0].text;
  }
  return out;
}

/**
 * Writes the modules next to the page.
 * @param {string} dir the build's folder
 * @param {Object<string, string>} bundles from qrBundles()
 */
export function writeQr(dir, bundles) {
  for (const [kind, code] of Object.entries(bundles)) {
    fs.writeFileSync(path.join(dir, QR_MODULES[kind].file), code);
  }
}

/**
 * The page with the modules inside, as text the browser does not run: every "</script" (in any case) is written
 * "<\/script", keeping its case, so it cannot end the element; ui/qrLoader.js turns it back.
 * @param {string} html the page
 * @param {Object<string, string>} bundles from qrBundles()
 * @returns {string} the page with one <script type="text/plain" id="runway-qr-<kind>"> per module
 */
export function embedQr(html, bundles) {
  const tags = Object.entries(bundles)
    .map(
      ([kind, code]) =>
        `<script type="text/plain" id="runway-qr-${kind}">${code.replace(/<(\/script)/gi, '<\\$1')}</script>`,
    )
    .join('\n');
  // a function, so that a $ in the code is not read as a replacement pattern
  return html.replace(/<\/body>/i, () => `${tags}\n</body>`);
}
