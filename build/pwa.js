/**
 * @file The installable app (PWA) at build time: a Vite plugin that adds it to the single-file build.
 *
 * - Next to the page it writes manifest.webmanifest (display standalone, start_url ./), its icons and screenshots as
 *   files, and sw.js (the service worker): siteFiles(). These matter only where the page is served over http or https,
 *   and they go with it (a service worker must be a file on the same site). Manifest images are files, not data: URIs,
 *   so browser tools (DevTools' Manifest panel) can check them; ui/pwa.js links the manifest over http(s) only.
 *   No robots.txt: a hosted copy holds someone's personal finances, and search engines are not invited in.
 * - The page head gets the favicon (SVG) and the iOS home screen icon (PNG, 180 px) inline: opened as a file, the app
 *   still has its icons and depends on no other file.
 * - sw.js keeps its name; its content, and the name of its cache, carry a fingerprint of the page, so each build is a
 *   new worker to the browser.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP } from '../src/config.js';
import { MANIFEST_URL, SW_URL } from '../src/core/pwa.js';
import { encodePng, iconPixels, pngDataUri, svgDataUri } from './icons.js';
import { QR_MODULES } from './qr.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Scale of the line inside icons that the platform cuts to its own shape (maskable: the safe circle is 80%). */
const MASKABLE_SCALE = 0.8;
const APPLE_SCALE = 0.9;
const DESCRIPTION =
  'Plan your money month by month: income, bills, trips, wishes and savings. Works offline; your data is kept on your devices, and in your own Google Drive only if you turn on sync.';

/** The icons as files: path → [content, type, sizes, purpose]. */
const ICONS = [
  ['icons/icon-192.png', () => encodePng(iconPixels(192), 192, 192), 'image/png', '192x192', 'any'],
  ['icons/icon-512.png', () => encodePng(iconPixels(512), 512, 512), 'image/png', '512x512', 'any'],
  [
    'icons/icon-maskable-512.png',
    () => encodePng(iconPixels(512, 'full', MASKABLE_SCALE), 512, 512),
    'image/png',
    '512x512',
    'maskable',
  ],
];
/** The screenshots (made by scripts/screenshots.mjs from the sample plan): path, form factor, label. */
const SCREENSHOTS = [
  [
    'screenshots/wide.png',
    'wide',
    'The Overview on a computer: what is safe to spend, this month, insights and the cash chart.',
  ],
  [
    'screenshots/narrow.png',
    'narrow',
    'The Overview on a phone: what is safe to spend, the month-end balance and this month.',
  ],
];
/** Width and height of a PNG, from its header. */
const pngSize = png => `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;

let cached = null;
/**
 * The files written next to the page, except sw.js: relative path → content. Drawn once per build.
 * @returns {Map<string, string|Buffer>}
 */
export function siteFiles() {
  if (!cached) {
    cached = new Map();
    for (const [file, draw] of ICONS) {
      cached.set(file, draw());
    }
    for (const [file] of SCREENSHOTS) {
      cached.set(file, fs.readFileSync(path.join(HERE, file)));
    }
    cached.set(MANIFEST_URL.slice(2), JSON.stringify(manifest(), null, 2) + '\n');
  }
  return cached;
}

/**
 * The web app manifest.
 * @returns {object} the manifest, as written to manifest.webmanifest
 */
export function manifest() {
  return {
    name: `${APP.name} · money planner`,
    short_name: APP.name,
    description: DESCRIPTION,
    lang: 'en',
    dir: 'ltr',
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'any',
    theme_color: APP.colors.light,
    background_color: APP.colors.background,
    categories: ['finance', 'productivity'],
    icons: ICONS.map(([src, , type, sizes, purpose]) => ({ src, sizes, type, purpose })),
    screenshots: SCREENSHOTS.map(([src, form_factor, label]) => ({
      src,
      sizes: pngSize(fs.readFileSync(path.join(HERE, src))),
      type: 'image/png',
      form_factor,
      label,
    })),
  };
}

/**
 * The icons in the page head: the browser tab (SVG) and the iOS home screen (PNG; iOS rounds the corners itself).
 * @returns {object[]} Vite tag descriptors
 */
export function headTags() {
  return [
    { tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: svgDataUri('any') }, injectTo: 'head' },
    {
      tag: 'link',
      attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: pngDataUri(180, 'full', APPLE_SCALE) },
      injectTo: 'head',
    },
  ];
}

/**
 * The service worker. Each build is one version: at install it keeps that build's page (index.html, also answered for
 * the folder itself) and the files its page loads only when used (the QR modules, the texts to translate) in a cache
 * named after the build, and fails the install if any of them cannot be kept (the browser tries again on a later
 * visit; the version before stays in charge). The manifest, icons and screenshots are kept too, if they can be.
 *
 * It answers only those files, always from its own cache (the network only for one it could not keep): anything else
 * in its folder, and every other site, goes past it untouched, never cached. It never sees the plans (they are in the
 * browser storage and the data file, not in requests; Drive sync's requests go to Google).
 *
 * A new build waits until every page of the old one is closed (no skipWaiting): an open page keeps the worker and the
 * cache of its own version, so a QR module or the texts it loads later always match it, although their names do not
 * change between builds. When the new worker activates, it removes the older runway- caches.
 * Written as a function so it is real, linted code; serviceWorker() turns it into sw.js.
 */
function worker(CACHE, NEEDED, EXTRA) {
  const scope = self.registration.scope;
  const at = file => new URL(file, scope).href;
  const PAGE = at('index.html');
  /** Without its ?query or #part: one copy per file. */
  const key = url => {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href;
  };
  /** Everything this worker answers: the page, as itself or as its folder, and the files of its build. */
  const KNOWN = new Set([scope, PAGE, ...NEEDED.map(at), ...EXTRA.map(at)]);
  /** Fetches one file into the cache; throws when it cannot. */
  const keep = async (cache, url) => {
    const response = await fetch(url, { cache: 'reload' });
    if (!response.ok) {
      throw new Error(`${url}: ${response.status}`);
    }
    await cache.put(url, response);
  };
  self.addEventListener('install', event => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          await Promise.all([PAGE, ...NEEDED.map(at)].map(url => keep(cache, url)));
        } catch (e) {
          await caches.delete(CACHE);
          throw e;
        }
        await Promise.all(EXTRA.map(file => keep(cache, at(file)).catch(() => {})));
      })(),
    );
  });
  self.addEventListener('activate', event => {
    event.waitUntil(
      (async () => {
        for (const name of await caches.keys()) {
          if (name.startsWith('runway-') && name !== CACHE) {
            await caches.delete(name);
          }
        }
        await self.clients.claim();
      })(),
    );
  });
  self.addEventListener('fetch', event => {
    const request = event.request;
    const url = key(request.url);
    if (request.method !== 'GET' || !KNOWN.has(url)) {
      return;
    }
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const kept = await cache.match(url === scope ? PAGE : url);
        return kept || fetch(request);
      })(),
    );
  });
}

/** The texts to translate (Export language), next to the page: loaded only when needed (vite.config.js). */
export const TEXTS_FILE = 'i18n-texts.json';
/** Files next to the page that it loads only when used: kept at install with the page, or no install. */
const NEEDED_FILES = [...Object.values(QR_MODULES).map(m => m.file), TEXTS_FILE];
/** The other files the build writes next to the page (manifest, icons, screenshots): kept at install if they can be. */
const extraFiles = () => [...siteFiles().keys()];

/**
 * The text of sw.js for one build.
 * @param {string} version the build's fingerprint, which names its cache
 * @returns {string}
 */
export function serviceWorker(version) {
  const args = [JSON.stringify('runway-' + version), JSON.stringify(NEEDED_FILES), JSON.stringify(extraFiles())];
  return (
    `/* Runway service worker, build ${version}. Generated by build/pwa.js: edit it there. */\n` +
    `(${worker.toString()})(${args.join(', ')});\n`
  );
}

/**
 * The Vite plugin.
 * @returns {object} a Vite plugin
 */
export function pwa() {
  let outDir = 'dist';
  let building = false;
  return {
    name: 'runway-pwa',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      building = config.command === 'build';
    },
    transformIndexHtml: () => headTags(),
    /** After the single file is written: the files that go next to it, and sw.js with that file's fingerprint. */
    closeBundle() {
      const page = path.join(outDir, 'index.html');
      if (!building || !fs.existsSync(page)) {
        return;
      }
      for (const [file, content] of siteFiles()) {
        fs.mkdirSync(path.dirname(path.join(outDir, file)), { recursive: true });
        fs.writeFileSync(path.join(outDir, file), content);
      }
      const version = createHash('sha256').update(fs.readFileSync(page)).digest('hex').slice(0, 12);
      fs.writeFileSync(path.join(outDir, path.basename(SW_URL)), serviceWorker(version));
    },
  };
}
