import { defineConfig, loadEnv } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';
import { csp } from './build/csp.js';
import { embedQr, qrBundles, writeQr } from './build/qr.js';
import { TEXTS_FILE, pwa } from './build/pwa.js';
import { loadApkConfig } from './build/apkConfig.js';
import { apkSplash } from './build/apkSplash.js';

/** Every text passed to $t() and every word passed to plural() in the source (for "Export language"). */
function collectTexts() {
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  const keys = new Set(), words = new Set();
  for (const file of walk(path.resolve('src')).sort()) {
    if (file.includes(`${path.sep}vendor${path.sep}`)) continue;
    const js = fs.readFileSync(file, 'utf8');
    for (const m of js.matchAll(/\$t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) keys.add(m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1).replace(/\\'/g, "'"));
    for (const m of js.matchAll(/plural\((?:[^()']|\([^()]*\)|\((?:[^()]|\([^()]*\))*\))*?,\s*'([a-z][a-z ]*)'\)/g)) words.add(m[1]);
  }
  return { keys: [...keys], words: [...words].sort() };
}
/** The texts as JSON that can sit in an HTML element ("<" written as \u003c, so it cannot end the element). */
const textsJson = () => JSON.stringify(collectTexts()).replace(/</g, '\\u003c');

/**
 * The module "virtual:i18n-keys": readTexts() gives the texts to translate. They are not part of the page's code (the
 * browser would parse ~55 KB of them at every start for a rarely used feature): when building they are written next to
 * the page (i18n-texts.json, loaded on demand) and into the file to hand out (a JSON element, namedCopy below).
 * While developing, the module holds them.
 */
function i18nKeys() {
  const ID = 'virtual:i18n-keys', RESOLVED = '\0' + ID;
  let building = false;
  return {
    name: 'runway-i18n-keys',
    configResolved(config) {
      building = config.command === 'build';
    },
    resolveId: id => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      if (!building) return `export const readTexts = async () => (${JSON.stringify(collectTexts())});\n`;
      return `export const readTexts = async () => {
  const inside = document.getElementById('runway-i18n-texts');
  if (inside) return JSON.parse(inside.textContent);
  const res = await fetch(new URL(${JSON.stringify(TEXTS_FILE)}, document.baseURI));
  return res.ok ? res.json() : null;
};\n`;
    },
  };
}

/**
 * The security policy (build/csp.js): no other site, except Google's sign-in and Drive API when Drive sync is built in
 * (a client ID in VITE_GOOGLE_CLIENT_ID). The served page may load its own files from its own site (the manifest and
 * its icons, the service worker, the QR modules, i18n-texts.json); the file to hand out gets a stricter policy
 * (namedCopy below). The dev server needs its own connections, so the policy is added only when building.
 */
const strictCsp = google => ({ name: 'runway-csp', apply: 'build', transformIndexHtml: html => html.replace('<meta name="referrer"', `<meta http-equiv="Content-Security-Policy" content="${csp({ google })}">\n<meta name="referrer"`) });

/**
 * The simulation (src/logic/sim) is kept out of the code that runs at start-up: it is built on its own as one script
 * that sets `globalThis.RunwaySim`, and put in the page as inert text (<script type="text/plain" id="runway-sim">),
 * which the browser neither parses nor runs. services/lazySim.js runs it the first time Forecast › Simulation is
 * opened, as an inline script (allowed by the policy above: nothing is fetched, no blob: or eval).
 * Its date helpers do not need the app's formatting or languages: that import is replaced by a stub, so the script
 * has no second copy of the translations.
 */
function lazySimulation() {
  let code = '';
  const FORMAT_STUB = '\0runway-format-stub';
  return {
    name: 'runway-lazy-simulation',
    apply: 'build',
    async buildStart() {
      const { build } = await import('vite');
      const result = await build({
        configFile: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'runway-format-stub',
            enforce: 'pre',
            resolveId: (id, importer) => (id === './format.js' && importer && importer.endsWith(path.join('core', 'dates.js')) ? FORMAT_STUB : null),
            load: id => (id === FORMAT_STUB ? "export const FMT = { dloc: 'en-GB' };" : null),
          },
        ],
        build: {
          write: false,
          target: 'es2022',
          minify: 'esbuild',
          copyPublicDir: false,
          lib: { entry: path.resolve('src/logic/sim/index.js'), formats: ['iife'], name: 'RunwaySim', fileName: () => 'sim.js' },
        },
      });
      const output = (Array.isArray(result) ? result[0] : result).output;
      code = output.find(chunk => chunk.type === 'chunk').code;
    },
    transformIndexHtml: {
      order: 'post',
      // "</script" cannot appear inside the block: written "<\/script" it means the same in the code. A function,
      // not a string, as the replacement: the code contains "$&" and friends, which a string would expand
      handler: html =>
        html.replace(
          '</body>',
          () => `<script type="text/plain" id="runway-sim">${code.replace(/<\/script/gi, () => '<\\/script')}</script>\n</body>`,
        ),
    },
  };
}

/**
 * One file to hand out: dist/index.html is also written as runway-money-planner.html. What the page loads only when
 * used, the QR modules (build/qr.js) and the texts to translate, is written next to the page and embedded in the file
 * to hand out, which must work alone.
 */
const namedCopy = google => ({
  name: 'runway-named-copy',
  apply: 'build',
  closeBundle() {
    const dir = this.environment?.config.build.outDir || 'dist', f = path.resolve(dir, 'index.html');
    if (!fs.existsSync(f)) return;
    const qr = qrBundles();
    writeQr(path.resolve(dir), qr);
    const texts = textsJson();
    fs.writeFileSync(path.resolve(dir, TEXTS_FILE), texts);
    // the file to hand out: everything inside, its own stricter policy, and marked so it does not act as an installable app
    const page = embedQr(fs.readFileSync(f, 'utf8'), qr)
      // a function, so that a "$&" or "$'" inside a text is not read as a replacement pattern
      .replace(/<\/body>/i, () => `<script type="application/json" id="runway-i18n-texts">${texts}</script>\n</body>`)
      .replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*"/, `$1${csp({ google, standalone: true })}"`)
      .replace(/<html\b/i, '<html data-standalone');
    fs.writeFileSync(path.resolve(dir, 'runway-money-planner.html'), page);
  },
});

/** Drive sync is built in: a Google client ID for this mode (.env.local, .env.test). */
const hasGoogle = mode => !!loadEnv(mode, process.cwd(), 'VITE_').VITE_GOOGLE_CLIENT_ID;

/**
 * Mode "apk" is the page inside the Android app (scripts/build-apk.mjs): it gets its own splash screen (build/
 * apkSplash.js, from apk.config.json) and no file to hand out.
 */
const apkPlugins = mode => (mode === 'apk' ? [apkSplash(loadApkConfig())] : []);

export default defineConfig(({ mode }) => ({
  // one page, no client-side routes: unknown paths are 404 (dev and preview), as on a static host, not the app's page
  appType: 'mpa',
  // pwa(): the installable app and the site's files (build/pwa.js), written next to the single file
  plugins: [
    i18nKeys(),
    pwa(),
    strictCsp(hasGoogle(mode)),
    lazySimulation(),
    ...apkPlugins(mode),
    viteSingleFile({ removeViteModuleLoader: true }),
    ...(mode === 'apk' ? [] : [namedCopy(hasGoogle(mode))]),
  ],
  build: { target: 'es2022', cssMinify: true, minify: 'esbuild' },
}));
