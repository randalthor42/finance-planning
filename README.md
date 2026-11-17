# Runway money planner

An offline personal finance planner. The source is plain JavaScript in ES modules with plain CSS, built by Vite. The build is still **one self-contained HTML file** (`runway-money-planner.html`) that needs nothing else, so it can be handed out or opened from disk exactly like before. Data stays on the device unless the person exports it, saves it to a file, sends it with QR codes or turns on Google Drive sync (the only other site the app can contact, and only when built with a Google client ID). Served over https with the files built next to it (`sw.js`, `manifest.webmanifest`…), it is also an **installable app** for Android, iOS and computers (see "Installable app" below).

The same plans can be used on several devices: a data file in a synced folder, **Google Drive sync** (opt-in, the only other site the app can contact, and only when built with a Google client ID), **QR codes** from screen to camera, or a backup file. See **[docs/sync.md](docs/sync.md)** and **[docs/qr-transfer.md](docs/qr-transfer.md)**. New to the code? Start with **[docs/architecture.md](docs/architecture.md)** and **[docs/testing.md](docs/testing.md)**.

## Commands

```
npm install          # once
npm run dev          # local dev server with hot reload
npm run build        # writes dist/runway-money-planner.html (the file to hand out) and dist/index.html (to serve)
npm test             # unit tests for the core mechanics, plain Node
npm run test:file    # the data file in a real browser, with two devices (Playwright)
npm run test:drive   # Google Drive sync: a computer and a phone against a fake Google (Playwright)
npm run test:qr      # QR transfers screen to camera, the import preview and merge (Playwright)
npm run test:pwa     # the installable app: manifest, service worker, offline, icons, file:// stays silent
npm run test:overview # the Overview's first drawing with a heavy plan: same result, nothing moves
npm run test:storage # storage in a browser: migration and backup, record index, device id
npm run perf:file    # main-thread time the data file adds to a change
npm run check        # lint + unit tests + build: run before every commit
```


## Structure

```
index.html              the page shell, with the meta tags for phones and installed apps
vite.config.js          single-file build, strict CSP at build time, translation key collection
build/                  build-time only (Node): csp.js (the security policy), pwa.js (manifest, sw.js), icons.js,
                        qr.js (the QR modules, bundled apart and loaded only when used)
.env.test               a made-up Google client ID for test builds (real builds: .env.local, docs/sync.md)
docs/                   architecture, testing, data (saving, migrations), sync (several devices), qr-transfer
src/
  main.js               entry: styles, views, global events, start
  config.js             constants
  core/                 util, i18n, dates, format        (pure, no DOM)
  models/               plan schema (normPlan), database, categories, sample plan, records and their dates,
                        migrations, recordMerge (merging two copies record by record)
  logic/                projection engine, loans, wishes, trips, advice, qrChunks   (pure)
  services/             storage adapter, backup files, file access, handle store (IndexedDB), Drive, Google sign-in
  state/                store (state, undo, log), actions (every mutation), fileSync (the data file), driveSync
  ui/
    dom.js, icons.js, state.js, helpers.js, app.js
    components/         buttons, modal, form, pickers, charts, toast, ...
    modals/             one file per editing window (and the import preview, QR transfers)
    views/              one file per page; index.js loads them all
    qr/                 the QR maker and reader: not in the page, loaded by qrLoader.js when used
  vendor/               QR libraries copied as they are (qrcode-generator, jsQR), with their licences
  styles/               main.css imports tokens, base, layout, components, ... in order
tests/
  unit/                 simple tests for the core mechanics (npm test); helpers/ has the fake file system
  regression/           large engine and browser suites (need the private fixtures, except filesync.ui.cjs)
  fixtures/             test data
```

## Rules that keep it clean

1. **Imports only point down the layers**: `ui` → `state` → `services` / `logic` / `models` → `core`. Nothing outside `src/ui/` imports from it or touches the page, with two small exceptions: `services/backup.js` creates a download link, and `core/i18n.js` reloads the page when the language changes.
2. **`logic/` is pure.** `project(plan, { today })` takes a plan and returns months, with no storage, no DOM and no clock other than the `today` you pass. That is why `npm test` runs it in Node.
3. **`normPlan` is the only way data gets in.** Loaded, imported and edited plans all pass through it; it also migrates old versions.
4. **The UI never writes to the store directly.** It calls `Actions.*`; each action is one undo step.
5. **Views register themselves** on the registry `V` (`ui/views/registry.js`), and `ui/app.js` renders `V[name]()`.
6. **A plan object is never changed in place.** Every change builds a new one (commit, undo, `renamePlan`,
   `replacePlans`). The store keeps each plan's JSON text by object (`PlanStore.textOf`), so saving and the data file
   join texts instead of serialising every plan on every change; a plan changed in place would be saved stale.

## Moving to Vue + Symfony

`core/`, `models/` and `logic/` can be copied into a Vue project unchanged. `state/store.js` maps to a Pinia store and `state/actions.js` to its actions. `services/storage.js` is the one class to replace with an HTTP adapter (`read()` / `write(db)`); `normPlan` and `project` can also run on the server if you port them to PHP or call them through Node. Each file in `ui/views/` and `ui/modals/` becomes one component.

## Public API of each module

### Constants

| Module | Exports |
|---|---|
| `src/config.js` | `APP` |

### Layer 1 · Core: pure helpers, no DOM, no state

| Module | Exports |
|---|---|
| `src/core/dates.js` | `M`, `D`, `Period` |
| `src/core/format.js` | `FMT`, `setFmt`, `money`, `signed`, `compact`, `fmtNum`, `parseMoney` |
| `src/core/grid.js` | `GRID_COLS`, `GRID_MAX_H`, `arrange`, `arrangeOrdered`, `place`, `resize`, `nudge`, `snapDrop`, `findSpot`, `removeEmptyRows`, `fitSize`, `rowCount`, `byReading`, `toSaved`, `sameLayout` |
| `src/core/i18n.js` | `I18N`, `$t`, `plural`, `ordinal` |
| `src/core/pwa.js` | `SW_URL`, `MANIFEST_URL`, `isWebOrigin` |
| `src/core/locale.js` | `formatsForLanguage` |
| `src/core/util.js` | `isObj`, `has`, `r2`, `clamp`, `uid`, `newId`, `ID_RE`, `pmt` |

### Layer 2 · Models: the shape of the data and its validation

| Module | Exports |
|---|---|
| `src/models/calendarPrefs.js` | `CAL_LAYOUTS`, `CAL_FIGURES`, `CAL_GROUPS`, `CAL_ADD`, `CAL_LINE`, `SPENDING`, `calendarDefaults`, `normCalendar` |
| `src/models/categories.js` | `CATS`, `INCATS`, `CAT_NAME`, `EVERY`, `SHIFTS`, `KEY_RE` |
| `src/models/dataFile.js` | `encodeDataFile`, `decodeDataFile` |
| `src/models/db.js` | `normDB`, `normPrefs`, `normLayouts`, `dbText` |
| `src/models/records.js` | `RECORD_LISTS`, `DELETED_LISTS`, `RECORD_TYPE`, `META`, `DELETED_MAX`, `PLAN_FIELDS`, `timestamp`, `sameRecord`, `stampPlan`, `recordEntry`, `planRecord`, `planEntriesOf`, `planEntries` |
| `src/models/migrations.js` | `SCHEMA_VERSION`, `versionOf`, `MIGRATIONS`, `migrate` |
| `src/models/plan.js` | `normPlan` |
| `src/models/samplePlan.js` | `samplePlan` |

### Layer 3 · Logic: pure calculations

| Module | Exports |
|---|---|
| `src/logic/advice.js` | `roomSeries`, `firstFit`, `budgetTrend` |
| `src/logic/calendar.js` | `monthRange`, `weekPos`, `calendarWeeks`, `normEvents`, `lastDay`, `layoutEvents`, `eventsOn`, `eventsIn`, `totals`, `quiet`, `entryGroup`, `entryEvents`, `tripEvents`, `dayBalances`, `nextDays` |
| `src/logic/loans.js` | `loanCalc`, `payoffPlan` |
| `src/logic/projection.js` | `recurs`, `project` |
| `src/logic/trips.js` | `tripSpan`, `tripParts` |
| `src/logic/wishes.js` | `wishCalc` |
| `src/models/recordMerge.js` | `mergeData` (record by record: Drive sync, QR transfers, imports) |
| `src/logic/qrChunks.js` | `FRAME_SIZE`, `crc32`, `makeFrames`, `parseFrame`, `Receiver`, `transferCode` |

### Layer 4 · Services: storage and backup files

| Module | Exports |
|---|---|
| `src/services/backup.js` | `IO` |
| `src/services/storage.js` | `LocalStorageAdapter`, `readText`, `readJSON`, `writeText`, `writeJSON`, `kv`, `deviceId`, `backup`, `backups`, `records`, `clearCopies` |
| `src/services/fileAccess.js` | `FileAccess` |
| `src/services/handleStore.js` | `HandleStore` |
| `src/services/drive.js` | `SYNC_FILE`, `DriveError`, `driveClient` |
| `src/services/googleAuth.js` | `DRIVE_SCOPE`, `GIS_URL`, `googleAuth` |

### Layer 5 · State: the store and every change to it

| Module | Exports |
|---|---|
| `src/state/actions.js` | `Actions` |
| `src/state/store.js` | `PlanStore`, `Store` |
| `src/state/fileSync.js` | `SYNC`, `FileSync`, `Sync` |
| `src/state/driveSync.js` | `DRIVE`, `DriveSync`, `Drive` |

### Layer 6 · UI: everything that touches the page

| Module | Exports |
|---|---|
| `src/ui/app.js` | `App` |
| `src/ui/components/button.js` | `btn`, `ibtn` |
| `src/ui/components/calendar.js` | `CAL_MODES`, `calendarState`, `calendar` |
| `src/ui/components/calendarData.js` | `PLAN_GROUPS`, `SPENDING`, `addChoices`, `lineChoices`, `planCalendar` |
| `src/ui/components/charts.js` | `cashChart`, `netBars`, `sparkline` |
| `src/ui/components/designGrid.js` | `designGrid`, `designToggle`, `isDesigning` |
| `src/ui/components/designPages.js` | `designable`, `isDesignable`, `designPages` |
| `src/ui/components/form.js` | `NOTE`, `formModal` |
| `src/ui/components/info.js` | `info`, `linkify` |
| `src/ui/components/layout.js` | `page`, `designPage`, `card`, `empty`, `amt`, `chip`, `tile`, `bar`, `prow`, `segc`, `row`, `mono`, `cardDel`, `keep`, `budgetText` |
| `src/ui/components/modal.js` | `modal`, `autosaver`, `confirmModal` |
| `src/ui/components/moneyInput.js` | `moneyInp` |
| `src/ui/components/monthNotes.js` | `coverNote`, `fixNote` |
| `src/ui/components/pickers.js` | `monthField` |
| `src/ui/components/popover.js` | `POP`, `closePop`, `ctxMenu`, `popover` |
| `src/ui/components/sortable.js` | `grip`, `sortable`, `moveIn` |
| `src/ui/components/toast.js` | `toast` |
| `src/ui/dom.js` | `$`, `h`, `sv` |
| `src/ui/helpers.js` | `upsert`, `remove`, `accName`, `mainAcc`, `find`, `need`, `dayFields` |
| `src/ui/icons.js` | `icon` |
| `src/ui/pwa.js` | `linkManifest`, `registerServiceWorker`, `themeColor`, `startPwa` |
| `src/ui/modals/account.js` | `ACC_TYPES`, `spendable`, `accountModal` |
| `src/ui/modals/backup.js` | `exportModal`, `importFlow` |
| `src/ui/modals/importPreview.js` | `importPreview`, `mergeImport`, `addCopies` |
| `src/ui/modals/qrTransfer.js` | `qrSendModal`, `qrReceiveModal`, `cleanCode` |
| `src/ui/qrLoader.js` | `loadQr` |
| `src/ui/qr/encode.js`, `src/ui/qr/decode.js` | `drawFrame`, `decode` (bundled apart: `build/qr.js`) |
| `src/ui/modals/balances.js` | `balancesModal` |
| `src/ui/modals/change.js` | `changeModal` |
| `src/ui/modals/entry.js` | `entryModal` |
| `src/ui/modals/goal.js` | `goalModal` |
| `src/ui/modals/item.js` | `itemModal`, `logSpend`, `logPurchase` |
| `src/ui/modals/loan.js` | `loanModal` |
| `src/ui/modals/recurring.js` | `recModal` |
| `src/ui/modals/settings.js` | `settingsModal`, `rollModal`, `newPlanModal`, `renamePlanModal` |
| `src/ui/modals/trip.js` | `tripModal` |
| `src/ui/modals/wish.js` | `wishModal` |
| `src/ui/state.js` | `UI`, `nowK`, `curK`, `selK`, `monthAt`, `rangeLabel` |
| `src/ui/views/accounts.js` | (registers its view) |
| `src/ui/views/calendarSettings.js` | `calendarSettingsCards` |
| `src/ui/views/forecast.js` | (registers its view) |
| `src/ui/views/goals.js` | (registers its view) |
| `src/ui/views/items.js` | (registers its view) |
| `src/ui/views/language.js` | `langPicker`, `languageCard` |
| `src/ui/views/loans.js` | (registers its view) |
| `src/ui/views/months.js` | (registers its view) |
| `src/ui/views/overview.js` | (registers its view) |
| `src/ui/views/recurring.js` | `recStatus` |
| `src/ui/views/registry.js` | `V` |
| `src/ui/views/review.js` | (registers its view) |
| `src/ui/views/settings.js` | `STABS` |
| `src/ui/views/storageSettings.js` | `storageCards`, `storageMeter` |
| `src/ui/views/syncSettings.js` | `DRIVE_STATUS`, `driveUnavailable`, `syncIcon`, `turnOnButton`, `driveCard`, `qrCard` |
| `src/ui/views/subs.js` | (registers its view) |
| `src/ui/views/tools.js` | `TOOLS` |
| `src/ui/views/trips.js` | `budgetTone` |
| `src/ui/views/welcome.js` | (registers its view) |
| `src/ui/views/wishes.js` | (registers its view) |

## Installable app (PWA)

The same single file becomes an app on a phone or computer when it is served over https (or from localhost):
"Install" in Chrome and Edge, "Add to Home Screen" on iOS. It opens full screen, with its icon, and offline.

**What the build makes** (`build/pwa.js`, a Vite plugin; no extra dependencies):

- `dist/index.html` and `runway-money-planner.html`: the app, one file with all its code and styles. Its head has the
  favicon (SVG) and the iOS home screen icon (PNG 180) inline. What the app uses only now and then is not in the page's
  code: the QR maker and reader (`qr-encode.js`, `qr-decode.js`, about 150 KB, `build/qr.js`) and the texts to
  translate for "Export language" (`i18n-texts.json`, about 55 KB). `index.html`, the page that is served, loads
  them from next to it when needed (the service worker keeps them for offline use); `runway-money-planner.html`, the
  file to hand out, has them inside (inert `<script type="text/plain">` and JSON elements), so opened from disk it
  still needs nothing else. Hand out `runway-money-planner.html`; serve the whole folder.
- Next to it, for hosting: `manifest.webmanifest` (`display: standalone`, `start_url`, `scope` and `id` `./`, theme
  colours), its icons (`icons/`: PNG 192 and 512, and a maskable 512 for Android's round and squircle shapes),
  its screenshots (`screenshots/wide.png` 1280×800 and `narrow.png` 412×915, for the richer install dialog on computers
  and phones) and `sw.js`. No `robots.txt`: a hosted copy holds someone's finances, and search engines are not
  invited to index it. The PNG icons are drawn at build time from the logo
  (`build/icons.js`: signed distances for smooth edges, Node's zlib for the PNG). The screenshots are made from the
  sample plan by `node scripts/screenshots.mjs` (after `npm run build`; run it again after a visible change) and kept in
  `build/screenshots/`.
- The manifest's images are files, not data: URIs: Chrome's DevTools cannot load data: images in its Manifest panel
  (it reported every icon as "failed to load", then "include at least one square icon"). Only the page linking the
  manifest (over http or https) uses them, and they travel with it like `sw.js`.

**Meta tags** (`index.html`): `viewport-fit=cover`, `theme-color` for light and dark, `mobile-web-app-capable` and
`apple-mobile-web-app-capable`, `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style` `black-translucent`,
and `format-detection` `telephone=no` (iOS would turn amounts into phone links). With the page under the iOS status
bar, `styles/pwa.css` keeps the content clear of the status bar, the notch and the home indicator (`env(safe-area-inset-*)`,
0 everywhere else). It also colours the band under the status bar, whose text is white: the accent, or the top bar in the
dark theme. `themeColor()` keeps the `theme-color` tags on the theme chosen in Settings, not only the system's.

**In the page** (`ui/pwa.js`, started by `main.js`), only when `location.protocol` is `http:` or `https:`
(`core/pwa.js isWebOrigin`):

- `manifest.webmanifest` is linked. Opened as a file (`file://`) it is not: the browser would refuse to read it and
  say so in the console.
- `sw.js` is registered after the page has loaded, with scope `./`. Not on the development server (it would keep old
  code), not where the browser has no service workers (plain http away from localhost), and never with an error
  thrown: a failed registration resolves to `null`.
- Opened as a file, none of this runs and nothing is logged; `tests/regression/pwa.ui.cjs` checks it with the shipped
  file itself.

**The service worker** answers only GET requests for the files the build writes: the page (`index.html`, and the
folder itself, which is `start_url`), the QR modules (`qr-encode.js`, `qr-decode.js`), the texts to translate
(`i18n-texts.json`), the manifest, its icons and screenshots. Anything else in its folder, and every other site, goes
past it, never cached. Each build is one version, with its own cache (`runway-<fingerprint>`): at install it keeps the
page, the QR modules and the texts, and the install fails if one of them cannot be fetched (the browser tries again
later; the version before stays in charge); the manifest and images are kept if they can be. Every answer comes from
the cache of its own version, so the app opens offline. A new build waits until every page of the old one is closed
(no `skipWaiting`): an open page keeps its own worker and cache, so a QR module or the texts it loads later always
match it, although their names do not change between builds. The new version is used once every tab and window of
the app has been closed (a reload alone is not enough), and its activation removes only older `runway-` caches. It
never sees the plans: they are in the browser storage and the data file, never in a request. `tests/unit/pwa.test.js` runs the generated `sw.js` in a fake worker
(`tests/unit/helpers/fakeServiceWorker.js`).

**Security policy** (`build/csp.js`): the page can reach no other site: no script, style, image or request from
anywhere else, so nothing typed into it can be sent away. Its own site is allowed for the manifest (`manifest-src
'self'`), the worker (`worker-src 'self'`), the manifest icons (`img-src data: 'self'`: the browser loads one for the
page to offer installing it) and requests (`connect-src 'self'`). The app itself needs that last one: the served
page fetches `i18n-texts.json` from its own site when Settings › Language opens (`virtual:i18n-keys` in
`vite.config.js`), so without it Export language fails; DevTools' Manifest panel also uses it to check the icons and
screenshots. It gives no one a new way to get data: the site that serves the page already controls its code. Opened
as a file, there is no site to reach, and the file to hand out has no `connect-src` at all (unless Drive sync is built
in).
`script-src 'self' blob:` lets the page load its own QR modules when a transfer starts (`qr-*.js` next to it, or the
copies embedded in the file to hand out, from a `blob:` URL). Only a build with a Google client ID
(`VITE_GOOGLE_CLIENT_ID`) also allows Google's sign-in (`accounts.google.com/gsi/…`) and the Drive API
(`www.googleapis.com`), for Drive sync, which the person must turn on ([docs/sync.md](docs/sync.md)); a build without
one names no other site at all.

**Hosting**: put the whole `dist` folder on an https server, with `sw.js` served as JavaScript (`text/javascript`).
Keep the page's name, `index.html`: it is the page the service worker keeps.
Without `sw.js` the app still works and Chrome still offers to install it, but it does not open offline, and Chrome
logs the failed download of `sw.js`. An installed app and a browser tab on the same site share the browser storage and
the data file. `vite preview` answers unknown paths with 404, as a static host does (`appType: 'mpa'`): the app has one
page and no client-side routes.

## Measuring: Lighthouse with a heavy plan

`scripts/heavy-data.mjs` builds a deterministic database of a long-time user: a 10-year plan (horizon 120, the most
allowed) with every section full (6 accounts with 2 cards, 7 incomes, 30 bills with 6 budgets and 7 subscriptions,
4700 transactions, 30 trips and events, 4 loans, 5 goals, 40 wishes, notes, ticks, corrections) and two more plans,
about 1.75 M characters. `scripts/lighthouse.mjs` puts it in the storage of a fresh Chrome profile, from `sw.js` so the
app has not run yet, then runs Lighthouse (mobile defaults: simulated slow 4G, CPU 4× slower) with
`--disable-storage-reset`:

```
npm run build && npm run preview                                   # http://localhost:4173
node scripts/lighthouse.mjs after 3                                # 3 runs, medians, lighthouse/lh-after.json
node scripts/lighthouse.mjs pair 3 <before url> <after url>        # two builds in turns, then a table
```

Chrome is `CHROME_PATH` or Playwright's Chromium (`npx playwright install chromium`), on Windows, macOS or Linux.
Lighthouse is not a dependency: the first run downloads `lighthouse@13.5.0` through `npx`.

Single runs are noisy, and so is a shared machine (its speed changed 2× within an hour here). `pair` runs both builds
in turns, so a slower or faster stretch affects both alike, and reports medians. Reports are written to `lighthouse/`
(not in git).

What the start-up work became, with that plan (every step checked to give the same result):

- **Only the open plan is cleaned at start.** `normDB(raw, keepRaw)` keeps the other stored plans as read; the store
  cleans them (normPlan) in the first idle moment, or at once when something needs them (`PlanStore.cleanPlans`:
  switching, sync, rename, export). A plan that does not look like what the store writes is cleaned at once.
- **Calendar arithmetic without Date objects** (`core/dates.js`): `D.of`, `D.key`, `D.parse`, `D.dow`, `D.month`,
  `D.inMonth` use integer civil-date formulas. They are compared with the Date way on every day from 1900 to 2300
  (`tests/unit/dates.test.js`). The projection is about 25% faster, and cleaning a plan about 17%.
- **Number formats are made once** per locale and options (`core/format.js`); the compact one only when a chart needs
  it. The first `Intl` formatter of a visit still costs about 100 ms on a slow phone: that is the browser loading its
  locale data.
- **The Overview's cards below the first screen are built after the first paint**, one per task (`lazy` cards of
  `designGrid`), only on the first drawing in a visit; their place keeps its height, so nothing visible moves
  (`tests/regression/overview.ui.cjs`).
- **A change of the data file's status redraws the menu's badge only** (`App.fileStatus`), not the whole page.
- The projection's card loop computes each card's "taken over by a loan" month once instead of every month. The old
  and new engine were compared on 204 plans (the heavy ones and random variants): identical output.

## Data model, records and migrations

Every record (account, income, bill, item, trip and trip cost, loan, goal, wish, and the plan) carries `id`,
`createdAt`, `updatedAt` and `deletedAt`, set by the store on every save (`models/records.js stampPlan`); deleting keeps
the record in the plan's `deleted` lists, out of every list and total. The database has a `schemaVersion`; older data
is migrated at start after an automatic backup (`models/migrations.js`, `scripts/migrate.mjs`). Only
`services/storage.js` touches localStorage and IndexedDB, where a record index (by `updatedAt` and `deletedAt`) and the
device id are kept. See **[data_model.md](data_model.md)** (the shape of everything stored) and
**[docs/data.md](docs/data.md)** (how it is saved and migrated, and how to run a migration again).

## Storage: the browser copy and the data file

The plans live in two places on a computer:

- **This browser** (`services/storage.js`, localStorage): the working copy. The app opens from it at once, and it keeps
  working when the file is out of reach. It also holds the browser preferences (theme, layouts, calendar) and the
  activity log, which are not plan data.
- **The data file** (`state/fileSync.js`): one JSON file the person chooses with the File System Access API (Chrome,
  Edge and Opera on a computer). It is **off until the person turns it on** in Settings › Storage or chooses a file (`db.fileSync`), like every way
  of moving data off the device. Turned on, until a file is chosen, the menu shows
  "Choose a file" and Settings › Storage offers *Choose where to save* and *Open a data file* (also on the welcome
  screen, for a second computer). Every change is written to it: at most every 300 ms while typing, at once when
  the page is hidden, and not at all for a change of a browser preference.

**Only that file.** The app asks for a file with `showSaveFilePicker` / `showOpenFilePicker`, limited to `.json`, one
file, never a folder (`services/fileAccess.js`). The handle is kept in IndexedDB (`services/handleStore.js`: a handle
cannot go in localStorage) and gives access to that one file only, after the browser's permission. The browser may
ask again on a later visit: the menu then shows "Reconnect file" and changes wait in the browser until then. The
data file itself needs no network (build/csp.js): sharing happens through a synced folder (OneDrive, Dropbox, iCloud
Drive, Syncthing) or a drive the person moves. Google Drive sync and QR transfers are the other ways
([docs/sync.md](docs/sync.md)); they merge record by record (`models/recordMerge.js`), not plan by plan.

**Other devices.** While the page is visible, the file's date and size are checked every 3 s and when the page comes
back into view (option "Load changes from other devices", `db.fileWatch`). The file is read only when they changed.
Before each write the same check is made, so a change from another device is merged first, never overwritten.

**Merging** (`models/recordMerge.js`, pure, the same as Drive sync and imports) goes record by record: every record
carries its dates, so the newer version of each wins, deletions travel (`"deletedPlans"` in the file, and each plan's
`deleted` lists), and ticks made on both sides are kept (see docs/sync.md). Two devices that changed the same plan
without seeing each other end with one plan holding both sets of changes. A plan the file simply never had (a sync
client put an older copy back) is not taken for a deleted one: only a deletion marker deletes. The browser keeps only a
random browser name for the file (`runway.db.v1.file`), shown as "saved by".

**The file** (`models/dataFile.js`) is a backup with another kind, so *Import backup* opens it and an exported backup
can be chosen as the data file (it is rewritten in this format). One plan per line:

```json
{"app":"runway","kind":"data","v":8,"saved":"2026-11-16T10:00:00.000Z","by":"k3j4h5g6",
 "deletedPlans":{},"plans":[
{"id":"p1q2r3s4","name":"Household", …}
]}
```

Nothing is lost by mistake. A file that is not Runway data, is damaged or was saved by a newer version is never
overwritten on its own: the status shows the problem, and *Replace its content with this browser's plans* is offered.
An empty file deletes nothing. *Stop using this file* and *Delete everything* let go of the file and leave it as it
is.

**Tests.** `tests/unit/recordMerge.test.js`, `dataFile.test.js`, `store.test.js` and `fileSync.test.js` run in Node. In
`fileSync.test.js`, "devices" share a fake disk (`tests/unit/helpers/fakeFiles.js`), and it includes a sync client
putting one device's file over another's. `tests/regression/filesync.ui.cjs` (`npm run test:file`) runs two devices
as two browser contexts. The pickers return real handles from each one's Origin Private File System, and the script
plays the sync client between them. After every change it checks that the file holds exactly the plans the app
holds, and that the other device shows it. It also covers reloads, permission, conflicts, tabs, the switches, a
damaged file and a browser without the API.

**Performance** (`npm run perf:file`, heavy plans of 1.2 M characters, CPU 4× slower): a write costs about 5 ms of
main thread; the writing itself is the browser's, off the main thread. Saving to the browser now joins cached plan
texts instead of serialising all plans. A change of a preference no longer cleans every plan again (`normPrefs`).
The storage meter reuses the texts too.

**Phones.** Android and iOS browsers have no file picker for this, so the status is "unsupported" there and the plans
stay in the browser; Google Drive sync and QR codes work there ([docs/sync.md](docs/sync.md)). The plan for the installable app is IndexedDB and the Origin Private File System: a handle from
`navigator.storage.getDirectory()` has the same methods as a picked one, so `FileAccess`, `HandleStore` and
`FileSync` can be reused.

## Design mode (arranging the cards of a page)

Pages whose cards can be arranged have a **Design mode** checkbox, shown once it is turned on in Settings › Appearance
(off by default, `db.designMode`; saved layouts apply either way). Which pages offer it is tracked in
`ui/components/designPages.js`: today the Overview, Accounts, Income and bills, Wishlist, Trips and events and Loans. With it ticked,
every card can be dragged anywhere on a grid of 12 columns (the free cells are outlined), and its size chosen in
columns and rows (the size button, or drag its corner). Cards in the way make room like widgets on a phone, and a card only leaves its row when the row has no space for it:

- dropped on a card of its own row, the two swap;
- a card that is pushed uses free space in its row first (the cards after it shift along, in order);
- only when the row is full does it go to the next row, and the rows after it flow on. With two 6-column cards side by
  side, dropping a 2-column card between them pushes the right one to the next row.

Keyboard: focus a card's grip, then arrow keys move it and Shift + arrow keys resize it. On touch screens, press and
hold a card to lift it. Below 600 px of width the cards are stacked and cannot be arranged.

The layout is a browser preference (`db.layouts`, checked by `normLayouts`), like the theme: it is not plan data, is
not in backups and is not undone with Ctrl+Z. "Reset layout" brings the usual one back. Pages with a Cards and a List
view keep one layout for each (`accounts` and `accounts-list`, for example).

Every account, wish, trip and loan is a card of its own. A new one takes the first free place that fits; a deleted
one leaves a free place. While a search, filter or sort is active (Wishlist, Trips and events), those cards flow in its
order from where the list starts, keeping the sizes chosen, so nothing leaves holes; the other cards stay where they
are. Design mode always shows every card, with the search bar hidden, so the whole list is arranged at once.

Any page can use it. Declare the page (this adds it to the list of pages that offer Design mode; a page that uses
the grid without declaring itself gets a warning in the console), then give each card a stable `id` and a `title`,
with its default size:

```js
const DESIGN = designable('accounts', $t('Accounts'));
// …
return designPage(DESIGN, $t('Accounts'), subtitle, actions, [
  { id: 'total', title: $t('Total'), el: card(...), w: 4 },
  { id: 'list', title: $t('All accounts'), el: card(...), w: 8, minW: 6 },
  { id: 'tips', title: $t('Tips'), el: hasTips ? card(...) : null }, // null: hidden, its place is kept
]);
```

For a list of things, give each card `item: true` and an id made from the thing's id (`'trip-' + trip.id`). Options
(last argument): `layoutKey` (a separate saved layout, e.g. per Cards/List view), `ordered` (the list is searched,
filtered or sorted), `note` (one more sentence for the Design mode bar) and `before` (shown above the cards, e.g. a
search bar). See `views/trips.js` for all of them together.

The rules for placing and making room are pure functions in `core/grid.js` (unit tested); the pointer, keyboard and
drawing code is in `ui/components/designGrid.js`.

## Calendar component

`calendar(options)` in `src/ui/components/calendar.js` shows anything dated on a month grid, in the three densities of the v0.9 audit (§6.3), and **the page chooses one** (`mode`): `full` (a page-wide month with every line and its amount; the Month planner on a wide screen), `compact` (the planner on a tablet or phone: from 600 px of calendar width the grid with names and the day's net, narrower a grid of dots with cells at least 44 px and the lines listed underneath) and `mini` (a small month of dots and status colours for a card; the Overview). Inside, compact is drawn by two renderers chosen by its width (`data-mode` is `tablet` or `mobile`); a page never picks those.

It does not read the store: a page passes events (`{ id, title, date, end?, amount?, group? }`, see `CalendarEvent` in `src/types.js`) and groups for the legend, colours and filters. `planCalendar()` in `calendarData.js` returns ready-made options for the open plan: every ledger line, trips with dates as bars, a figure on each day (`figure`: the end-of-day balance, `'net'` the net of the lines shown, `'spent'` what went out), payday months, and clicks that open the usual windows. Following §6.0b, the balance is shown only on days where something happens, today and the last day of the period; a day's colour is its status (below zero, under the cushion) and is said in words to screen readers; markers show the payday, the lowest day of the month and an unpaid bill whose day has passed. Balances come from `dayBalances` (the same function as "Day by day"), so filters never change them.

Where it is used:

- **Overview**, "Calendar": the `mini` month of what is ahead (`ahead: true`; income, bills, planned one-offs, trips and loans by default), with "Next 7 days: 4 payments · 610 € · lowest 54 € on Mon 30 Nov" above it (`nextDays` in `logic/calendar.js`).
- **Month planner**, the **Calendar** view next to "By type" and "Day by day": the planner's month (`month: k`, `header: false`), kept in step with the month strip both ways, `full` from 768 px of window and `compact` below, with the number chosen in Settings › Calendar on each day.

Both have context menus (`dayMenu` and `eventMenu` options; `planCalendar` fills them). Right click a day, or press the menu key or Shift+F10 on it, to add something there, in three sections: *On this day* (an expense, a spend from a budget, income), *Plans* (a trip or an event starting that day, with the last day left to pick in the window's date picker; a wish for that month) and *From this day on* (a recurring bill, a subscription, a recurring income, a savings goal, a loan). Right click a line to edit it, tick it off, skip it this month or copy it. **Delete** always asks first, with Confirm and Cancel, and says what goes: one transaction, a bill or budget from every month, a loan with all its payments, a trip with its costs. Undo still works after confirming. On touch screens "+", Add and the "⋯" button on each line in the day panel open the same menus. A calendar filtered to some groups only offers to add what it shows (the Overview's spending calendar does not offer income).

```js
calendar({ ...planCalendar(), id: 'planner-cal' });                                         // the whole plan
calendar({ ...planCalendar({ only: ['bill', 'loan'] }), id: 'due-cal', mode: 'mini' });     // what is due
calendar({ ...planCalendar({ only: SPENDING, figure: 'spent' }), id: 'spent-cal' });        // what goes out
calendar({ id: 'my-cal', events, groups, onEvent: ev => ... });                             // any data
```

**Settings › Calendar** decides how both calendars look and what their menus offer: the first day of the week (Monday or Sunday), always six weeks, lines per day, trips as bars, the legend; for the Overview whether it shows a calendar and which groups it shows; for the Month planner the number on each day (end-of-day balance, net of the day, spent that day); and a switch for the context menus and for each thing they can add or do (Edit is always there). The settings are kept with the browser preferences (`db.calendar`, cleaned by `normCalendar` in `src/models/calendarPrefs.js`), like the theme: the same for every plan and not in backups. `planCalendar()` reads them, so a new calendar gets them for free; an option passed to it wins. The switches are built from the same lists as the menus (`addChoices`, `lineChoices`), so a new menu option needs a key in `CAL_ADD` and a line in `addChoices`.

**Performance** (`npm run perf:calendar`, or `node scripts/perf-calendar.cjs sample|heavy <cpu slowdown> [page] [--profile]` to compare builds or see where the time goes). What keeps it fast, worth keeping in mind when changing it:

- Dates as text reuse one `Intl.DateTimeFormat` per language and set of options (`core/dates.js`). `toLocaleDateString` builds a new one on every call and was about 70% of a calendar's drawing time; the whole app gains from it (the month strip, "Day by day"). The text is the same (`tests/unit/dates.test.js` compares them).
- A calendar asks the page for a month's events once and keeps them while it is on the page, so choosing a day, a filter or "Show more" does not rebuild them.
- There is one "+" per calendar that moves to the day under the pointer, instead of one per day; the day menu's choices are worked out once per calendar and the lines' records are looked up in a Map, not a list.
- The mobile month list draws whole days up to 150 lines, then "Show 150 more", like the paged tables (a month of daily spending would otherwise be thousands of elements).
- For the compact density, only a guessed renderer is checked right after drawing (it forces a layout); afterwards the ResizeObserver follows the width, so a calendar in a card below the fold is not laid out before it is needed.
- Choosing a day changes only the two days and what is under the grid; the rest of the calendar is not drawn again.
- `defer: true` (the Overview uses it) draws a calendar further down a page just after the page's first paint, the first time in a visit, keeping about its height meanwhile; later redraws are immediate.

Every option is described at the top of `calendar.js`; the arithmetic (weeks, spans, totals, balances) is in `src/logic/calendar.js` and tested in `tests/unit/calendar.test.js`; `tests/regression/calendar.ui.cjs` checks both pages in a browser (part of `npm run test:ui`, needs only the sample plan).

## Translations

Every user-facing text is written as `$t('English sentence {0}', value)`. The build collects all of them (see `vite.config.js`) for "Export language" in Settings. They are not part of the page's code, so the browser neither downloads nor parses ~55 KB of texts at every start: the served page loads `i18n-texts.json` from next to it when Settings › Language opens (`I18N.loadTexts`, `virtual:i18n-keys`), and the file to hand out has them inside as a JSON element. New text only needs the `$t()` call.

## Test data

`tests/fixtures/real*.json` are real backups and are ignored by git. Do not publish them. The engine tests need them; replace them with made-up plans before sharing the repository.
