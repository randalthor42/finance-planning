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

test('robots.txt lets crawlers in and points nowhere else; llms.txt describes the app in Markdown', () => {
  const robots = files.get('robots.txt');
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.ok(!/Sitemap|http/i.test(robots));
  const llms = files.get('llms.txt');
  assert.match(llms, /^# Runway\n/, 'one H1 first');
  assert.match(llms, /^> /m, 'a summary');
  assert.ok(/offline/i.test(llms) && /data stays/i.test(llms));
  assert.match(llms, /^## App$/m);
  assert.match(llms, /^- \[Runway\]\(\.\/\): /m, 'links, as llms.txt lists them');
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

test('the security policy blocks every other site; its own site only for the manifest, the worker and browser tools', () => {
  const rules = rulesOf(CSP);
  assert.deepEqual(rules['default-src'], ["'none'"]);
  assert.deepEqual(rules['manifest-src'], ["'self'"], 'manifest.webmanifest, next to the page');
  assert.deepEqual(rules['worker-src'], ["'self'"], 'sw.js from the same site, nothing else');
  assert.deepEqual(rules['img-src'], ['data:', "'self'"], 'inline images, and the manifest icons next to the page');
  assert.deepEqual(rules['connect-src'], ["'self'"], 'requests to its own site only (DevTools, Lighthouse)');
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

test('the worker is plain JavaScript with its version in the cache name', () => {
  assert.doesNotThrow(() => new Function(serviceWorker('abc123')));
  assert.match(serviceWorker('abc123'), /runway-abc123/);
  assert.notEqual(serviceWorker('a'), serviceWorker('b'));
});

test('install keeps the page that registered it, and the worker takes over at once', async () => {
  const network = fakeNetwork({ [PAGE]: [200, '<html>app</html>'] });
  const w = worker({ network, clientUrls: [PAGE + '?plan=1#x'] });
  await w.install();
  const cached = await (await w.caches.open('runway-v1')).match(PAGE);
  assert.equal(await cached.text(), '<html>app</html>');
  assert.equal(w.state.skipped, true);
});

test('install also keeps the QR transfer modules, so sending and receiving work offline', async () => {
  const network = fakeNetwork({
    [PAGE]: [200, 'app'],
    [SCOPE + 'qr-encode.js']: [200, 'encode'],
    [SCOPE + 'qr-decode.js']: [200, 'decode'],
  });
  const w = worker({ network, clientUrls: [PAGE] });
  await w.install();
  const cache = await w.caches.open('runway-v1');
  assert.equal(await (await cache.match(SCOPE + 'qr-encode.js')).text(), 'encode');
  assert.equal(await (await cache.match(SCOPE + 'qr-decode.js')).text(), 'decode');
});

test('install does not fail when a page cannot be fetched', async () => {
  const network = fakeNetwork({});
  network.offline = true;
  const w = worker({ network });
  await assert.doesNotReject(() => w.install());
});

test('a page in the cache opens from it at once, and the cache is refreshed behind it', async () => {
  const network = fakeNetwork({ [PAGE]: [200, 'version 1'] });
  const w = worker({ network });
  await w.install();
  network.pages[PAGE] = [200, 'version 2'];
  const first = await w.fetch(PAGE);
  assert.equal(await first.response.text(), 'version 1', 'instant, from the cache');
  const second = await w.fetch(PAGE);
  assert.equal(await second.response.text(), 'version 2', 'the next visit has the update');
});

test('offline: the app still opens from the cache', async () => {
  const network = fakeNetwork({ [PAGE]: [200, 'the app'] });
  const w = worker({ network });
  await w.install();
  network.offline = true;
  const r = await w.fetch(PAGE + '?again');
  assert.equal(await r.response.text(), 'the app');
});

test('a page not in the cache comes from the network and is kept', async () => {
  const other = SCOPE + 'runway-money-planner.html';
  const network = fakeNetwork({ [PAGE]: [200, 'a'], [other]: [200, 'b'] });
  const w = worker({ network });
  await w.install();
  const r = await w.fetch(other);
  assert.equal(await r.response.text(), 'b');
  network.offline = true;
  assert.equal(await (await w.fetch(other)).response.text(), 'b');
});

test('errors from the server are not kept', async () => {
  const missing = SCOPE + 'missing.html';
  const w = worker({ network: fakeNetwork({ [PAGE]: [200, 'a'] }) });
  await w.install();
  const r = await w.fetch(missing);
  assert.equal(r.response.status, 404);
  assert.equal(await (await w.caches.open('runway-v1')).match(missing), undefined);
});

test('other sites, other folders and anything but GET are left to the browser', async () => {
  const w = worker({ network: fakeNetwork({ [PAGE]: [200, 'a'] }) });
  await w.install();
  assert.equal((await w.fetch('https://elsewhere.example/x.js')).responded, false);
  assert.equal((await w.fetch('https://example.org/other-app/index.html')).responded, false);
  assert.equal((await w.fetch(PAGE, { method: 'POST' })).responded, false);
});

test('a new version removes the caches of older versions only, and takes the open pages', async () => {
  const stores = new Map();
  const network = fakeNetwork({ [PAGE]: [200, 'a'] });
  const old = loadWorker(serviceWorker('old'), { network, caches: stores });
  await old.install();
  await old.activate();
  stores.set('someone-else', {});
  const next = loadWorker(serviceWorker('new'), { network, caches: stores });
  await next.install();
  await next.activate();
  assert.deepEqual([...stores.keys()].sort(), ['runway-new', 'someone-else']);
  assert.equal(next.state.claimed, true);
});
