import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/**
 * Collects every text passed to $t() and every word passed to plural() for "Export language" (core/i18n.js).
 * The module "virtual:i18n-keys" exports loadKeys(), which returns { KEYS, WORDS }. In a build the lists are not code
 * at all: they wait in the page as inert JSON (<script type="application/json" id="runway-i18n-keys">) and are read
 * the first time a page needs them, so the about 1 300 texts are not made into strings every time the app starts.
 * The dev server serves them in the module itself.
 */
function i18nKeys() {
  const ID = 'virtual:i18n-keys', RESOLVED = '\0' + ID;
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  const collect = () => {
    const keys = new Set(), words = new Set();
    for (const file of walk(path.resolve('src')).sort()) {
      const js = fs.readFileSync(file, 'utf8');
      for (const m of js.matchAll(/\$t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) keys.add(m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1).replace(/\\'/g, "'"));
      for (const m of js.matchAll(/plural\((?:[^()']|\([^()]*\)|\((?:[^()]|\([^()]*\))*\))*?,\s*'([a-z][a-z ]*)'\)/g)) words.add(m[1]);
    }
    return { KEYS: [...keys], WORDS: [...words].sort() };
  };
  let building = false;
  return {
    name: 'runway-i18n-keys',
    configResolved: config => {
      building = config.command === 'build';
    },
    resolveId: id => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      return building
        ? "export const loadKeys = () => JSON.parse(document.getElementById('runway-i18n-keys').textContent);\n"
        : `export const loadKeys = () => (${JSON.stringify(collect())});\n`;
    },
    transformIndexHtml: {
      order: 'post',
      // "</" cannot appear inside the block: in JSON "<\/" is the same text. A function as the replacement (see below)
      handler: (html, ctx) =>
        ctx.server
          ? html
          : html.replace('</body>', () => `<script type="application/json" id="runway-i18n-keys">${JSON.stringify(collect()).replace(/<\//g, () => '<\\/')}</script>\n</body>`),
    },
  };
}

/** The shipped file may not talk to the network at all. The dev server needs its own connections, so the policy is added only when building. */
const strictCsp = () => ({ name: 'runway-csp', apply: 'build', transformIndexHtml: html => html.replace('<meta name="referrer"', `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer"`) });

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

/** One file to hand out: dist/index.html is also written as runway-money-planner.html. */
const namedCopy = () => ({ name: 'runway-named-copy', apply: 'build', closeBundle() { const dir = this.environment?.config.build.outDir || 'dist', f = path.resolve(dir, 'index.html'); if (fs.existsSync(f)) fs.copyFileSync(f, path.resolve(dir, 'runway-money-planner.html')); } });

export default defineConfig({
  plugins: [i18nKeys(), strictCsp(), lazySimulation(), viteSingleFile({ removeViteModuleLoader: true }), namedCopy()],
  build: { target: 'es2022', cssMinify: true, minify: 'esbuild' },
});
