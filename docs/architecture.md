# Architecture: a map for new developers

Runway is plain JavaScript (ES modules) and CSS, built by Vite into **one HTML file** that works offline, opened from
disk or served as an installable app. No framework, no backend. This page is the map; the details are in
[README.md](../README.md) (commands, public API of each module), [data_model.md](../data_model.md) (what is stored),
[data.md](data.md) (how it is saved and migrated), [sync.md](sync.md) (several devices) and
[qr-transfer.md](qr-transfer.md).

## Layers

Imports only point down. Nothing outside `src/ui/` touches the page.

```
ui/        pages (views/), editing windows (modals/), components/, the shell (app.js)      the page
state/     store.js (state, undo, saving), actions.js, fileSync.js, driveSync.js           when and what changes
services/  storage.js (localStorage, IndexedDB), backup.js, fileAccess.js, drive.js,       the outside world
           googleAuth.js, handleStore.js
logic/     projection.js (the engine), loans, trips, wishes, calendar, qrChunks.js …      pure calculations
models/    plan.js (normPlan), db.js, records.js (dates of every record), migrations.js,   the shape of the data
           recordMerge.js (merging two copies record by record)
core/      dates, format, i18n, util                                                       pure helpers
```

`logic/`, `models/` and `core/` are pure: no DOM, no storage, no clock other than what is passed in. One exception:
`core/i18n.js` reads and writes its language packs through `services/storage.js` (the language must be known before
any module makes a text), and reloads the page on a language change. That is why most tests run in plain Node.

## One change, from click to disk to other devices

```
click → ui/modals/*.js → Actions.save(list, obj)            (state/actions.js: one undo step)
      → Store.commit(fn, label)                              (state/store.js)
          normPlan(draft)                                    (models/plan.js: the only way data gets in)
          stampPlan(before, after, now)                      (models/records.js: createdAt, updatedAt, deletedAt,
                                                              fieldsUpdatedAt; deleted records kept in plan.deleted)
          recalc() → project(plan)                           (logic/projection.js)
          save()  → at the end of the task: flush()
                 → LocalStorageAdapter.write                 (services/storage.js; the record index follows)
                 → onSaved      → FileSync: the data file    (state/fileSync.js, ~300 ms later)
                 → savedHooks   → DriveSync: Google Drive    (state/driveSync.js, ~5 s later, in the background)
          onChange → App.render()                            (ui/app.js)
```

Coming back: the data file, the Drive file, a QR transfer or an imported backup is merged by `models/recordMerge.js`
and applied with `Store.adoptMerged`. Neither makes an undo step; undo restarts only if the open plan changed.

## Start-up (`src/main.js`)

1. `Store.init()`: read the database, migrate it in memory if it is older (a backup is kept before it is written),
   clean only the open plan.
2. `App.render()`: the first paint.
3. After it: the other plans are cleaned when idle, the device id is read, the record index catches up,
   `Sync.start()` (the data file) and `Drive.start()` (Google Drive), `startPwa()` (manifest and service worker, over
   http(s) only). None of these holds the page up, and none waits for the network.

## Build (`vite.config.js`, `build/`)

- `vite-plugin-singlefile` inlines the code and styles into `dist/index.html` (the page to serve), copied as
  `runway-money-planner.html` (the file to hand out, with the lazily loaded parts below embedded).
- `build/csp.js`: the security policy, added as a `<meta>`: no other site, except Google's sign-in and the Drive API
  when the build has a Google client ID (`VITE_GOOGLE_CLIENT_ID`, [sync.md](sync.md)).
- `build/pwa.js`: manifest, icons, screenshots, `sw.js` (one cache per build; a new build waits for the old pages
  to close, so lazily loaded files always match their page).
- `build/qr.js`: the QR maker and reader bundled apart (`qr-encode.js`, `qr-decode.js`) and embedded in the file to
  hand out; loaded only when used (`ui/qrLoader.js`).
- `virtual:i18n-keys`: every `$t('…')` text, for "Export language": `i18n-texts.json` next to the page (loaded when
  Settings › Language opens) and inside the file to hand out; not in the page's code.

## Where to add things

| To add | Go to |
|---|---|
| a field to a record | `models/plan.js` (normPlan) and, if old data needs it, a migration in `models/migrations.js` |
| a calculation | `logic/`, pure, with a test in `tests/unit/` |
| a change a person can make | `state/actions.js` (never write to the store from a page) |
| a page | `ui/views/<name>.js`, registered on `V` (`ui/views/registry.js`), listed in `ui/views/index.js` and the menu (`ui/app.js NAV`) |
| an editing window | `ui/modals/<name>.js`, built with `formModal` |
| a text | `$t('English sentence {0}', value)`: it is collected for translation automatically |
| something stored per browser | `services/storage.js` only (a test checks nothing else touches storage) |
| a request to another site | think twice: the security policy blocks it (`build/csp.js`), on purpose |

## Rules worth knowing

- A plan object is never changed in place: every change builds a new one. The store caches each plan's JSON text by
  object (`PlanStore.textOf`), so saving, the data file and Drive sync join texts instead of serialising every plan.
- Dates of records are set by the store, never by pages (`stampPlan`). Sync and merges depend on them.
- Performance matters: work that can wait runs when idle (`Store.later`); the Overview draws its lower cards after
  the first paint; the QR libraries and the texts to translate are not in the page. Measure with `npm run perf*` and
  `scripts/lighthouse.mjs` (README "Measuring").
