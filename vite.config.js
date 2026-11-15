import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'node:fs';
import path from 'node:path';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

/** Collects every text passed to $t() and every word passed to plural() and serves them as the module "virtual:i18n-keys". */
function i18nKeys() {
  const ID = 'virtual:i18n-keys', RESOLVED = '\0' + ID;
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
  return {
    name: 'runway-i18n-keys',
    resolveId: id => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const keys = new Set(), words = new Set();
      for (const file of walk(path.resolve('src')).sort()) {
        const js = fs.readFileSync(file, 'utf8');
        for (const m of js.matchAll(/\$t\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) keys.add(m[1][0] === '"' ? JSON.parse(m[1]) : m[1].slice(1, -1).replace(/\\'/g, "'"));
        for (const m of js.matchAll(/plural\((?:[^()']|\([^()]*\)|\((?:[^()]|\([^()]*\))*\))*?,\s*'([a-z][a-z ]*)'\)/g)) words.add(m[1]);
      }
      return `export const KEYS = ${JSON.stringify([...keys])};\nexport const WORDS = ${JSON.stringify([...words].sort())};\n`;
    },
  };
}

/** The shipped file may not talk to the network at all. The dev server needs its own connections, so the policy is added only when building. */
const strictCsp = () => ({ name: 'runway-csp', apply: 'build', transformIndexHtml: html => html.replace('<meta name="referrer"', `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer"`) });

/** One file to hand out: dist/index.html is also written as runway-money-planner.html. */
const namedCopy = () => ({ name: 'runway-named-copy', apply: 'build', closeBundle() { const dir = this.environment?.config.build.outDir || 'dist', f = path.resolve(dir, 'index.html'); if (fs.existsSync(f)) fs.copyFileSync(f, path.resolve(dir, 'runway-money-planner.html')); } });

export default defineConfig({
  plugins: [i18nKeys(), strictCsp(), viteSingleFile({ removeViteModuleLoader: true }), namedCopy()],
  build: { target: 'es2022', cssMinify: true, minify: 'esbuild' },
});
