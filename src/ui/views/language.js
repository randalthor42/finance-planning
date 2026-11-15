/**
 * @file Language settings: installed languages, export of all texts for translators, import of a translation.
 */
import { $t, I18N } from '../../core/i18n.js';
import { has } from '../../core/util.js';
import { IO } from '../../services/backup.js';
import { App } from '../app.js';
import { btn, ibtn } from '../components/button.js';
import { card, chip } from '../components/layout.js';
import { confirmModal } from '../components/modal.js';
import { POP, closePop, popover } from '../components/popover.js';
import { toast } from '../components/toast.js';
import { h, sv } from '../dom.js';

/* --- languages: flags, picker, and the Language section of Settings --- */
/*i18n:off*/
const FLAGS = {
  es: 'h:#c60b1e,#ffc400*2,#c60b1e',
  ro: 'v:#002b7f,#fcd116,#ce1126',
  de: 'h:#111,#dd0000,#ffce00',
  fr: 'v:#0055a4,#fff,#ef4135',
  it: 'v:#009246,#fff,#ce2b37',
  pl: 'h:#fff,#dc143c',
  ru: 'h:#fff,#0039a6,#d52b1e',
  rs: 'h:#c6363c,#0c4076,#fff',
  nl: 'h:#ae1c28,#fff,#21468b',
  hu: 'h:#ce2939,#fff,#477050',
  bg: 'h:#fff,#00966e,#d62612',
  ua: 'h:#0057b7,#ffd700',
  at: 'h:#ed2939,#fff,#ed2939',
  be: 'v:#111,#fdda24,#ef3340',
  ie: 'v:#169b62,#fff,#ff883e',
  pt: 'v:#046a38*2,#da291c*3',
  lt: 'h:#fdb913,#006a44,#c1272d',
  ee: 'h:#0072ce,#111,#fff',
  md: 'v:#0046ae,#ffd200,#cc092f',
};
/** A small flag for a two-letter country code, drawn here (no images, no network). Unknown codes get a neutral badge with the letters. */
function flag(code) {
  const W = 21;
  const H = 15;
  const svg = sv('svg', { class: 'flag', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  const fallback = FLAGS[code];
  const R = (x, y, w, hh, f) => sv('rect', { x, y, width: w, height: hh, fill: f });
  if (fallback) {
    const [dir, list] = fallback.split(':');
    const parts = list.split(',').map(p => p.split('*'));
    const tot = parts.reduce((s, p) => s + (+p[1] || 1), 0);
    let at = 0;
    for (const [c, wt] of parts) {
      const f = (+wt || 1) / tot;
      svg.append(dir === 'h' ? R(0, at * H, W, f * H + 0.2, c) : R(at * W, 0, f * W + 0.2, H, c));
      at += f;
    }
  } else if (code === 'gb') {
    svg.append(
      R(0, 0, W, H, '#012169'),
      sv('path', { d: `M0 0L${W} ${H}M${W} 0L0 ${H}`, stroke: '#fff', 'stroke-width': 3 }),
      sv('path', { d: `M${W / 2} 0V${H}M0 ${H / 2}H${W}`, stroke: '#fff', 'stroke-width': 5 }),
      sv('path', { d: `M${W / 2} 0V${H}M0 ${H / 2}H${W}`, stroke: '#c8102e', 'stroke-width': 3 }),
    );
  } else if (code === 'us') {
    svg.append(R(0, 0, W, H, '#fff'));
    for (let i = 0; i < 7; i++) {
      svg.append(R(0, (i * H) / 6.5, W, H / 13, '#b22234'));
    }
    svg.append(R(0, 0, W * 0.42, H * 0.54, '#3c3b6e'));
  } else if (code === 'jp') {
    svg.append(R(0, 0, W, H, '#fff'), sv('circle', { cx: W / 2, cy: H / 2, r: 4.4, fill: '#bc002d' }));
  } else if (code === 'cn') {
    svg.append(
      R(0, 0, W, H, '#de2910'),
      sv('path', { d: 'M4.2 2l.8 2.4h2.5L5.5 5.9l.8 2.4-2.1-1.5-2 1.5.7-2.4L.9 4.4h2.5z', fill: '#ffde00' }),
    );
  } else if (code === 'kr') {
    svg.append(
      R(0, 0, W, H, '#fff'),
      sv('path', { d: `M${W / 2 - 4} ${H / 2}a4 4 0 018 0z`, fill: '#cd2e3a' }),
      sv('path', { d: `M${W / 2 - 4} ${H / 2}a4 4 0 008 0z`, fill: '#0047a0' }),
    );
  } else {
    svg.append(
      R(0, 0, W, H, 'var(--surface-3)'),
      sv(
        'text',
        { x: W / 2, y: 11, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: 'var(--muted)' },
        (code || '??').toUpperCase(),
      ),
    );
  }
  return svg;
}
/*i18n:on*/
const langList = () => [{ code: 'en', name: 'English', flag: 'gb' }, ...Object.values(I18N.packs)];
/** Shown in the menu only when more than one language is installed. */
export function langPicker() {
  const all = langList();
  if (all.length < 2) {
    return null;
  }
  const current = all.find(l => l.code === I18N.lang) || all[0];
  const b = h(
    'button',
    { type: 'button', class: 'langbtn', 'aria-label': $t('Language'), title: $t('Language'), 'aria-haspopup': 'menu' },
    flag(current.flag),
    h('span', { text: current.code.toUpperCase() }),
  );
  b.addEventListener('click', () =>
    POP && POP.anchor === b
      ? closePop()
      : popover(b, $t('Language'), pop => {
          pop.classList.add('menu');
          pop.append(
            ...all.map(l =>
              h(
                'button',
                {
                  type: 'button',
                  role: 'menuitem',
                  class: l.code === I18N.lang ? 'on' : '',
                  onclick: () => I18N.setLang(l.code),
                },
                flag(l.flag),
                ' ',
                l.name,
              ),
            ),
          );
        }),
  );
  return b;
}
function importLanguage() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', () => {
    const f = input.files[0];
    if (!f) {
      return;
    }
    if (f.size > 3e6) {
      return toast($t('That file is too large to be a language file'), { kind: 'bad' });
    }
    f.text().then(txt => {
      const r = I18N.importPack(txt);
      if (typeof r === 'string') {
        return toast(
          r === 'is-english'
            ? $t('English is built in. Change "code" in the file to your language, for example es.')
            : r === 'storage'
              ? $t('This browser could not save the language.')
              : $t('That is not a language file made by this planner.'),
          { kind: 'bad' },
        );
      }
      toast($t('Language “{0}” added', r.name));
      App.render();
    });
  });
  input.click();
}
export function languageCard() {
  const all = langList();
  const total = I18N.KEYS.length;
  return [
    card(
      $t('Language'),
      $t('The planner is written in English. Other languages are files you can make yourself and add here.'),
      null,
      // one card per language, two to a row
      h(
        'div',
        { class: 'lang-grid' },
        all.map(l => {
          const done =
            l.code === 'en'
              ? total
              : I18N.KEYS.filter(k => has(l.strings, k) && l.strings[k] && l.strings[k] !== k).length;
          const used = l.code === I18N.lang;
          return h(
            'div',
            { class: 'lang-card' + (used ? ' on' : '') },
            h(
              'div',
              { class: 'lang-h' },
              flag(l.flag),
              h('b', { text: l.name }),
              used ? chip($t('in use'), 'acc') : null,
            ),
            h('div', {
              class: 'small muted',
              text: l.code === 'en' ? $t('Built in') : $t('{0} · {1} of {2} texts translated', l.code, done, total),
            }),
            h(
              'div',
              { class: 'acts' },
              l.code !== I18N.lang ? btn($t('Use'), () => I18N.setLang(l.code), 'sm') : null,
              btn(
                $t('Export'),
                () => IO.download(`runway-language-${l.code}.json`, I18N.exportPack(l.code)),
                'sm ghost',
                'download',
              ),
              l.code !== 'en'
                ? ibtn(
                    $t('Remove language'),
                    () =>
                      confirmModal(
                        $t('Remove “{0}”?', l.name),
                        $t(
                          'The translation is deleted from this browser. Export it first if you want to keep the file.',
                        ),
                        $t('Remove'),
                        () => {
                          I18N.remove(l.code);
                          App.render();
                        },
                      ),
                    'sm ghost danger',
                    'trash',
                  )
                : null,
            ),
          );
        }),
      ),
      h(
        'div',
        { class: 'acts', style: 'margin-top:12px' },
        btn($t('Import a language file'), importLanguage, 'primary', 'upload'),
      ),
    ),
    card(
      $t('Making a translation'),
      null,
      null,
      h(
        'ol',
        { class: 'steps' },
        h('li', { text: $t('Export English (or any language you want to improve).') }),
        h('li', {
          text: $t(
            'Open the file in a text editor. At the top, set "code" (es, ro, sr…), "name" and "flag" (a two-letter country code).',
          ),
        }),
        h('li', {
          text: $t(
            'Translate the text to the right of each colon. Leave the left side and the markers {0}, {1} as they are.',
          ),
        }),
        h('li', {
          text: $t('Import the file here and press Use. Anything you have not translated yet stays in English.'),
        }),
      ),
      h('p', {
        class: 'small muted',
        style: 'margin-top:8px',
        text: $t(
          'Month names, weekdays and number formats come from the browser and follow the language automatically. Your own data (names, notes) is never translated.',
        ),
      }),
    ),
  ];
}
