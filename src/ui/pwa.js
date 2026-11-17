/**
 * @file The installable app (PWA) in the page: links the manifest, registers the service worker, keeps the colour of
 * the bar above the app in step with the theme. Only over http or https (core/pwa.js isWebOrigin): opened as a file,
 * none of this runs and nothing is logged. The manifest, its icons and screenshots and sw.js are files the build writes
 * next to the page (build/pwa.js).
 */
import { APP } from '../config.js';
import { MANIFEST_URL, SW_URL, isWebOrigin } from '../core/pwa.js';

/**
 * Links manifest.webmanifest, the file next to this page (security policy: manifest-src 'self'). Only over http(s):
 * opened as a file, the browser would refuse to read it (and say so in the console).
 */
export function linkManifest() {
  if (!isWebOrigin(location) || document.querySelector('link[rel="manifest"]')) {
    return null;
  }
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = MANIFEST_URL;
  document.head.append(link);
  return link;
}

/**
 * Registers sw.js, the file next to this page, so the installed app opens offline. Skipped on file: pages (service
 * workers need http or https), where the browser has no service workers (or not on plain http away from localhost),
 * and on the development server (it would keep old versions of the code). Never throws: resolves to the registration
 * or null.
 */
export function registerServiceWorker() {
  if ((import.meta.env && import.meta.env.DEV) || !isWebOrigin(location) || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker.register(SW_URL, { scope: './', updateViaCache: 'none' }).catch(() => null);
}

let shown = null;
/**
 * The colour of the bar above the app (Android's status bar, the installed app's title bar, Safari's tab bar): the
 * theme the person chose, not only the system's. The two theme-color tags of index.html follow the system until then.
 */
export function themeColor(theme) {
  if (theme === shown) {
    return;
  }
  shown = theme;
  const color = theme === 'dark' ? APP.colors.dark : APP.colors.light;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = color;
  }
}

/**
 * Everything above, from main.js. The worker waits for the page to finish loading, so it never delays the app. The
 * file to hand out (marked data-standalone by the build) is not an installable app: it has no manifest or worker next
 * to it, and its security policy allows neither.
 */
export function startPwa() {
  if (document.documentElement.hasAttribute('data-standalone')) {
    return Promise.resolve(null);
  }
  linkManifest();
  if (document.readyState === 'complete') {
    return registerServiceWorker();
  }
  return new Promise(resolve => addEventListener('load', () => resolve(registerServiceWorker()), { once: true }));
}
