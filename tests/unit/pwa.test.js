/**
 * @file Unit tests for the installable app (PWA): the icons, the manifest, the security policy, the service worker
 * and the page helpers. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { APP } from '../../src/config.js';
import { MANIFEST_URL, isWebOrigin } from '../../src/core/pwa.js';
import { CSP, GOOGLE, csp } from '../../build/csp.js';
import { encodePng, iconPixels, iconSvg } from '../../build/icons.js';
import { headTags, manifest, serviceWorker, siteFiles } from '../../build/pwa.js';
import { SCOPE, fakeNetwork, loadWorker } from './helpers/fakeServiceWorker.js';

/** Reads a PNG back: its size, and whether every chunk's checksum and the compressed pixels are right. */
function readPng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  let at = 8;
  const chunks = {};
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    assert.equal(
      buffer.readUInt32BE(at + 8 + length),
      zlib.crc32(buffer.subarray(at + 4, at + 8 + length)),
      type + ' CRC',
    );
    chunks[type] = type === 'IDAT' && chunks.IDAT ? Buffer.concat([chunks.IDAT, data]) : data; // pixels may span chunks
    at += 12 + length;
  }
  const width = chunks.IHDR.readUInt32BE(0);
  const height = chunks.IHDR.readUInt32BE(4);
  const channels = { 2: 3, 6: 4 }[chunks.IHDR[9]];
  assert.equal(zlib.inflateSync(chunks.IDAT).length, height * (width * channels + 1), 'pixel data');
  return { width, height, chunks };
}
const fromDataUri = uri => Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');

/* --- icons --- */

test('the icon is drawn as a valid PNG of the asked size', () => {
  for (const px of [180, 192, 512]) {
    const png = readPng(encodePng(iconPixels(px), px, px));
    assert.equal(png.width, px);
    assert.equal(png.height, px);
  }
});

test('the icon: accent square, white line; round corners are see-through, a full icon has none', () => {
  const px = 64;
  const at = (pixels, x, y) => [...pixels.subarray((y * px + x) * 4, (y * px + x) * 4 + 4)];
  const any = iconPixels(px, 'any');
  assert.equal(at(any, 0, 0)[3], 0, 'corner transparent');
  assert.deepEqual(at(any, 32, 4), [0x24, 0x57, 0xd6, 255], 'accent colour');
  // a point on the line (13,15) on the 32 grid
  assert.deepEqual(at(any, 26, 30), [255, 255, 255, 255], 'the line is white');
  const full = iconPixels(px, 'full', 0.8);
  assert.equal(at(full, 0, 0)[3], 255, 'a maskable icon fills its corners');
});

test('the SVG icon is the same drawing', () => {
  const svg = iconSvg();
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 32 32">/);
  assert.match(svg, /rx="8" fill="#2457d6"/);
  assert.match(svg, /d="M7 22L13 15L17 19L25 9"/);
});

/* --- manifest --- */

test('the manifest: standalone, opens at ./, with the app name and colours', () => {
  const m = manifest();
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.id, './');
  assert.equal(m.short_name, APP.name);
  assert.ok(m.name.startsWith(APP.name));
  assert.equal(m.theme_color, APP.colors.light);
  assert.equal(m.background_color, APP.colors.background);
  assert.ok(m.description.length > 20);
});

/** The files written next to the page: path → content. */
const files = siteFiles();
const pngSize = path => {
  const { width, height } = readPng(files.get(path));
  return `${width}x${height}`;
};

test('every manifest icon is a PNG file written next to the page, its size as declared: 192, 512, maskable 512', () => {
  const icons = manifest().icons;
  for (const icon of icons) {
    assert.ok(!icon.src.startsWith('data:'), 'a file, so browser tools can load it: ' + icon.src.slice(0, 30));
    assert.ok(files.has(icon.src), 'written by the build: ' + icon.src);
    if (icon.type === 'image/png') {
      assert.equal(pngSize(icon.src), icon.sizes, icon.src);
    }
  }
  const png = (size, purpose) => icons.find(i => i.type === 'image/png' && i.sizes === size && i.purpose === purpose);
  for (const [size, purpose] of [
    ['192x192', 'any'],
    ['512x512', 'any'],
    ['512x512', 'maskable'],
  ]) {
    assert.ok(png(size, purpose), size + ' ' + purpose);
  }
  // no SVG in the manifest: DevTools checks it with a request from the page, which the security policy refuses (an
  // error in the console); the PNGs are what Android, iOS and desktop installs use. The SVG favicon is in the page.
  assert.ok(icons.every(i => i.type === 'image/png'));
});

test('screenshots for the richer install dialog: one wide (computers), one narrow (phones), as Chrome requires', () => {
  const shots = manifest().screenshots;
  const wide = shots.filter(s => s.form_factor === 'wide');
  const narrow = shots.filter(s => s.form_factor !== 'wide');
  assert.ok(wide.length >= 1 && narrow.length >= 1);
  for (const shot of shots) {
    assert.ok(files.has(shot.src), shot.src);
    assert.equal(shot.type, 'image/png');
    assert.equal(pngSize(shot.src), shot.sizes, 'the declared size is the real one');
    const [w, h] = shot.sizes.split('x').map(Number);
    assert.ok(Math.min(w, h) >= 320 && Math.max(w, h) <= 3840, 'each side 320 to 3840 px');
    assert.ok(Math.max(w, h) / Math.min(w, h) <= 2.3, 'not longer than 2.3 times its width');
    assert.ok(shot.form_factor === 'wide' ? w > h : h > w);
    assert.ok(shot.label.length > 10, 'described for screen readers');
  }
});

test('the manifest written next to the page is the manifest', () => {
  assert.deepEqual(JSON.parse(files.get('manifest.webmanifest')), manifest());
});

test('no robots.txt or llms.txt: a hosted copy of personal finances does not invite crawlers', () => {
  assert.equal(files.has('robots.txt'), false);
  assert.equal(files.has('llms.txt'), false);
});

test('the page head gets the icons inline: SVG favicon and a 180 px iOS icon', () => {
  const tags = headTags();
  const icon = tags.find(t => t.attrs.rel === 'icon');
  const apple = tags.find(t => t.attrs.rel === 'apple-touch-icon');
  assert.match(icon.attrs.href, /^data:image\/svg\+xml,/);
  assert.equal(apple.attrs.sizes, '180x180');
  const { width } = readPng(fromDataUri(apple.attrs.href));
  assert.equal(width, 180);
  assert.equal(readPng(fromDataUri(apple.attrs.href)).chunks.IHDR[9], 6);
});

/* --- security policy --- */

const rulesOf = policy =>
  Object.fromEntries(
    policy
      .split(';')
      .map(r => r.trim().split(/\s+/))
      .map(([k, ...v]) => [k, v]),
  );

test('the security policy blocks every other site; its own site only for the manifest, the worker and its own files', () => {
  const rules = rulesOf(CSP);
  assert.deepEqual(rules['default-src'], ["'none'"]);
  assert.deepEqual(rules['manifest-src'], ["'self'"], 'manifest.webmanifest, next to the page');
  assert.deepEqual(rules['worker-src'], ["'self'"], 'sw.js from the same site, nothing else');
  assert.deepEqual(rules['img-src'], ['data:', "'self'"], 'inline images, and the manifest icons next to the page');
  assert.deepEqual(rules['connect-src'], ["'self'"], 'requests to its own site only (i18n-texts.json, browser tools)');
  assert.deepEqual(
    rules['script-src'],
    ["'unsafe-inline'", "'self'", 'blob:'],
    'the page, and the QR modules loaded when used',
  );
  assert.equal(rules['frame-src'], undefined);
  assert.ok(!CSP.includes('google'), 'without Drive sync, nothing of Google');
});

test('with Drive sync built in, Google sign-in and the Drive API are the only other sites allowed', () => {
  const rules = rulesOf(csp({ google: true }));
  assert.deepEqual(rules['default-src'], ["'none'"]);
  assert.deepEqual(rules['script-src'], ["'unsafe-inline'", "'self'", 'blob:', GOOGLE.script]);
  assert.deepEqual(rules['connect-src'], ["'self'", 'https://accounts.google.com/gsi/', 'https://www.googleapis.com']);
  assert.deepEqual(rules['frame-src'], ['https://accounts.google.com/gsi/']);
  assert.deepEqual(rules['img-src'], ['data:', "'self'"], 'no images from elsewhere');
});

test('the file to hand out allows nothing of its own site: only the page and the QR tools inside it', () => {
  const rules = rulesOf(csp({ standalone: true }));
  assert.deepEqual(rules['default-src'], ["'none'"]);
  assert.deepEqual(rules['script-src'], ["'unsafe-inline'", 'blob:']);
  assert.deepEqual(rules['img-src'], ['data:']);
  assert.equal(rules['connect-src'], undefined, 'no requests at all');
  assert.equal(rules['manifest-src'], undefined);
  assert.equal(rules['worker-src'], undefined);
  const withGoogle = rulesOf(csp({ standalone: true, google: true }));
  assert.deepEqual(withGoogle['connect-src'], ['https://accounts.google.com/gsi/', 'https://www.googleapis.com']);
});

/* --- page helpers --- */

test('a service worker and a manifest only on http and https pages', () => {
  assert.equal(isWebOrigin({ protocol: 'https:' }), true);
  assert.equal(isWebOrigin({ protocol: 'http:' }), true);
  assert.equal(isWebOrigin({ protocol: 'file:' }), false);
  assert.equal(isWebOrigin({ protocol: 'blob:' }), false);
  assert.equal(isWebOrigin({ protocol: 'data:' }), false);
  assert.equal(isWebOrigin(undefined), false);
});

test('the manifest is the file next to the page', () => {
  assert.equal(MANIFEST_URL, './manifest.webmanifest');
  assert.ok(siteFiles().has(MANIFEST_URL.slice(2)));
});

/* --- service worker --- */

const PAGE = SCOPE + 'index.html';
const worker = (options = {}) => loadWorker(serviceWorker('v1'), options);
/** A server with the page and the files the page loads when used (QR modules, texts), each body tagged. */
const site = (tag = 'v1') =>
  fakeNetwork({
    [PAGE]: [200, `${tag} page`],
    [SCOPE + 'qr-encode.js']: [200, `${tag} encode`],
    [SCOPE + 'qr-decode.js']: [200, `${tag} decode`],
    [SCOPE + 'i18n-texts.json']: [200, `${tag} texts`],
    [SCOPE + 'manifest.webmanifest']: [200, `${tag} manifest`],
  });
const body = async result => (result.responded ? result.response.text() : null);

test('the worker is plain JavaScript with its version in the cache name', () => {
  assert.doesNotThrow(() => new Function(serviceWorker('abc123')));
  assert.match(serviceWorker('abc123'), /runway-abc123/);
  assert.notEqual(serviceWorker('a'), serviceWorker('b'));
});

test('install keeps the page, the QR modules and the texts, and does not take over open pages', async () => {
  const w = worker({ network: site() });
  await w.install();
  const cache = await w.caches.open('runway-v1');
  for (const [file, text] of [
    ['index.html', 'v1 page'],
    ['qr-encode.js', 'v1 encode'],
    ['qr-decode.js', 'v1 decode'],
    ['i18n-texts.json', 'v1 texts'],
    ['manifest.webmanifest', 'v1 manifest'],
  ]) {
    assert.equal(await (await cache.match(SCOPE + file)).text(), text, file);
  }
  assert.equal(w.state.skipped, false, 'no skipWaiting: an open page keeps the worker of its own version');
});

test('install fails, and keeps nothing, when the page cannot be fetched', async () => {
  const network = site();
  network.offline = true;
  const w = worker({ network });
  await assert.rejects(() => w.install());
  assert.equal(w.caches.stores.has('runway-v1'), false);
});

test('install fails when a file the page loads is missing; the icons and screenshots are optional', async () => {
  const network = site();
  delete network.pages[SCOPE + 'qr-decode.js'];
  await assert.rejects(() => worker({ network }).install());
  await assert.doesNotReject(() => worker({ network: site() }).install(), 'icons and screenshots are 404 here');
});

test('the page opens from the cache of its own version, for the folder too, offline as well', async () => {
  const network = site();
  const w = worker({ network });
  await w.install();
  network.pages[PAGE] = [200, 'v2 page'];
  assert.equal(await body(await w.fetch(PAGE)), 'v1 page', 'never a newer page under an older worker');
  network.offline = true;
  assert.equal(await body(await w.fetch(PAGE + '?again#x')), 'v1 page');
  assert.equal(await body(await w.fetch(SCOPE)), 'v1 page', 'start_url ./ is the page');
});

test('the QR modules and the texts come from the cache of the worker that installed with the page', async () => {
  const network = site();
  const w = worker({ network });
  await w.install();
  Object.assign(network.pages, site('v2').pages); // a new build on the server, same file names
  assert.equal(await body(await w.fetch(SCOPE + 'qr-encode.js', { mode: 'no-cors' })), 'v1 encode');
  assert.equal(await body(await w.fetch(SCOPE + 'i18n-texts.json', { mode: 'cors' })), 'v1 texts');
});

test('anything else in its folder, other sites and anything but GET are left to the browser, never cached', async () => {
  const network = site();
  network.pages[SCOPE + 'notes.html'] = [200, 'notes'];
  const w = worker({ network });
  await w.install();
  assert.equal((await w.fetch(SCOPE + 'notes.html')).responded, false, 'other content next to the app');
  assert.equal((await w.fetch(SCOPE + 'runway-money-planner.html')).responded, false);
  assert.equal((await w.fetch('https://elsewhere.example/x.js')).responded, false);
  assert.equal((await w.fetch('https://example.org/other-app/index.html')).responded, false);
  assert.equal((await w.fetch(PAGE, { method: 'POST' })).responded, false);
  assert.equal(await (await w.caches.open('runway-v1')).match(SCOPE + 'notes.html'), undefined);
});

test('a file that could not be kept at install comes from the network and is not cached', async () => {
  const w = worker({ network: site() });
  await w.install();
  const icon = SCOPE + 'icons/icon-192.png';
  const r = await w.fetch(icon, { mode: 'no-cors' });
  assert.equal(r.responded, true);
  assert.equal(r.response.status, 404);
  assert.equal(await (await w.caches.open('runway-v1')).match(icon), undefined);
});

test('a new version removes the caches of older versions only, and takes the open pages', async () => {
  const stores = new Map();
  const network = site();
  const old = loadWorker(serviceWorker('old'), { network, caches: stores });
  await old.install();
  await old.activate();
  stores.set('someone-else', {});
  const next = loadWorker(serviceWorker('new'), { network, caches: stores });
  await next.install();
  assert.ok(stores.has('runway-old'), 'kept while the new worker waits for the old pages to close');
  await next.activate();
  assert.deepEqual([...stores.keys()].sort(), ['runway-new', 'someone-else']);
  assert.equal(next.state.claimed, true);
});
