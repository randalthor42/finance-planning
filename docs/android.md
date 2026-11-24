# The Android app

Runway can be built as an Android app (an APK) to copy to a phone and install, without the Play Store. The app is the
same page as the web version, inside Android's web view (Capacitor), with its own icon, splash screen and settings.

```bash
npm run build:apk               # the signed release: dist-android/Runway-<version>.apk
npm run build:apk -- --debug    # a quicker debug build, not for handing out
npm run apk:preview             # only dist-android/splash-preview.html: the splash and icon in both themes
```

## What it needs

- **Java 21** (Android's build tool, Gradle 8.14, runs on Java 17 to 24, not newer).
- **The Android SDK**: `platform-tools`, `platforms;android-36` and `build-tools;36.0.0`.

The build looks for them in `JAVA_HOME` and `ANDROID_HOME`, else in `~/.runway-android/jdk21` and
`~/.runway-android/sdk`. Without Android Studio: unzip a JDK 21 (adoptium.net) into the first, the Android
command-line tools (developer.android.com/studio, "Command line tools only") into `sdk/cmdline-tools/latest` of the
second, then run `sdkmanager --licenses` and `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`.
The first build also downloads Gradle and its libraries (a few hundred MB, once).

## Installing it on a phone

Copy the APK to the phone (USB, Drive, email) and tap it. The first time, Android asks to allow the app that opens it
(Files, Chrome) to install apps; Play Protect may say the developer is unknown: "Install anyway".

The app keeps its own data, apart from Runway in the phone's browser: move a plan over once with the QR transfer or a
backup file. Uninstalling the app deletes its data.

## Fingerprint unlock

Settings › Lock and privacy › Fingerprint or face works in the app with Android's own prompt (the web view has no
WebAuthn, which the browser version uses). The page calls the native half of `@aparajita/capacitor-biometric-auth`
(MIT, pinned) through Capacitor's bridge (`src/services/nativeBiometric.js`); its JavaScript is not bundled. Only strong
biometrics count (fingerprint, or a face check made for payments), never the phone's own PIN or pattern. The prompt
opens by itself on the lock screen; "Use PIN" closes it. As in the browser it unlocks the screen lock only, so it is off
while the data is encrypted (only the PIN makes that key), and after 5 failed tries only the PIN opens the app.

## The release key

The first release build makes a signing key in `signing.folder` (default `~/.runway-android/signing`: `release.p12` and
`signing.properties` with its random password). It is never in the project. **Keep that folder, and a copy of it
somewhere safe**: Android installs an update over the installed app only when both are signed with the same key. With
a new key the old app has to be removed first, and its data with it.

## apk.config.json

Every key is optional; what is left out takes the default of `build/apkConfig.js`. Colours are `#rrggbb`; a pair is
`{ "light": "#…", "dark": "#…" }`, the dark one used when the phone is in dark mode. A mistake stops the build with a
list of what to fix.

| Key | What it sets |
|---|---|
| `name` | The name under the icon and in the app list. |
| `appId` | The app's id, like `com.yourname.runway`. It identifies the app: changing it makes a different app (installed beside the old one, without its data). |
| `version`, `versionCode` | `"auto"`: the version of package.json, and its code (1.2.3 → 10203). Each update needs a higher code. |
| `orientation` | `any`, `portrait` or `landscape`. |
| `icon.background`, `icon.foreground` | The icon's colour and the logo line's colour. |
| `icon.image` | `null` for the Runway logo, or the path of a square PNG (at least 432 px) of your own, used as the icon's foreground: keep the art in the middle two thirds, as phones cut the edges to their own shape. |
| `icon.monochrome` | The themed icon of Android 13+ (the logo in the phone's colours, when the person turns themed icons on). |
| `splash.name`, `splash.tagline` | The text on the splash (`""` for none). |
| `splash.align` | `center` (under the icon, which stays where Android's splash drew it), `left` or `right`. |
| `splash.showIcon` | Whether the icon is on the splash. |
| `splash.background`, `splash.textColor`, `splash.taglineColor`, `splash.loaderColor` | Pairs for light and dark mode. The background is also Android's own splash and the window behind the app. |
| `splash.loader` | `bar`, `spinner`, `dots`, `pulse` (the icon breathes) or `none`. |
| `splash.minDuration` | The shortest time the splash shows, in ms (it stays longer if the app is slower to draw). |
| `splash.fade` | How long it fades into the app, in ms. |
| `systemBars` | The status bar's icons: `auto` (light, over the app's blue or dark top bar), `light-icons`, `dark-icons`. |
| `features.camera` | The camera permission, for the QR transfer. |
| `security.allowBackup` | Whether Android's own backup may copy the app's data to Google's cloud (off by default). |
| `signing.folder` | Where the release key is kept (see above). |

### How the splash works

Android 12 and later draw the first splash themselves, and allow only the icon centred on a colour: no text, no other
layout. So the page draws a second one with the same colour and the icon in the same place, which takes over without a
visible change, and that one carries the name, tagline, alignment and loader. Android's splash is hidden only once the
page's is drawn, and the page's fades out once the app has drawn its first screen (or its lock screen), after at least
`minDuration`. Check it with `npm run apk:preview` before building.

## How it is built

`scripts/build-apk.mjs` builds the page in mode `apk` into `dist-apk/` (the splash is added by `build/apkSplash.js`,
and the page is marked `data-apk`: no service worker inside the app), writes `capacitor.config.json`, makes `android/`
with Capacitor when it is missing, copies the page in, sets the project up from the settings (`build/android.js`:
icon, colours, splash theme, manifest, version, signing) and runs Gradle. `android/`, `dist-apk/`, `dist-android/` and
`capacitor.config.json` are made by each build and are not kept in git.
