# Testing

Write the test first, then the code; adjust the test when the scope changes. Every feature here has unit tests in
plain Node and, when it touches the page, a browser test that uses it the way a person does.

## Commands

```
npm test                 # unit tests (node --test tests/unit/*.test.js), a few seconds
npm run lint             # ESLint on src, tests/unit, build
npm run check            # lint + unit tests + build: before every commit
npm run test:file        # the data file, two computers                      tests/regression/filesync.ui.cjs
npm run test:drive       # Google Drive sync, a computer and a phone          tests/regression/drive.ui.cjs
npm run test:qr          # QR transfers and the import preview                tests/regression/qr.ui.cjs
npm run test:pwa         # installable app, service worker, offline, CSP      tests/regression/pwa.ui.cjs
npm run test:storage     # migration, backup, record index, device id        tests/regression/storage.ui.cjs
npm run test:overview    # the Overview's first drawing with a heavy plan     tests/regression/overview.ui.cjs
```

The browser tests build the test bundle first (`vite build --mode test --outDir dist-test`). In that build
`src/debug.js` puts every module's exports on `window` (`Store`, `Actions`, `Drive`, `IO`, `loadQr`…), so a test can
check the state behind what it clicks. `.env.test` gives it a made-up Google client ID, so Drive sync is built in.
They use Playwright's Chromium (`PLAYWRIGHT_BROWSERS_PATH` if the browsers live elsewhere) and write screenshots to
`tests/regression/shots/` (not in git).

## Test doubles (`tests/unit/helpers/`)

| Helper | Stands in for |
|---|---|
| `fakeFiles.js` | the File System Access API (a disk shared by "devices", like a synced folder), the handle store, localStorage, the sync state and key-value storage |
| `fakeDrive.js` | Google Drive's REST API as a `fetch` (list, metadata, download with ETag, create, update with `If-Match`, delete, tokens, offline) and Google's sign-in |
| `fakeServiceWorker.js` | a service worker's global scope, to run the generated `sw.js` |

`FakeDrive` is also what the Drive browser test answers Google's addresses with (Playwright `route`), so the unit and
browser tests agree on how Drive behaves.

## "Devices" in tests

Sync is tested with several devices at once. In unit tests a device is a `PlanStore` with its own storage and its own
sync object; in browser tests it is a Playwright browser context (its own localStorage, IndexedDB and private file
system), a computer (1360×900) or a phone (390×844, touch). After each change the tests compare, **text for text**, the
plans of every device and of the shared copy (the data file, or the Drive file).

## Suites that need more

`tests/regression/engine.test.mjs`, `ui.test.cjs`, `smoke.cjs` and `calendar.ui.cjs` need private fixtures
(`tests/fixtures/real*.json`, not in git) or fixed dates; they are not part of `npm run check`.
