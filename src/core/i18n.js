/**
 * @file Translations. The English sentence is the key: $t('text {0}', a). Packs live in their own localStorage key,
 * read and written through the data access module (services/storage.js): the one import of this layer from a higher
 * one, because the language has to be known before any text is made.
 */
import { readJSON, writeJSON } from '../services/storage.js';
import { has, isObj } from './util.js';

export const I18N = {
  KEY: 'runway.i18n',
  lang: 'en',
  packs: {},
  dict: null,
  pr: null,
  po: null,
  /**
   * Every text of the app and every word given to plural(), for "Export language": collected when building
   * (vite.config.js). They are not in the page's code: the served page loads them on demand (i18n-texts.json next to
   * it), the file to hand out has them inside as JSON. source() gets them (main.js sets it); loadTexts() once, when
   * Settings › Language or an export needs them. Until then KEYS and WORDS are empty.
   */
  source: async () => null,
  all: null,
  loading: null,
  get KEYS() {
    return this.all ? this.all.keys : [];
  },
  get WORDS() {
    return this.all ? this.all.words : [];
  },
  /** Loads the texts (once; again after a failure). Resolves to { keys, words }, empty when they cannot be had. */
  loadTexts() {
    if (!this.loading) {
      this.loading = Promise.resolve()
        .then(() => this.source())
        .then(
          read => read,
          () => null,
        )
        .then(read => {
          const keys = (read && Array.isArray(read.keys) && read.keys) || [];
          const words = (read && Array.isArray(read.words) && read.words) || [];
          if (keys.length) {
            this.all = { keys, words };
          } else {
            this.loading = null; // try again next time (offline, say)
          }
          return { keys, words };
        });
    }
    return this.loading;
  },
  /** Forgets the texts loaded (tests). */
  reset() {
    this.all = null;
    this.loading = null;
  },
  ORD: { one: 'st', two: 'nd', few: 'rd', other: 'th' },
  IRREG: { person: 'people', entry: 'entries', wish: 'wishes', try: 'tries' },
  init() {
    try {
      const raw = readJSON(this.KEY);
      if (isObj(raw)) {
        for (const c of Object.keys(isObj(raw.packs) ? raw.packs : {}).slice(0, 40)) {
          const q = this.clean(raw.packs[c]);
          if (q) {
            this.packs[q.code] = q;
          }
        }
        if (typeof raw.lang === 'string' && this.packs[raw.lang]) {
          this.lang = raw.lang;
        }
      }
    } catch (e) {}
    this.dict = this.lang === 'en' ? null : this.packs[this.lang].strings;
    const mk = (l, o) => {
      try {
        return new Intl.PluralRules(l, o);
      } catch (e) {
        return new Intl.PluralRules('en', o);
      }
    };
    this.pr = mk(this.lang);
    this.po = mk(this.lang, { type: 'ordinal' });
  },
  /** Validates a language file. Returns a clean pack or null. Text is only ever shown as text, never run. */
  clean(p) {
    if (
      !isObj(p) ||
      typeof p.code !== 'string' ||
      !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(p.code) ||
      p.code === 'en' ||
      !isObj(p.strings)
    ) {
      return null;
    }
    try {
      Intl.DateTimeFormat.supportedLocalesOf(p.code);
    } catch (e) {
      return null;
    }
    const strings = {};
    let n = 0;
    for (const k of Object.keys(p.strings)) {
      const v = p.strings[k];
      if (n >= 8000) {
        break;
      }
      if (typeof v === 'string' && k.length <= 1200 && v.length <= 1500) {
        strings[k] = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
        n++;
      }
    }
    return {
      code: p.code,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 40) : p.code,
      flag: typeof p.flag === 'string' && /^[a-z]{2}$/.test(p.flag) ? p.flag : '',
      strings,
    };
  },
  save() {
    return writeJSON(this.KEY, { lang: this.lang, packs: this.packs });
  },
  get(key) {
    const d = this.dict;
    return d && has(d, key) && d[key] !== '' ? d[key] : null;
  },
  /** The file a translator works on: every text of the app, with the current translation (or English) as the value. */
  exportPack(code) {
    const p = this.packs[code];
    const src = p ? p.strings : {};
    const strings = {};
    for (const k of this.KEYS) {
      strings[k] = has(src, k) && src[k] ? src[k] : k;
    }
    for (const w of this.WORDS) {
      strings[`#${w}:one`] = src[`#${w}:one`] || w;
      strings[`#${w}:other`] = src[`#${w}:other`] || this.IRREG[w] || w + 's';
      for (const c of ['zero', 'two', 'few', 'many']) {
        if (src[`#${w}:${c}`]) {
          strings[`#${w}:${c}`] = src[`#${w}:${c}`];
        }
      }
    }
    for (const c of Object.keys(this.ORD)) {
      strings['#ordinal:' + c] = has(src, '#ordinal:' + c) ? src['#ordinal:' + c] : this.ORD[c];
    }
    return JSON.stringify(
      {
        app: 'runway',
        kind: 'language',
        code: p ? p.code : 'en',
        name: p ? p.name : 'English',
        flag: p ? p.flag : 'gb',
        howto: [
          'Change "code" (es, ro, sr, zh, ja…), "name" and "flag" (a two-letter country code).',
          'Translate only the text to the RIGHT of each colon. Never change the text on the left.',
          'Keep {0}, {1}… exactly as they are: they are replaced by amounts, names and dates. You may move them.',
          'Lines starting with # are counted words: "#month:one" is used for 1, "#month:other" for the rest. Add "#month:few" or "#month:many" if your language needs them.',
          '"#ordinal:…" are the endings of 1st, 2nd, 3rd, 4th. Use an empty text if your language has none.',
          'Import the file in Settings, Language.',
        ],
        strings,
      },
      null,
      1,
    );
  },
  importPack(text) {
    let f;
    try {
      f = JSON.parse(text);
    } catch (e) {
      return 'not-json';
    }
    if (!isObj(f) || f.app !== 'runway' || f.kind !== 'language') {
      return 'not-language';
    }
    if (f.code === 'en') {
      return 'is-english';
    }
    const q = this.clean(f);
    if (!q) {
      return 'bad';
    }
    this.packs[q.code] = q;
    return this.save() ? q : 'storage';
  },
  setLang(code) {
    if (code !== 'en' && !this.packs[code]) {
      return;
    }
    this.lang = code;
    this.save();
    location.reload();
  },
  remove(code) {
    delete this.packs[code];
    if (this.lang === code) {
      this.lang = 'en';
      this.save();
      location.reload();
    } else {
      this.save();
    }
  },
};
export function $t(key, ...a) {
  const s = I18N.get(key) || key;
  return a.length ? s.replace(/\{(\d+)\}/g, (m, i) => (+i < a.length ? String(a[i]) : m)) : s;
}
/** "3 months": the number and the right form of the word for the current language. */
export function plural(n, w) {
  const s =
    I18N.get(`#${w}:${I18N.pr.select(n)}`) || I18N.get(`#${w}:other`) || (n === 1 ? w : I18N.IRREG[w] || w + 's');
  return `${n} ${s}`;
}
/** "28th": the number with its ordinal ending for the current language (may be empty). */
export function ordinal(n) {
  const c = I18N.po.select(n);
  const d = I18N.dict;
  const k = '#ordinal:' + c;
  return n + (d && has(d, k) ? d[k] : I18N.dict ? '' : I18N.ORD[c] || 'th');
}
I18N.init();
/*i18n:on*/
