/**
 * @file Unit tests for the Android app's build: the settings (apk.config.json) and their checks, the version code, the
 * icon's geometry, the splash drawn by the page and the Capacitor settings. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capacitorConfig } from '../../build/android.js';
import { APK_DEFAULTS, apkProblems, loadApkConfig, versionCodeOf } from '../../build/apkConfig.js';
import { GRID, apkIconSvg, logoLine } from '../../build/apkIcon.js';
import { apkSplash, splashMarkup, splashPreview, splashScript } from '../../build/apkSplash.js';

/** A project folder with this apk.config.json (or none) and a package.json of version 2.3.4. */
function project(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-apk-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '2.3.4' }));
  if (config) {
    fs.writeFileSync(path.join(dir, 'apk.config.json'), JSON.stringify(config));
  }
  return dir;
}
const clone = o => JSON.parse(JSON.stringify(o));

test('the defaults pass their own checks', () => {
  assert.deepEqual(apkProblems(clone(APK_DEFAULTS)), []);
});

test('the project apk.config.json is valid', () => {
  assert.doesNotThrow(() => loadApkConfig(process.cwd()));
});

test('without a file: the defaults, versions from package.json', () => {
  const c = loadApkConfig(project(null));
  assert.equal(c.name, 'Runway');
  assert.equal(c.version, '2.3.4');
  assert.equal(c.versionCode, 20304);
  assert.ok(path.isAbsolute(c.signing.folder) && !c.signing.folder.includes('~'), 'the home folder is expanded');
});

test('the file overrides object by object, and $comment keys are ignored', () => {
  const c = loadApkConfig(
    project({ $comment: 'x', name: 'Mine', splash: { align: 'left', background: { dark: '#000000' } } }),
  );
  assert.equal(c.name, 'Mine');
  assert.equal(c.splash.align, 'left');
  assert.equal(c.splash.background.dark, '#000000');
  assert.equal(c.splash.background.light, APK_DEFAULTS.splash.background.light, 'the other theme keeps its default');
  assert.equal(c.splash.loader, APK_DEFAULTS.splash.loader);
  assert.equal(c.$comment, undefined);
});

test('mistakes are all listed, each saying what to fix', () => {
  const bad = { appId: 'Runway', splash: { align: 'middle', textColor: { light: 'blue' }, fade: -1 }, version: '1.2' };
  assert.throws(
    () => loadApkConfig(project(bad)),
    error =>
      /appId must look like/.test(error.message) &&
      /splash\.align must be one of left, center, right/.test(error.message) &&
      /splash\.textColor\.light must be a colour/.test(error.message) &&
      /splash\.fade must be a number/.test(error.message) &&
      /version must be/.test(error.message),
  );
});

test('a missing icon picture stops the build', () => {
  assert.throws(() => loadApkConfig(project({ icon: { image: 'nope.png' } })), /does not exist/);
});

test('version codes grow with the version', () => {
  assert.equal(versionCodeOf('1.0.0'), 10000);
  assert.equal(versionCodeOf('6.0.0'), 60000);
  assert.ok(versionCodeOf('6.1.0') > versionCodeOf('6.0.99'));
  assert.ok(versionCodeOf('7.0.0') > versionCodeOf('6.99.99'));
});

test("the icon's line stays inside the circle every phone shows (66 of 108 units)", () => {
  const numbers = logoLine()
    .d.match(/[\d.]+/g)
    .map(Number);
  for (let i = 0; i < numbers.length; i += 2) {
    const r = Math.hypot(numbers[i] - GRID / 2, numbers[i + 1] - GRID / 2) + logoLine().width / 2;
    assert.ok(r <= 33, `point ${numbers[i]},${numbers[i + 1]} is ${r.toFixed(1)} from the centre`);
  }
  assert.match(apkIconSvg(APK_DEFAULTS.icon, { mono: '#123456' }), /stroke="#123456"/);
});

test('the splash: name, tagline, alignment and loader as set; text is escaped', () => {
  const c = clone(APK_DEFAULTS);
  c.splash = { ...c.splash, name: 'A <b>', tagline: 'T & co', align: 'right', loader: 'dots' };
  const html = splashMarkup(c);
  assert.match(html, /data-align="right"/);
  assert.match(html, /A &lt;b&gt;/);
  assert.match(html, /T &amp; co/);
  assert.equal((html.match(/<i><\/i>/g) || []).length, 3, 'three dots');
  c.splash = { ...c.splash, loader: 'none', showIcon: false, tagline: '' };
  const plain = splashMarkup(c);
  assert.doesNotMatch(plain, /apk-load|apk-icon|apk-tag/);
});

test('the splash script waits for the app, its shortest time and its fade', () => {
  const c = clone(APK_DEFAULTS);
  c.splash.minDuration = 1234;
  c.splash.fade = 321;
  const js = splashScript(c);
  assert.match(js, /MIN=1234/);
  assert.match(js, /FADE=321/);
  assert.match(js, /nativePromise\('SplashScreen','hide'/);
  assert.doesNotThrow(() => new Function(js), 'it parses');
});

test('the Android page: marked data-apk, the splash first in the body', () => {
  const plugin = apkSplash(clone(APK_DEFAULTS));
  const html = plugin.transformIndexHtml.handler(
    '<!doctype html><html lang="en"><head></head><body class="x">\n<div id="app"></div></body></html>',
  );
  assert.match(html, /<html data-apk lang="en">/);
  assert.match(html, /<body class="x">\n<div id="apk-splash"/);
  assert.match(html, /<style id="apk-splash-css">/);
});

test('the preview shows both themes', () => {
  const html = splashPreview(loadApkConfig(project(null)));
  assert.match(html, /apk-splash apk-light/);
  assert.match(html, /apk-splash apk-dark/);
});

test('Capacitor: the splash waits for the page, insets as CSS, light icons on the app bar by default', () => {
  const cap = capacitorConfig({ ...clone(APK_DEFAULTS), version: '1.0.0' }, 'dist-apk');
  assert.equal(cap.webDir, 'dist-apk');
  assert.equal(cap.plugins.SplashScreen.launchAutoHide, false);
  assert.equal(cap.plugins.SystemBars.insetsHandling, 'css');
  assert.equal(cap.plugins.SystemBars.style, 'DARK');
  assert.equal(
    capacitorConfig({ ...clone(APK_DEFAULTS), systemBars: 'dark-icons' }, 'x').plugins.SystemBars.style,
    'LIGHT',
  );
});
