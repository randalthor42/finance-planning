/**
 * @file The splash screen of the Android app that the page draws itself (apk.config.json › splash), and its preview.
 *
 * Android (12 and later) draws the first splash: the icon centred on a colour, nothing else, no text. The page then
 * puts its own splash over the app with the same colour and the icon in the same place, so the two read as one: on
 * this second one go the app's name (left, centre or right), the tagline, their colours and the loading animation.
 * Once the app has drawn its first page it fades out. In order:
 * 1. Android's splash stays until the page has drawn its own (the script below asks the SplashScreen plugin to hide
 *    it at the page's second frame), so there is no blank moment between them;
 * 2. the page's splash stays at least splash.minDuration, then fades in splash.fade milliseconds;
 * 3. if the app never draws (an error), it fades after 8 seconds anyway: the person sees the error, not a splash.
 *
 * Only the Android build has it (vite.config.js, mode "apk"); the page served on the web and the file to hand out
 * are unchanged. splashPreview() writes the page that shows it in both themes without a phone.
 */
import fs from 'node:fs';
import { apkIconSvg } from './apkIcon.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The icon on the splash: the size Android's splash draws it (the disc is 160 px of a 240 px icon) when centred, a
 * smaller one beside the edge. A PNG of the person's own (icon.image) is drawn in a disc of the icon's background.
 */
function iconMarkup(c, px) {
  if (!c.icon.image) {
    return apkIconSvg(c.icon, { shape: 'disc', px });
  }
  const png = fs.readFileSync(c.icon.image).toString('base64');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="${px}" height="${px}" aria-hidden="true">` +
    `<circle cx="54" cy="54" r="36" fill="${c.icon.background}"/>` +
    `<image href="data:image/png;base64,${png}" x="0" y="0" width="108" height="108"/></svg>`
  );
}

/** The loading animation's markup (CSS below draws it). */
function loaderMarkup(kind) {
  if (kind === 'none' || kind === 'pulse') {
    return ''; // 'pulse' animates the icon itself
  }
  const dots = kind === 'dots' ? '<i></i><i></i><i></i>' : '<i></i>';
  return `<div class="apk-load apk-load-${kind}" role="progressbar" aria-label="Loading">${dots}</div>`;
}

/** The colours as CSS variables: light, and dark when the phone is in dark mode (or forced by the preview). */
function colorVars(s, theme) {
  return (
    `--apk-bg:${s.background[theme]};--apk-ink:${s.textColor[theme]};` +
    `--apk-sub:${s.taglineColor[theme]};--apk-load:${s.loaderColor[theme]}`
  );
}

/**
 * The splash's style. Centred, the icon sits exactly where Android's splash drew it (the middle of the screen) and the
 * text goes under it; on the left or right, a smaller icon and the text stand by that edge, centred in height.
 * @param {object} c the configuration (build/apkConfig.js)
 * @returns {string} CSS
 */
export function splashCss(c) {
  const s = c.splash;
  return `
.apk-splash{${colorVars(s, 'light')};position:fixed;inset:0;z-index:2147483647;background:var(--apk-bg);color:var(--apk-ink);
  font:16px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;overflow:hidden;
  transition:opacity ${s.fade}ms ease;-webkit-user-select:none;user-select:none}
@media (prefers-color-scheme:dark){.apk-splash:not(.apk-light){${colorVars(s, 'dark')}}}
.apk-splash.apk-dark{${colorVars(s, 'dark')}}
.apk-splash.apk-out{opacity:0;pointer-events:none}
.apk-in{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;width:100%;padding:0 max(32px,env(safe-area-inset-left)) 0 max(32px,env(safe-area-inset-right))}
.apk-splash[data-align=left] .apk-in{align-items:flex-start;text-align:left}
.apk-splash[data-align=right] .apk-in{align-items:flex-end;text-align:right}
.apk-splash[data-align=center] .apk-in{align-items:center;text-align:center;position:absolute;left:0;top:calc(50% - 120px)}
.apk-splash[data-align=center] .apk-icon{width:240px;height:240px;margin:0 0 -40px}
.apk-splash[data-align=center][data-icon=no] .apk-in{top:auto;position:static}
.apk-icon{display:block;width:96px;height:96px;margin:-16px}
.apk-icon svg{display:block;width:100%;height:100%}
.apk-name{font-size:1.7rem;font-weight:700;letter-spacing:-.01em}
.apk-tag{color:var(--apk-sub);font-size:.95rem;margin-top:2px}
.apk-load{color:var(--apk-load);margin-top:10px}
.apk-load-bar{position:relative;width:132px;height:3px;border-radius:3px;overflow:hidden;background:color-mix(in srgb,currentColor 18%,transparent)}
.apk-load-bar i{position:absolute;inset:0 auto 0 0;width:40%;border-radius:3px;background:currentColor;animation:apk-bar 1.1s ease-in-out infinite}
.apk-load-spinner i{display:block;width:26px;height:26px;border-radius:50%;border:3px solid color-mix(in srgb,currentColor 20%,transparent);border-top-color:currentColor;animation:apk-spin .8s linear infinite}
.apk-load-dots{display:flex;gap:7px}
.apk-load-dots i{width:8px;height:8px;border-radius:50%;background:currentColor;animation:apk-dot 1s ease-in-out infinite}
.apk-load-dots i:nth-child(2){animation-delay:.15s}.apk-load-dots i:nth-child(3){animation-delay:.3s}
.apk-splash[data-loader=pulse] .apk-icon{animation:apk-pulse 1.4s ease-in-out infinite}
@keyframes apk-bar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@keyframes apk-spin{to{transform:rotate(1turn)}}
@keyframes apk-dot{0%,80%,100%{opacity:.25;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
@keyframes apk-pulse{0%,100%{transform:scale(1)}50%{transform:scale(.94)}}
@media (prefers-reduced-motion:reduce){.apk-load i,.apk-splash .apk-icon{animation-duration:3s!important}}
`;
}

/**
 * The splash's markup.
 * @param {object} c the configuration
 * @param {string} [extraClass] 'apk-light' or 'apk-dark' to force a theme (the preview)
 * @returns {string} HTML
 */
export function splashMarkup(c, extraClass = '') {
  const s = c.splash;
  const centred = s.align === 'center';
  const icon = s.showIcon ? `<div class="apk-icon">${iconMarkup(c, centred ? 240 : 96)}</div>` : '';
  const name = s.name ? `<div class="apk-name">${esc(s.name)}</div>` : '';
  const tag = s.tagline ? `<div class="apk-tag">${esc(s.tagline)}</div>` : '';
  const text = name || tag ? `<div class="apk-text">${name}${tag}</div>` : '';
  return (
    `<div id="apk-splash" class="apk-splash ${extraClass}" data-align="${s.align}" data-loader="${s.loader}" ` +
    `data-icon="${s.showIcon ? 'yes' : 'no'}" aria-hidden="true"><div class="apk-in">${icon}${text}${loaderMarkup(s.loader)}</div></div>`
  );
}

/**
 * The script that hides Android's splash once this one is drawn, and fades this one out when the app has drawn its
 * first page (or its lock screen). Plain script, run as the page is read: it waits for nothing of the app's code.
 * @param {object} c the configuration
 * @returns {string} JavaScript
 */
export function splashScript(c) {
  const { minDuration, fade } = c.splash;
  return `(function(){
var el=document.getElementById('apk-splash');if(!el)return;
var start=Date.now(),MIN=${minDuration},FADE=${fade},LONGEST=8000;
requestAnimationFrame(function(){requestAnimationFrame(function(){
  var C=window.Capacitor;if(C&&C.nativePromise){C.nativePromise('SplashScreen','hide',{fadeOutDuration:0}).catch(function(){});}
});});
function drawn(){var m=document.getElementById('main');return (m&&m.childElementCount>0)||document.querySelector('dialog.lockscreen[open]');}
function out(){el.classList.add('apk-out');setTimeout(function(){el.remove();},FADE+60);}
(function wait(){
  var t=Date.now()-start;
  if(drawn()){setTimeout(out,Math.max(0,MIN-t));}
  else if(t>LONGEST){out();}
  else{requestAnimationFrame(wait);}
})();
})();`;
}

/**
 * The Vite plugin of the Android build: the splash first in the page's body, and the page marked data-apk (ui/pwa.js:
 * no service worker or manifest inside the app, which has its files on the phone).
 * @param {object} c the configuration
 * @returns {object} a Vite plugin
 */
export function apkSplash(c) {
  return {
    name: 'runway-apk-splash',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: html =>
        html
          .replace(/<html\b/i, '<html data-apk')
          .replace(/<\/head>/i, () => `<style id="apk-splash-css">${splashCss(c)}</style>\n</head>`)
          .replace(
            /<body([^>]*)>/i,
            (m, attrs) => `<body${attrs}>\n${splashMarkup(c)}\n<script>${splashScript(c)}</script>`,
          ),
    },
  };
}

/**
 * A page that shows the splash and the icon in the light and dark themes, at a phone's size, with a button that plays
 * the fade into the app: to check apk.config.json without building or installing (npm run apk:preview).
 * @param {object} c the configuration
 * @returns {string} HTML
 */
export function splashPreview(c) {
  const shapes = [
    ['Circle', '50%'],
    ['Squircle', '32%'],
    ['Rounded', '18%'],
  ];
  const icons = shapes
    .map(
      ([label, radius]) =>
        `<figure><div class="ic" style="border-radius:${radius}">${apkIconSvg(c.icon, { shape: 'square', px: 72 })}</div><figcaption>${label}</figcaption></figure>`,
    )
    .join('');
  const themed = c.icon.monochrome
    ? `<figure><div class="ic" style="border-radius:50%;background:#d8e2ff">${apkIconSvg(c.icon, { shape: 'none', px: 72, mono: '#1f3a8a' })}</div><figcaption>Themed (Android 13+)</figcaption></figure>`
    : '';
  const phone = theme =>
    `<div class="phone-wrap"><div class="phone" data-theme="${theme}"><div class="app"><div class="bar"></div>` +
    '<div class="row"></div><div class="row short"></div><div class="tiles"><i></i><i></i><i></i><i></i></div></div>' +
    `${splashMarkup(c, theme === 'dark' ? 'apk-dark' : 'apk-light').replace('id="apk-splash" ', '')}</div>` +
    `<p>${theme === 'dark' ? 'Dark mode' : 'Light mode'}</p></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(c.name)} · splash preview</title>
<style>
${splashCss(c)}
body{margin:0;padding:24px 16px;font:15px/1.4 system-ui,sans-serif;background:#e9ecf1;color:#1b2230}
h1{font-size:1.2rem;margin:0 0 4px}p.lead{margin:0 0 18px;color:#556070}
.phones{display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}
.phone-wrap p{text-align:center;margin:8px 0 0;color:#556070}
.phone{position:relative;width:300px;height:620px;border-radius:34px;overflow:hidden;border:9px solid #12161d;box-shadow:0 10px 30px rgba(0,0,0,.18);transform:translateZ(0)}
.phone .apk-splash{position:absolute;font-size:13.3px}
.phone .apk-splash[data-align=center] .apk-icon{width:200px;height:200px;margin-bottom:-34px}
.phone .apk-splash[data-align=center] .apk-in{top:calc(50% - 100px)}
.app{position:absolute;inset:0;padding:14px;background:${c.splash.background.light}}
.phone[data-theme=dark] .app{background:${c.splash.background.dark}}
.app .bar{height:40px;border-radius:10px;background:${c.icon.background};margin-bottom:14px}
.app .row{height:14px;border-radius:7px;background:rgba(128,128,128,.28);margin:10px 0}.app .row.short{width:60%}
.app .tiles{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.app .tiles i{height:70px;border-radius:12px;background:rgba(128,128,128,.18)}
button{font:inherit;padding:8px 16px;border-radius:8px;border:0;background:#2457d6;color:#fff;cursor:pointer;margin:0 0 18px}
.icons{display:flex;flex-wrap:wrap;gap:22px;margin:26px 0 0}
figure{margin:0;text-align:center}figcaption{font-size:.85rem;color:#556070;margin-top:6px}
.ic{position:relative;width:72px;height:72px;overflow:hidden}
.ic svg{position:absolute;left:50%;top:50%;width:108px;height:108px;transform:translate(-50%,-50%)}
</style></head><body>
<h1>${esc(c.name)} · splash and icon</h1>
<p class="lead">From apk.config.json, version ${esc(c.version)}. Android first shows only the icon on the background colour; the name, tagline and loader appear as the app's own splash takes over, then it fades into the app.</p>
<button type="button" id="play">Play the fade into the app</button>
<div class="phones">${phone('light')}${phone('dark')}</div>
<h1 style="margin-top:28px">Icon on different phones</h1>
<div class="icons">${icons}${themed}</div>
<script>
document.getElementById('play').onclick=function(){
  document.querySelectorAll('.phone .apk-splash').forEach(function(el){
    el.classList.remove('apk-out');
    setTimeout(function(){el.classList.add('apk-out');},${c.splash.minDuration});
    setTimeout(function(){el.classList.remove('apk-out');},${c.splash.minDuration + c.splash.fade + 1600});
  });
};
</script></body></html>`;
}
