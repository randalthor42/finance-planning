/**
 * @file The installable app (PWA), the pure part: when it applies and how its manifest is linked. No DOM.
 */

/** The service worker and the web app manifest, written next to the page by the build (build/pwa.js). */
export const SW_URL = './sw.js';
export const MANIFEST_URL = './manifest.webmanifest';

/**
 * A service worker and a manifest work only on pages served over http or https. Opened as a file (file:), or from a
 * blob: or data: URL, the app skips both and runs as before, with nothing in the console.
 */
export const isWebOrigin = location => !!location && (location.protocol === 'http:' || location.protocol === 'https:');
