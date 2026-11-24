/**
 * @file The Android project (android/, made by Capacitor) set up from apk.config.json: the name, the application id
 * and version, the icon (an adaptive icon, its themed one and the icon of older phones, all vector drawings), the
 * colours of Android's own splash in the light and dark themes, the screen orientation, the permissions of the
 * features turned on, whether Android may back the app's data up, and the signing of the release.
 *
 * Each run writes these files whole (or the marked lines of the ones Capacitor owns), so the folder always matches
 * the settings: android/ is made again from nothing when it is missing (scripts/build-apk.mjs) and is not kept in git.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logoLine } from './apkIcon.js';

const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": "\\'" })[c]);

/** Writes a file, making its folder. */
function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Replaces a pattern that must be there: a Capacitor template that changed shape stops the build here, not later. */
function swap(text, pattern, replacement, what) {
  if (!pattern.test(text)) {
    throw new Error(`android/: could not find ${what} to set (has Capacitor's template changed?)`);
  }
  return text.replace(pattern, replacement);
}

/** The logo's line as a vector drawable on the adaptive icon's 108-unit grid, in one colour. */
function lineVector(color) {
  const { d, width } = logoLine();
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- written by build/android.js from apk.config.json -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:pathData="${d}" android:strokeColor="${color}" android:strokeWidth="${width}"
        android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000"/>
</vector>
`;
}

/** The icon of phones before Android 8 (no adaptive icons): the line on a disc of the icon's colour. */
function legacyVector(icon) {
  const { d, width } = logoLine();
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- written by build/android.js from apk.config.json -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:pathData="M54,4 a50,50 0 1,0 0.01,0 Z" android:fillColor="${icon.background}"/>
    <group android:scaleX="1.3" android:scaleY="1.3" android:pivotX="54" android:pivotY="54">
        <path android:pathData="${d}" android:strokeColor="${icon.foreground}" android:strokeWidth="${width}"
            android:strokeLineCap="round" android:strokeLineJoin="round" android:fillColor="#00000000"/>
    </group>
</vector>
`;
}

/** The icon's files: adaptive (with the themed layer when asked), round, and the one for older phones. */
function writeIcon(res, icon) {
  // Capacitor's own icon and splash pictures go: ours are drawn, and a PNG of the same name would clash
  for (const dir of fs.readdirSync(res)) {
    if (/^(mipmap|drawable)/.test(dir)) {
      for (const file of fs.readdirSync(path.join(res, dir))) {
        if (/^(ic_launcher|splash)/.test(file)) {
          fs.rmSync(path.join(res, dir, file));
        }
      }
    }
  }
  if (icon.image) {
    // the person's own picture: one large PNG that Android scales (it must leave room around the art, as any
    // adaptive icon's foreground: the middle 66 of its 108 units are always shown)
    fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
    fs.copyFileSync(icon.image, path.join(res, 'drawable-nodpi', 'ic_launcher_foreground.png'));
  } else {
    put(path.join(res, 'drawable', 'ic_launcher_foreground.xml'), lineVector(icon.foreground));
  }
  const themed = icon.monochrome && !icon.image;
  if (themed) {
    put(path.join(res, 'drawable', 'ic_launcher_monochrome.xml'), lineVector('#000000'));
  }
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- written by build/android.js from apk.config.json -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/runway_icon_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>${themed ? '\n    <monochrome android:drawable="@drawable/ic_launcher_monochrome"/>' : ''}
</adaptive-icon>
`;
  put(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptive);
  put(path.join(res, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), adaptive);
  // before Android 8: the drawn icon (a picture of one's own is shown there as it is)
  const legacy = icon.image ? null : legacyVector(icon);
  if (legacy) {
    put(path.join(res, 'mipmap-anydpi', 'ic_launcher.xml'), legacy);
    put(path.join(res, 'mipmap-anydpi', 'ic_launcher_round.xml'), legacy);
  } else {
    fs.mkdirSync(path.join(res, 'mipmap-nodpi'), { recursive: true });
    fs.copyFileSync(icon.image, path.join(res, 'mipmap-nodpi', 'ic_launcher.png'));
    fs.copyFileSync(icon.image, path.join(res, 'mipmap-nodpi', 'ic_launcher_round.png'));
  }
}

/** Colours (light, and dark under values-night), names and the themes, with Android's splash. */
function writeValues(res, c) {
  const colors = theme => `<?xml version="1.0" encoding="utf-8"?>
<!-- written by build/android.js from apk.config.json -->
<resources>
    <color name="runway_icon_background">${c.icon.background}</color>
    <color name="runway_splash_background">${c.splash.background[theme]}</color>
    <color name="colorPrimary">${c.icon.background}</color>
    <color name="colorPrimaryDark">${c.icon.background}</color>
    <color name="colorAccent">${c.icon.background}</color>
</resources>
`;
  put(path.join(res, 'values', 'colors.xml'), colors('light'));
  put(path.join(res, 'values-night', 'colors.xml'), colors('dark'));
  // the template's file of the same colour would be a second definition
  fs.rmSync(path.join(res, 'values', 'ic_launcher_background.xml'), { force: true });
  put(
    path.join(res, 'values', 'strings.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- written by build/android.js from apk.config.json -->
<resources>
    <string name="app_name">${esc(c.name)}</string>
    <string name="title_activity_main">${esc(c.name)}</string>
    <string name="package_name">${c.appId}</string>
    <string name="custom_url_scheme">${c.appId}</string>
</resources>
`,
  );
  // the window behind the page is the splash's colour too: nothing white shows while the page loads
  put(
    path.join(res, 'drawable', 'splash.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- written by build/android.js from apk.config.json -->
<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="@color/runway_splash_background"/></shape>
`,
  );
  put(
    path.join(res, 'values', 'styles.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- written by build/android.js from apk.config.json -->
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@color/runway_splash_background</item>
    </style>
    <!-- Android's splash (12 and later; the same on older phones through androidx core-splashscreen): the icon on the
         splash colour. The page's own splash (build/apkSplash.js) takes over with the same colour and icon -->
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/runway_splash_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/ic_launcher_foreground</item>
        <item name="windowSplashScreenIconBackgroundColor">@color/runway_icon_background</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
`,
  );
}

/** The manifest: backup, orientation and the permissions of the features turned on (marked lines, rewritten each run). */
function writeManifest(file, c) {
  let xml = fs.readFileSync(file, 'utf8');
  xml = swap(
    xml,
    /android:allowBackup="(true|false)"/,
    `android:allowBackup="${c.security.allowBackup}"`,
    'allowBackup',
  );
  xml = xml.replace(/\s*android:screenOrientation="[^"]*"/, '');
  if (c.orientation !== 'any') {
    xml = swap(
      xml,
      /android:name="\.MainActivity"/,
      `android:name=".MainActivity"\n            android:screenOrientation="${c.orientation}"`,
      'the activity',
    );
  }
  xml = xml.replace(/\s*<!-- runway:features -->[\s\S]*?<!-- \/runway:features -->/, '');
  const lines = [];
  if (c.features.camera) {
    // the QR transfer reads codes with the camera; phones without one can still install the app
    lines.push('<uses-permission android:name="android.permission.CAMERA" />');
    lines.push('<uses-feature android:name="android.hardware.camera" android:required="false" />');
  }
  if (lines.length) {
    const block = `\n    <!-- runway:features -->\n    ${lines.join('\n    ')}\n    <!-- /runway:features -->`;
    xml = swap(xml, /\n<\/manifest>/, `${block}\n</manifest>`, 'the end of the manifest');
  }
  fs.writeFileSync(file, xml);
}

/**
 * app/build.gradle: id, version, and the signing of the release with the key named by RUNWAY_SIGNING (a properties
 * file outside the project, scripts/build-apk.mjs): without it the release is not signed.
 */
function writeGradle(file, c) {
  let g = fs.readFileSync(file, 'utf8');
  g = swap(g, /applicationId "[^"]*"/, `applicationId "${c.appId}"`, 'applicationId');
  g = swap(g, /versionCode \d+/, `versionCode ${c.versionCode}`, 'versionCode');
  g = swap(g, /versionName "[^"]*"/, `versionName "${c.version}"`, 'versionName');
  g = g.replace(/\n\/\/ runway:signing[\s\S]*?\/\/ \/runway:signing\n/, '\n');
  g += `
// runway:signing (build/android.js): the release key, from the file RUNWAY_SIGNING names (never in the project)
def runwaySigning = System.getenv('RUNWAY_SIGNING')
if (runwaySigning) {
    def p = new Properties()
    new File(runwaySigning).withInputStream { p.load(it) }
    android {
        signingConfigs {
            runway {
                storeFile new File(p.storeFile)
                storePassword p.storePassword
                keyAlias p.keyAlias
                keyPassword p.keyPassword
            }
        }
        buildTypes { release { signingConfig signingConfigs.runway } }
    }
}
// /runway:signing
`;
  fs.writeFileSync(file, g);
}

/**
 * capacitor.config.json: the app, where the built page is, and the native plugins' settings. Android's splash stays
 * until the page hides it (build/apkSplash.js); the page draws under the system bars, as on a phone's home screen
 * (styles/pwa.css keeps the content clear of them), and the bars' icons are light or dark as set.
 * @param {object} c the configuration
 * @param {string} webDir the built page's folder, relative to the project
 * @returns {object}
 */
export function capacitorConfig(c, webDir) {
  const style = { auto: 'DARK', 'light-icons': 'DARK', 'dark-icons': 'LIGHT' }[c.systemBars];
  return {
    appId: c.appId,
    appName: c.name,
    webDir,
    android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
    plugins: {
      SplashScreen: { launchAutoHide: false, launchShowDuration: 0, launchFadeOutDuration: 0 },
      SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style },
    },
  };
}

/**
 * Sets android/ up from the configuration.
 * @param {object} c the configuration (build/apkConfig.js)
 * @param {string} androidDir the android/ folder
 */
export function writeAndroid(c, androidDir) {
  const main = path.join(androidDir, 'app', 'src', 'main');
  const res = path.join(main, 'res');
  writeIcon(res, c.icon);
  writeValues(res, c);
  writeManifest(path.join(main, 'AndroidManifest.xml'), c);
  writeGradle(path.join(androidDir, 'app', 'build.gradle'), c);
}
