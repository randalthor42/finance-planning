/**
 * @file The installable app (PWA) and the site's files, at build time: a Vite plugin that adds them to the
 * single-file build.
 *
 * - Next to the page it writes manifest.webmanifest (display standalone, start_url ./), its icons and screenshots as
 *   files, sw.js (the service worker), robots.txt and llms.txt: siteFiles(). These matter only where the page is
 *   served over http or https, and they go with it like sw.js does (a service worker must be a file on the same
 *   site). Manifest images are files, not data: URIs, so browser tools (DevTools' Manifest panel) can check them;
 *   ui/pwa.js links the manifest over http(s) only.
 * - The page head gets the favicon (SVG) and the iOS home screen icon (PNG, 180 px) inline: opened as a file, the app
 *   still has its icons and depends on no other file.
 * - sw.js is named after a fingerprint of the page, so each build replaces the last.
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
/** The files written next to the page, except sw.js: relative path → content. Drawn once per build. */
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
    cached.set('robots.txt', 'User-agent: *\nAllow: /\n');
    cached.set(
      'llms.txt',
      `# ${APP.name}\n\n> ${DESCRIPTION}\n\n` +
        `${APP.name} is a personal finance planner that runs entirely in the browser, from one HTML file. ` +
        'It plans income, bills, budgets, subscriptions, transactions, trips and events, wishes, savings goals and ' +
        'loans up to ten years ahead, and shows every month, a forecast, reviews and an audit of the plan.\n\n' +
        '## Privacy\n\n' +
        '- Works offline. The page contacts no other site, except Google sign-in and Google Drive when the person turns\n' +
        '  sync on; from where it is served it loads only its own files (the QR tools, the texts to translate).\n' +
        "- The data stays on the person's devices: in the browser's storage, in a JSON file of their choosing, and, if\n" +
        '  they turn sync on, in a hidden app folder of their own Google Drive (optionally encrypted).\n' +
        '- Plans can move between devices with QR codes, with no network.\n' +
        '- There is no account of ours, no server-side data and nothing to crawl beyond this page.\n\n' +
        '## App\n\n' +
        `- [${APP.name}](./): the planner itself, one HTML file that also works offline\n` +
        '- [Web app manifest](./manifest.webmanifest): name, icons and screenshots of the installable app\n',
    );
  }
  return cached;
}

/** The web app manifest. */
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

/** The icons in the page head: the browser tab (SVG) and the iOS home screen (PNG; iOS rounds the corners itself). */
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
 * The service worker. It keeps the app's page so the installed app opens offline, and opens it from that copy at
 * once while a fresh copy is fetched for the next time (stale-while-revalidate). It only handles GET requests for
 * its own folder; it never sees the plans (they are in the browser storage and the data file, not in requests;
 * Drive sync's requests go to Google, outside its folder, and pass it by). It also keeps the QR transfer modules and
 * the texts to translate, which the page loads only when used.
 * Written as a function so it is real, linted code; serviceWorker() turns it into sw.js.
 */
function worker(CACHE, FILES) {
  const scope = self.registration.scope;
  /** One copy per page, whatever its ?query or #part. */
  const key = url => {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href;
  };
  self.addEventListener('install', event => {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        // the page that registered the worker (the app's HTML file), or the folder itself
        const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const urls = new Set(pages.map(c => key(c.url)).filter(url => url.startsWith(scope)));
        if (!urls.size) {
          urls.add(scope);
        }
        // what the page loads only when used (the QR modules, the texts to translate): kept now for offline use
        for (const file of FILES) {
          urls.add(new URL(file, scope).href);
        }
        await Promise.all(
          [...urls].map(async url => {
            try {
              const response = await fetch(url, { cache: 'reload' });
              if (response.ok) {
                await cache.put(url, response);
              }
            } catch (e) {} // offline while installing: the page is kept the next time it loads
          }),
        );
        await self.skipWaiting();
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
    if (request.method !== 'GET' || !request.url.startsWith(scope)) {
      return;
    }
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const kept = await cache.match(request, { ignoreSearch: true });
        const fresh = fetch(request).then(async response => {
          if (response.ok && response.type === 'basic') {
            await cache.put(key(request.url), response.clone());
          }
          return response;
        });
        if (kept) {
          event.waitUntil(fresh.catch(() => {}));
          return kept;
        }
        return fresh;
      })(),
    );
  });
}

/** The texts to translate (Export language), next to the page: loaded only when needed (vite.config.js). */
export const TEXTS_FILE = 'i18n-texts.json';
/** Files next to the page the worker keeps at install, beyond the page: what it loads only when used. */
const CACHED_FILES = [...Object.values(QR_MODULES).map(m => m.file), TEXTS_FILE];

/** The text of sw.js for one build. */
export function serviceWorker(version) {
  return (
    `/* Runway service worker, build ${version}. Generated by build/pwa.js: edit it there. */\n` +
    `(${worker.toString()})(${JSON.stringify('runway-' + version)}, ${JSON.stringify(CACHED_FILES)});\n`
  );
}

/** The Vite plugin. */
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
    /** After the single file is written: the files that go next to it, and sw.js named after that file's content. */
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
