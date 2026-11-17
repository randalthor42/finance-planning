/**
 * @file The Content Security Policy of the built file (a <meta> tag, added by vite.config.js when building). The
 * page cannot reach any other site: no script, style, image, font or request from anywhere else, so nothing typed
 * into it can be sent away. Beyond the inline page itself it allows, for the installable app served over http(s):
 * - manifest-src 'self' manifest.webmanifest, next to the page;
 * - img-src 'self'      its icons (the browser loads one for the page to offer installing it), next to the page;
 * - worker-src 'self'   the service worker, sw.js next to the page;
 * - connect-src 'self'  requests to the page's own site only. The app needs it: the served page fetches
 *                       i18n-texts.json (the texts to translate, virtual:i18n-keys in vite.config.js) when Settings ›
 *                       Language opens, and Export language fails without it. Browser tools use it too (DevTools checks the manifest's icons and
 *                       screenshots). Data could go nowhere new: the site that serves the page already controls its
 *                       code. Opened as a file, there is no site to reach.
 * - script-src 'self' blob:  the QR code reader and maker (ui/qrLoader.js), loaded only when used: qr-*.js from
 *                       its own site when served, or from the page itself (a blob: URL) when it is opened as a file.
 *
 * With Google Drive sync built in (a Google client ID when building: docs/sync.md), and only then, Google's sign-in
 * script and window (accounts.google.com/gsi) and the Drive API (www.googleapis.com) are allowed too: the one place
 * outside the device the data can go, when the person turns sync on.
 *
 * The file to hand out (runway-money-planner.html, `standalone`) needs none of the 'self' sources: it has the QR tools
 * and the texts inside, is not an installable app, and opened from a disk has no site. Its policy allows only the page
 * itself, blob: for the QR tools and, with Drive sync built in, Google.
 */
export const GOOGLE = {
  script: 'https://accounts.google.com/gsi/client',
  frame: 'https://accounts.google.com/gsi/',
  style: 'https://accounts.google.com/gsi/style',
  connect: ['https://accounts.google.com/gsi/', 'https://www.googleapis.com'],
};

/** The policy. google: Drive sync is built in. standalone: the file to hand out (see above). */
export function csp({ google = false, standalone = false } = {}) {
  const g = (...urls) => (google ? urls : []);
  const self = standalone ? [] : ["'self'"];
  const connect = [...self, ...g(...GOOGLE.connect)];
  return [
    "default-src 'none'",
    ["style-src 'unsafe-inline'", ...g(GOOGLE.style)].join(' '),
    ["script-src 'unsafe-inline'", ...self, 'blob:', ...g(GOOGLE.script)].join(' '),
    ['img-src data:', ...self].join(' '),
    ...(standalone ? [] : ["manifest-src 'self'", "worker-src 'self'"]),
    ...(connect.length ? [['connect-src', ...connect].join(' ')] : []),
    ...(google ? [`frame-src ${GOOGLE.frame}`] : []),
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** The policy of a build without Drive sync. */
export const CSP = csp();
