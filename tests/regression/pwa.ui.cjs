/**
 * @file Browser test of the installable app (PWA): manifest, icons, service worker, security policy, meta tags.
 * Run with: npm run test:pwa (it builds dist-test and dist first).
 *
 * Opened as a file (file://) the app must run as before with nothing in the console: no manifest, no service worker.
 * Served over http (localhost counts as secure, like https), it must be installable (Chrome's own check, through the
 * DevTools protocol), open offline from the service worker, and still make no request outside its own folder.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const TEST_BUILD = path.join(ROOT, 'dist-test');
const SHIPPED = path.join(ROOT, 'dist', 'runway-money-planner.html');
let failed = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failed++;
};

/** Serves dist-test. swSuffix changes sw.js, as a new build would. */
function serve() {
  const state = { swSuffix: '', requests: [] };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    state.requests.push(url);
    const file = path.join(TEST_BUILD, url.endsWith('/') ? url + 'index.html' : url);
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end();
      }
      const type = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'text/javascript' : 'application/json';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
      res.end(file.endsWith('sw.js') ? data + state.swSuffix : data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, state })));
}

/** Every console message (not only errors: a warning about the manifest would count too) and page error. */
function listen(page, into) {
  page.on('console', m => into.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => into.push('pageerror: ' + e.message));
}

(async () => {
  const browser = await chromium.launch();
  const { server, state } = await serve();
  const BASE = `http://127.0.0.1:${server.address().port}/app/`.replace('/app/', '/');
  try {
    // ------------------------------------------------------------------ opened as a file: nothing new happens
    for (const [label, file] of [
      ['test build', path.join(TEST_BUILD, 'index.html')],
      ['shipped file', SHIPPED],
    ]) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const logs = [];
      listen(page, logs);
      await page.goto('file://' + file);
      await page.getByText('Look around with a sample plan').click();
      await page.waitForTimeout(300);
      ok((await page.locator('.kpi').count()) >= 4, `file (${label}): the app runs`);
      ok((await page.locator('link[rel="manifest"]').count()) === 0, `file (${label}): no manifest linked`);
      const registrations = await page.evaluate(async () =>
        navigator.serviceWorker && navigator.serviceWorker.getRegistrations
          ? (await navigator.serviceWorker.getRegistrations().catch(() => [])).length
          : 0,
      );
      ok(registrations === 0, `file (${label}): no service worker`);
      if (label === 'test build') {
        ok((await page.evaluate(() => registerServiceWorker())) === null, 'file: registering is skipped, quietly');
        ok((await page.evaluate(() => linkManifest(manifest => manifest))) === null, 'file: linking the manifest is skipped');
      }
      ok(logs.length === 0, `file (${label}): nothing in the console` + (logs.length ? ': ' + logs.join(' | ') : ''));
      await ctx.close();
    }

    // ------------------------------------------------------------------ served over http: an installable app
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const logs = [];
    listen(page, logs);
    const outside = [];
    page.on('request', r => {
      const u = r.url();
      if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) outside.push(u);
    });
    await page.goto(BASE + 'index.html');
    await page.getByText('Look around with a sample plan').click();
    const cdp = await ctx.newCDPSession(page);

    // the head
    const head = await page.evaluate(() => {
      const meta = n => [...document.querySelectorAll(`meta[name="${n}"]`)].map(m => m.content);
      const link = r => document.querySelector(`link[rel="${r}"]`);
      return {
        viewport: meta('viewport')[0],
        capable: meta('mobile-web-app-capable')[0],
        apple: meta('apple-mobile-web-app-capable')[0],
        status: meta('apple-mobile-web-app-status-bar-style')[0],
        title: meta('apple-mobile-web-app-title')[0],
        theme: meta('theme-color'),
        phone: meta('format-detection')[0],
        icon: link('icon') && link('icon').getAttribute('href'),
        touch: link('apple-touch-icon') && [link('apple-touch-icon').getAttribute('sizes'), link('apple-touch-icon').getAttribute('href')],
        manifest: link('manifest') && link('manifest').href,
        csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,
      };
    });
    ok(/viewport-fit=cover/.test(head.viewport) && /width=device-width/.test(head.viewport), 'head: viewport covers the screen');
    ok(head.capable === 'yes' && head.apple === 'yes' && head.title === 'Runway', 'head: full screen on Android and iOS, with its name');
    ok(head.status === 'black-translucent', 'head: iOS status bar over the page');
    ok(head.theme.length === 2 && head.phone === 'telephone=no', 'head: theme colours; amounts are not phone numbers');
    ok(!!head.icon && head.icon.startsWith('data:image/svg+xml,%3Csvg'), 'head: the favicon is inline SVG');
    ok(!!head.touch && head.touch[0] === '180x180' && head.touch[1].startsWith('data:image/png;base64,iVBOR'), 'head: the iOS icon is an inline 180 px PNG');
    ok(head.manifest === BASE + 'manifest.webmanifest', 'head: the manifest file next to the page is linked');
    ok(/manifest-src 'self'/.test(head.csp) && /worker-src 'self'/.test(head.csp) && /connect-src 'self'/.test(head.csp) && /default-src 'none'/.test(head.csp), 'csp: its own site for the manifest, the worker and its own files; nothing else');

    // Chrome's view of the manifest, and its install check
    const app = await cdp.send('Page.getAppManifest');
    const m = JSON.parse(app.data || '{}');
    ok(app.errors.length === 0, 'manifest: no errors or warnings' + (app.errors.length ? ': ' + JSON.stringify(app.errors) : ''));
    ok(m.display === 'standalone' && m.short_name === 'Runway', 'manifest: standalone, named Runway');
    ok(m.start_url === './' && m.scope === './', 'manifest: start_url and scope are ./');
    ok(app.manifest.startUrl === BASE && app.manifest.scope === BASE && app.manifest.id === BASE, 'manifest: Chrome resolves ./ to the app’s folder (' + app.manifest.startUrl + ')');
    ok(m.icons.every(i => i.src.startsWith('icons/')) && m.icons.some(i => i.purpose === 'maskable'), 'manifest: icon files, one maskable');
    ok(m.screenshots.some(s => s.form_factor === 'wide') && m.screenshots.some(s => s.form_factor === 'narrow'), 'manifest: a wide and a narrow screenshot');
    // every file the manifest names is there, with the size it declares
    const sizes = [];
    for (const { src, sizes: declared } of [...m.icons, ...m.screenshots]) {
      const res = await page.request.get(new URL(src, BASE).href); // as the browser's installer fetches it
      const body = await res.body();
      const real = body[0] === 0x89 ? `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}` : 'any';
      sizes.push(res.ok() && real === declared);
    }
    ok(sizes.every(x => x === true), 'manifest: every icon and screenshot loads, at its declared size: ' + JSON.stringify(sizes));
    ok(m.theme_color === '#2457d6' && m.background_color === '#f5f6f8', 'manifest: theme and background colours');

    // the service worker
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return { scope: reg.scope, active: !!reg.active, url: reg.active.scriptURL };
    });
    ok(sw.active && sw.scope === BASE && sw.url === BASE + 'sw.js', 'worker: sw.js is active for ./');
    const install = await cdp.send('Page.getInstallabilityErrors');
    ok(install.installabilityErrors.length === 0, 'installable (Chrome’s own check)' + (install.installabilityErrors.length ? ': ' + JSON.stringify(install.installabilityErrors) : ''));
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    ok(true, 'worker: controls the page after a reload');
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const cache = await caches.open(keys[0]);
      return { keys, pages: (await cache.keys()).map(r => r.url) };
    });
    ok(cached.keys.length === 1 && /^runway-[0-9a-f]{12}$/.test(cached.keys[0]), 'worker: one cache, named after the build: ' + cached.keys[0]);
    ok(cached.pages.includes(BASE + 'index.html'), 'worker: the app’s page is kept');
    ok(
      ['qr-encode.js', 'qr-decode.js', 'i18n-texts.json'].every(f => cached.pages.includes(BASE + f)),
      'worker: what the page loads only when used is kept too (QR modules, texts to translate)',
    );

    // offline: the installed app still opens, with its plans
    const plan = await page.evaluate(() => Store.plan.name);
    await ctx.setOffline(true);
    await page.reload();
    await page.locator('.kpi').first().waitFor();
    ok((await page.evaluate(() => Store.plan && Store.plan.name)) === plan, 'offline: the app opens from the worker, with its plan');
    const qrOffline = await page.evaluate(async () => {
      const [{ drawFrame }, { decode }] = await Promise.all([loadQr('encode'), loadQr('decode')]);
      const c = document.createElement('canvas');
      drawFrame(c, 'offline QR');
      return decode(c.getContext('2d').getImageData(0, 0, c.width, c.height));
    });
    ok(qrOffline === 'offline QR', 'offline: QR codes can still be made and read (modules from the worker)');
    ok((await page.evaluate(async () => (await I18N.loadTexts()).keys.length)) > 1000, 'offline: Export language still has every text');
    await ctx.setOffline(false);

    // the app's theme drives the bar colour
    await page.evaluate(() => Store.setPref('theme', 'dark'));
    ok(
      (await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.content).join())) === '#161d25,#161d25',
      'theme: the bar follows the dark theme',
    );
    await page.evaluate(() => Store.setPref('theme', 'light'));
    ok(
      (await page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.content).join())) === '#2457d6,#2457d6',
      'theme: and the light one',
    );

    // nothing outside its own folder, and the page itself still cannot fetch
    ok(outside.length === 0, 'network: no request outside the app’s folder' + (outside.length ? ': ' + outside.join(', ') : ''));
    ok(logs.length === 0, 'http: nothing in the console' + (logs.length ? ': ' + logs.join(' | ') : ''));
    const blocked = await page.evaluate(async () => {
      let violations = 0;
      document.addEventListener('securitypolicyviolation', () => violations++);
      const results = await Promise.allSettled([fetch('https://example.com/'), fetch('http://127.0.0.2:9/x')]);
      await new Promise(r => setTimeout(r, 50));
      return { rejected: results.every(r => r.status === 'rejected'), violations };
    });
    ok(blocked.rejected && blocked.violations === 2, 'csp: the page cannot send anything to another site');

    // the phone screen: nothing wider than the screen
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(overflow <= 1, 'phone: fits the screen');

    // under an iPhone's status bar and home indicator (when the browser can pretend to have them)
    const insets = await cdp
      .send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, topMax: 47, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 } })
      .then(() => true)
      .catch(() => false);
    if (insets) {
      await page.waitForTimeout(100);
      const safe = await page.evaluate(() => ({
        bar: getComputedStyle(document.body, '::before').height,
        barColour: getComputedStyle(document.body, '::before').backgroundColor,
        top: document.querySelector('.top').getBoundingClientRect().top,
        mainBottom: getComputedStyle(document.querySelector('main')).paddingBottom,
      }));
      ok(safe.bar === '47px' && safe.barColour === 'rgb(36, 87, 214)', 'safe area: a coloured band under the status bar: ' + JSON.stringify(safe));
      ok(safe.top >= 47, 'safe area: the top bar starts below the status bar');
      ok(safe.mainBottom === '114px', 'safe area: content clears the home indicator');
      await page.screenshot({ path: path.join(__dirname, 'shots', 'pwa-iphone.png') });
    } else {
      console.log('skip safe area: this Chromium cannot emulate it');
    }
    // a new build: it waits while a page of the old one is open (that page keeps the files of its own version), then
    // replaces the old worker and its cache once the page is closed
    state.swSuffix = '
// next build
';
    const waiting = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg.update();
      const worker = reg.installing || reg.waiting;
      if (worker && worker.state === 'installing') {
        await new Promise(resolve => worker.addEventListener('statechange', () => worker.state !== 'installing' && resolve()));
      }
      return { state: worker && worker.state, caches: (await caches.keys()).length };
    });
    ok(waiting.state === 'installed' && waiting.caches === 2, 'update: the new worker waits while the old page is open, both versions kept: ' + JSON.stringify(waiting));
    await page.close();
    let keys = [];
    for (const deadline = Date.now() + 5000; Date.now() < deadline && keys.length !== 1; ) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const workers = ctx.serviceWorkers();
      if (workers.length) {
        keys = await workers[workers.length - 1].evaluate(() => caches.keys()).catch(() => keys);
      }
    }
    ok(keys.length === 1, 'update: once the old page is closed, the new worker replaces the old one and its cache');
    await ctx.close();
  } catch (e) {
    ok(false, 'stopped: ' + (e && e.message ? e.message.split('\n')[0] : e));
  }
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} FAILED` : `\nPWA OK (${checks} checks)`);
  process.exit(failed ? 1 : 0);
})();
