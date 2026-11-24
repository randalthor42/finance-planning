/**
 * @file npm run build:apk: the Android app, from apk.config.json, as an APK to copy to a phone and install.
 *
 *   npm run build:apk               the signed release: dist-android/<name>-<version>.apk
 *   npm run build:apk -- --debug    a debug build (quicker, not for handing out)
 *   npm run apk:preview             only the preview of the splash and icon: dist-android/splash-preview.html
 *
 * Steps: the page is built for the app (vite mode "apk": its splash, build/apkSplash.js); capacitor.config.json is
 * written; android/ is made by Capacitor when missing (or when the app id changed), filled with the page and set up
 * from the settings (build/android.js); the release key is made the first time (see signingFile below); Gradle builds.
 *
 * Needs Java 21 and the Android SDK: JAVA_HOME and ANDROID_HOME, or the folders ~/.runway-android/jdk21 and
 * ~/.runway-android/sdk (docs/android.md says how to get them).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capacitorConfig, writeAndroid } from '../build/android.js';
import { loadApkConfig } from '../build/apkConfig.js';
import { splashPreview } from '../build/apkSplash.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = 'dist-apk';
const OUT_DIR = path.join(ROOT, 'dist-android');
const ANDROID = path.join(ROOT, 'android');
const TOOLS = path.join(os.homedir(), '.runway-android');
const WIN = process.platform === 'win32';
const args = new Set(process.argv.slice(2));

const step = text => console.log(`\n▸ ${text}`);
function fail(text) {
  console.error(`\n✗ ${text}`);
  process.exit(1);
}
/**
 * Runs a command in a folder, with the environment given, and stops the build when it fails. npx and gradlew are
 * scripts that Windows runs through its shell; a program (keytool) is run without one.
 */
function run(command, list, cwd = ROOT, env = process.env, shell = WIN) {
  const result = spawnSync(command, list, { cwd, env, stdio: 'inherit', shell });
  if (result.status !== 0) {
    fail(`${command} ${list.join(' ')} failed (exit ${result.status})`);
  }
}

/** A folder from an environment variable, else the one in ~/.runway-android, else nothing. */
function toolDir(variable, fallback, check) {
  const options = [process.env[variable], path.join(TOOLS, fallback)].filter(Boolean);
  return options.find(dir => fs.existsSync(path.join(dir, check))) || null;
}

/**
 * The release key: made once, kept outside the project (apk.config.json › signing.folder), and used for every build
 * after. Android installs an update only when it is signed with the same key, so the folder must be kept (a copy
 * somewhere safe): without it, a new version cannot replace the installed one, which then has to be removed with its
 * data. Returns the path of the properties file that build/android.js's Gradle lines read.
 */
function signingFile(c, javaHome) {
  const folder = c.signing.folder;
  const props = path.join(folder, 'signing.properties');
  if (fs.existsSync(props)) {
    return props;
  }
  step(`Making the release key in ${folder} (once: keep this folder safe, it signs every update)`);
  fs.mkdirSync(folder, { recursive: true });
  const store = path.join(folder, 'release.p12').replace(/\\/g, '/');
  const password = randomBytes(24).toString('base64url');
  const alias = 'runway';
  run(
    path.join(javaHome, 'bin', WIN ? 'keytool.exe' : 'keytool'),
    [
      '-genkeypair',
      '-storetype',
      'PKCS12',
      '-keystore',
      store,
      '-storepass',
      password,
      '-alias',
      alias,
      '-keyalg',
      'RSA',
      '-keysize',
      '3072',
      '-validity',
      '12000',
      '-dname',
      `CN=${c.name.replace(/[",]/g, '')}`,
    ],
    ROOT,
    process.env,
    false,
  );
  // a PKCS12 store has one password for the store and the key
  fs.writeFileSync(
    props,
    `storeFile=${store}\nstorePassword=${password}\nkeyAlias=${alias}\nkeyPassword=${password}\n`,
    { mode: 0o600 },
  );
  return props;
}

let config;
try {
  config = loadApkConfig(ROOT);
} catch (error) {
  fail(error.message);
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const preview = path.join(OUT_DIR, 'splash-preview.html');
fs.writeFileSync(preview, splashPreview(config));
if (args.has('--preview')) {
  console.log(`Preview of the splash and icon: ${preview}`);
  process.exit(0);
}

const javaHome = toolDir('JAVA_HOME', 'jdk21', path.join('bin', WIN ? 'java.exe' : 'java'));
const sdk = toolDir('ANDROID_HOME', 'sdk', 'platform-tools');
if (!javaHome) {
  fail('Java 21 was not found: set JAVA_HOME, or put it in ~/.runway-android/jdk21 (docs/android.md)');
}
if (!sdk) {
  fail('The Android SDK was not found: set ANDROID_HOME, or put it in ~/.runway-android/sdk (docs/android.md)');
}
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk };

step(`The page, for ${config.name} ${config.version} (${config.appId})`);
run('npx', ['vite', 'build', '--mode', 'apk', '--outDir', WEB_DIR, '--emptyOutDir']);

fs.writeFileSync(
  path.join(ROOT, 'capacitor.config.json'),
  JSON.stringify(capacitorConfig(config, WEB_DIR), null, 2) + '\n',
);
// android/ belongs to one app id (its Java package): a new id makes it again
const idFile = path.join(ANDROID, '.runway-app-id');
if (fs.existsSync(ANDROID) && (!fs.existsSync(idFile) || fs.readFileSync(idFile, 'utf8').trim() !== config.appId)) {
  step('The app id changed: making android/ again');
  fs.rmSync(ANDROID, { recursive: true, force: true });
}
if (!fs.existsSync(ANDROID)) {
  step('Making the Android project (android/)');
  run('npx', ['cap', 'add', 'android'], ROOT, env);
  fs.writeFileSync(idFile, config.appId + '\n');
}
step('Copying the page into the app');
run('npx', ['cap', 'sync', 'android'], ROOT, env);
step('Icon, colours, splash, permissions and version');
writeAndroid(config, ANDROID);
fs.writeFileSync(path.join(ANDROID, 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);

const debug = args.has('--debug');
if (!debug) {
  env.RUNWAY_SIGNING = signingFile(config, javaHome);
}
step(debug ? 'Building (debug)' : 'Building the signed release');
run(
  path.join(ANDROID, WIN ? 'gradlew.bat' : 'gradlew'),
  [debug ? 'assembleDebug' : 'assembleRelease', '--console=plain'],
  ANDROID,
  env,
);

const kind = debug ? 'debug' : 'release';
const built = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', kind, `app-${kind}.apk`);
if (!fs.existsSync(built)) {
  fail(`Gradle finished but ${built} is missing`);
}
const name = `${config.name.replace(/[^A-Za-z0-9]+/g, '-')}-${config.version}${debug ? '-debug' : ''}.apk`;
const out = path.join(OUT_DIR, name);
fs.copyFileSync(built, out);
const mb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log(`\n✓ ${out} (${mb} MB)\n  Preview of the splash and icon: ${preview}`);
