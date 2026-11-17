/**
 * @file Loads the QR maker or reader (src/ui/qr/) the first time a QR transfer needs it: they are not part of the
 * page (build/qr.js). Served over http(s): the module next to the page (qr-encode.js, qr-decode.js). The file opened
 * from a disk: the copy embedded in it, as a blob: module. While developing: the source module.
 */
import { $t } from '../core/i18n.js';

const loaded = {};

/** @param {'encode'|'decode'} kind @returns {Promise<Object>} the module */
export function loadQr(kind) {
  if (!loaded[kind]) {
    loaded[kind] = load(kind).catch(e => {
      delete loaded[kind]; // try again next time (offline, say)
      throw e;
    });
  }
  return loaded[kind];
}

async function load(kind) {
  const embedded = document.getElementById('runway-qr-' + kind);
  if (embedded) {
    // build/qr.js wrote every "</script" (in any case) as "<\/script"; the case is kept both ways
    const code = embedded.textContent.replace(/<\\(\/script)/gi, '<$1');
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      return await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (import.meta.env.DEV) {
    return import(/* @vite-ignore */ `/src/ui/qr/${kind}.js`);
  }
  if (location.protocol === 'file:') {
    // dist/index.html opened from a disk: the browser loads no module from next to it (only a served page can)
    throw new Error(servedOnly());
  }
  return import(/* @vite-ignore */ new URL(`qr-${kind}.js`, document.baseURI).href);
}

/**
 * What to do when a part loaded on demand cannot be had because the served page (dist/index.html) was opened from a
 * disk. Used for the QR modules here and for the texts to translate in views/language.js.
 * @returns {string} the message, translated
 */
export const servedOnly = () =>
  $t('This copy of the page only works from a website. Open runway-money-planner.html, which has everything inside.');
