/**
 * @file The settings of the Android app (apk.config.json): read, filled with the defaults below and checked, so that a
 * mistake stops the build with a sentence that says what to fix instead of an Android build error. Used by
 * build/apkSplash.js (the splash drawn by the page), build/android.js (the Android project) and scripts/build-apk.mjs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The file, at the root of the project. */
export const APK_CONFIG = 'apk.config.json';

/** Every setting and its default (docs/android.md explains them). */
export const APK_DEFAULTS = {
  name: 'Runway',
  appId: 'com.runway.planner',
  version: 'auto',
  versionCode: 'auto',
  orientation: 'any',
  icon: { image: null, background: '#2457d6', foreground: '#ffffff', monochrome: true },
  splash: {
    name: 'Runway',
    tagline: '',
    align: 'center',
    showIcon: true,
    background: { light: '#f5f6f8', dark: '#0f141a' },
    textColor: { light: '#10151c', dark: '#e8edf3' },
    taglineColor: { light: '#5b6573', dark: '#94a0ae' },
    loader: 'bar',
    loaderColor: { light: '#2457d6', dark: '#7aa2ff' },
    minDuration: 700,
    fade: 350,
  },
  systemBars: 'auto',
  features: { camera: true },
  security: { allowBackup: false },
  signing: { folder: '~/.runway-android/signing' },
};

/** The choices of the settings that take one of a list. */
export const APK_CHOICES = {
  orientation: ['any', 'portrait', 'landscape'],
  align: ['left', 'center', 'right'],
  loader: ['none', 'bar', 'spinner', 'dots', 'pulse'],
  systemBars: ['auto', 'light-icons', 'dark-icons'],
};

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const COLOR = /^#[0-9a-f]{6}$/i;

/** The defaults with the file's values over them, object by object ("$comment" keys are dropped). */
function merge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    if (key.startsWith('$')) {
      continue;
    }
    out[key] = isObject(base[key]) && isObject(value) ? merge(base[key], value) : value;
  }
  return out;
}

/**
 * The problems of a configuration, as sentences (none: it can be built).
 * @param {object} c a configuration filled with the defaults
 * @returns {string[]}
 */
export function apkProblems(c) {
  const problems = [];
  const color = (value, where) => {
    if (typeof value !== 'string' || !COLOR.test(value)) {
      problems.push(`${where} must be a colour like "#2457d6" (it is ${JSON.stringify(value)})`);
    }
  };
  const pair = (value, where) => {
    if (!isObject(value)) {
      problems.push(`${where} must be { "light": "#…", "dark": "#…" }`);
      return;
    }
    color(value.light, where + '.light');
    color(value.dark, where + '.dark');
  };
  const choice = (value, list, where) => {
    if (!list.includes(value)) {
      problems.push(`${where} must be one of ${list.join(', ')} (it is ${JSON.stringify(value)})`);
    }
  };
  const ms = (value, where) => {
    if (!Number.isInteger(value) || value < 0 || value > 10000) {
      problems.push(`${where} must be a number of milliseconds between 0 and 10000`);
    }
  };
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 30) {
    problems.push('name must be the app name, 1 to 30 characters');
  }
  // Android's rule for an application id: two or more parts, each a letter then letters, digits or _
  if (typeof c.appId !== 'string' || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(c.appId)) {
    problems.push('appId must look like "com.yourname.runway": lower case, two or more parts separated by dots');
  }
  if (c.version !== 'auto' && !/^\d+\.\d+\.\d+$/.test(String(c.version))) {
    problems.push('version must be "auto" (from package.json) or like "1.2.3"');
  }
  if (
    c.versionCode !== 'auto' &&
    !(Number.isInteger(c.versionCode) && c.versionCode > 0 && c.versionCode < 2100000000)
  ) {
    problems.push('versionCode must be "auto" or a whole number above 0');
  }
  choice(c.orientation, APK_CHOICES.orientation, 'orientation');
  color(c.icon.background, 'icon.background');
  color(c.icon.foreground, 'icon.foreground');
  if (c.icon.image !== null && (typeof c.icon.image !== 'string' || !/\.png$/i.test(c.icon.image))) {
    problems.push('icon.image must be null (the Runway logo) or the path of a square PNG');
  }
  const s = c.splash;
  if (typeof s.name !== 'string' || s.name.length > 40) {
    problems.push('splash.name must be text of up to 40 characters ("" for none)');
  }
  if (typeof s.tagline !== 'string' || s.tagline.length > 60) {
    problems.push('splash.tagline must be text of up to 60 characters ("" for none)');
  }
  choice(s.align, APK_CHOICES.align, 'splash.align');
  choice(s.loader, APK_CHOICES.loader, 'splash.loader');
  pair(s.background, 'splash.background');
  pair(s.textColor, 'splash.textColor');
  pair(s.taglineColor, 'splash.taglineColor');
  pair(s.loaderColor, 'splash.loaderColor');
  ms(s.minDuration, 'splash.minDuration');
  ms(s.fade, 'splash.fade');
  choice(c.systemBars, APK_CHOICES.systemBars, 'systemBars');
  return problems;
}

/**
 * The Android version code of a version: 1.2.3 is 10203 (each part up to 99), so every new version is a higher number,
 * which Android needs to install it over the one before.
 * @param {string} version like "1.2.3"
 * @returns {number}
 */
export function versionCodeOf(version) {
  const [major, minor, patch] = version.split('.').map(Number);
  return major * 10000 + Math.min(minor, 99) * 100 + Math.min(patch, 99);
}

/** "~/x" in a setting means the user's own folder. */
export const expandHome = p => (p.startsWith('~/') || p === '~' ? path.join(os.homedir(), p.slice(2)) : p);

/**
 * apk.config.json, with the defaults and the versions worked out. Throws with every problem listed when it is wrong.
 * @param {string} [root] the project folder
 * @returns {object} the configuration
 */
export function loadApkConfig(root = process.cwd()) {
  const file = path.join(root, APK_CONFIG);
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const c = merge(APK_DEFAULTS, raw);
  const problems = apkProblems(c);
  if (problems.length) {
    throw new Error(`${APK_CONFIG} needs fixing:\n- ${problems.join('\n- ')}`);
  }
  if (c.version === 'auto') {
    c.version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  }
  if (c.versionCode === 'auto') {
    c.versionCode = versionCodeOf(c.version);
  }
  if (c.icon.image) {
    c.icon.image = path.resolve(root, c.icon.image);
    if (!fs.existsSync(c.icon.image)) {
      throw new Error(`${APK_CONFIG}: icon.image ${c.icon.image} does not exist`);
    }
  }
  c.signing.folder = expandHome(c.signing.folder);
  return c;
}
