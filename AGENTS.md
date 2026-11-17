# AGENTS.md

Guide for anyone (human or AI agent) working in this repository. Read this first; it should be enough to find a bug or add a feature without reading the whole codebase.

## What this is

Runway is an offline-first personal finance planner. It is plain JavaScript (ES modules) and plain CSS, bundled by Vite into **one self-contained HTML file** (`dist/runway-money-planner.html`) that runs from disk with no network access. Data lives in the browser's `localStorage` (the database) and IndexedDB (backups made before a migration, a record index, the device id, sync state). It can be exported as a JSON backup, optionally encrypted with a password, and moved between devices three ways, all opt-in: Google Drive sync, QR codes from screen to camera, and a data file in a synced folder (see `docs/sync.md`, `docs/qr-transfer.md`, `docs/data.md`, `docs/architecture.md`).

The build writes two pages: `runway-money-planner.html`, the file to hand out, which needs nothing else; and `index.html`, the page to serve over https with the files built next to it (`qr-encode.js`, `qr-decode.js`, `i18n-texts.json`, `sw.js`, the manifest and icons), which loads the QR tools and the texts to translate only when they are needed. `index.html` opened from a disk cannot load those files and says so.

## Non-negotiable constraints

1. **Zero runtime dependencies from npm.** `package.json` has `devDependencies` only. Never add a runtime library. The one exception is `src/vendor/`: two QR libraries copied unchanged (qrcode-generator, MIT; jsQR, Apache-2.0; see `src/vendor/README.md`). They are bundled on their own and loaded only when a QR transfer starts, never into the main page's code. Do not add to `src/vendor/` without the same treatment (on demand, licence noted, unchanged copy).
2. **One offline file.** `npm run build` must produce `dist/runway-money-planner.html` that works alone from `file://` under the Content-Security-Policy in `build/csp.js`. No external fonts, no CDN, no request to any other site. The only network use is Google Drive sync, which the person turns on, and only in a build made with a Google client ID (`VITE_GOOGLE_CLIENT_ID`); then the policy allows Google's sign-in and Drive API and nothing else. The served page also loads its own files (above) from its own site.
3. **Money maths and stored data stay compatible.** Every plan ever saved must still load through `normPlan` and give the same numbers. Stored data has a format number (`APP.schema`, in `config.js`); a change to it needs a migration in `src/models/migrations.js`, which runs at start after a backup of the stored text is kept. Backups are AES-GCM with PBKDF2; do not change the format without a migration.
4. **Offline first.** Every change is saved on the device first. Nothing the person does may wait on the network: Drive sync runs afterwards, in the background (`src/state/driveSync.js`).
5. **All user text goes through `textContent`** (the `h()` helper does this). Never use `innerHTML` with user data. Links are only created for `http(s)` URLs.
6. **Every user-facing string is wrapped in `$t('English text {0}', value)`.** The build collects these for translators.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dev tools (once). |
| `npm run dev` | Dev server with hot reload. |
| `npm run build` | Build the single HTML file into `dist/`. Tests are never part of the build. |
| `npm test` | Unit tests for the core mechanics (plain Node, about a second). |
| `npm run lint` | ESLint over `src`, the unit tests and `build/`. |
| `npm run format` | Prettier over `src`, the unit tests and `build/`. |
| `npm run check` | Lint, unit tests and build. Run this before every commit. |
| `npm run test:regression` | Larger engine regression suite. Needs the private fixtures (see Tests). |
| `npm run test:ui` | Every browser suite (Playwright; first run `npx playwright install chromium`). |
| `npm run test:drive`, `test:qr`, `test:file`, `test:storage`, `test:pwa`, `test:overview` | One browser suite each: Drive sync against a fake Google, QR transfer between two pages, the data file, storage and migrations, the installable app, the Overview. |
| `npm run perf` | Performance probe on the test build: real plan, CPU slowed 4x; fails when a budget is exceeded (needs Playwright's Chromium). |
| `npm run perf:calendar`, `perf:file` | The same for the calendar, and for writing the data file. |
| `npm run lighthouse` | Lighthouse on the built page (downloads `lighthouse` through npx on first use; needs Playwright's Chromium). |

## Architecture in one picture

```
ui  ──►  state  ──►  services
 │         │    └─►  logic  ──►  models  ──►  core
 └─────────┴──────────────────────────────────►
```

Imports only point **down**. Nothing outside `src/ui/` touches the page (three documented exceptions: `services/backup.js` creates a download link, `core/i18n.js` reloads the page on a language change, `services/googleAuth.js` adds Google's sign-in script when Drive sync needs it). One import points up: `core/i18n.js` reads and writes its language packs through `services/storage.js`, because the language must be known before any module makes a text. Only `services/storage.js` touches `localStorage` and IndexedDB (a unit test checks this).

| Layer | Folder | Responsibility | May import |
|---|---|---|---|
| 1 Core | `src/core/` | Pure helpers: rounding, ids, dates, formatting, translations. | core |
| 2 Models | `src/models/` | Shape of the data. `normPlan` validates every plan; `migrations.js` upgrades stored data; `records.js` dates every record; `recordMerge.js` merges two copies of the data. | core, logic (only for migration) |
| 3 Logic | `src/logic/` | Pure calculations: `project(plan)` and the loan, wishlist, trip and advice maths. | core |
| 4 Services | `src/services/` | Storage (localStorage, IndexedDB), backup files, the data file, Google sign-in and the Drive API. | core, models |
| 5 State | `src/state/` | `Store` (active plan, projection, undo, log), `Actions` (every mutation), Drive sync and the data file (when they run, what they merge). | core, models, logic, services |
| 6 UI | `src/ui/` | Everything on screen. | all of the above |

## Where is…?

| I want to change… | Open |
|---|---|
| A page (Overview, Month planner, Trips, …) | `src/ui/views/<name>.js` |
| An editing window (goal, loan, trip, bill, account, …) | `src/ui/modals/<name>.js` |
| The menu, routing, rendering | `src/ui/app.js` |
| A shared widget (button, modal, form, picker, chart, toast) | `src/ui/components/<name>.js` |
| How a month is calculated | `src/logic/projection.js` |
| Loan schedule, payoff planner | `src/logic/loans.js` |
| Trip costs across a payday | `src/logic/trips.js` |
| "When can I afford it", budget trends | `src/logic/advice.js` |
| Forecast methods (measured overrun, recent pace, exponential smoothing, damped trend, stress tests, Monte Carlo range) | `src/logic/forecast.js` |
| The list of forecasts in the menu, and showing one over the month planner | `FTABS` and `forecastCloses` in `src/ui/views/forecast.js` |
| What the Review page counts as "went well" / "to watch" | `src/logic/review.js` (rules) and `src/ui/views/review.js` (wording) |
| The consistency rules and the full ledger (Audit page) | `src/logic/audit.js` |
| What the global search looks through | `src/logic/search.js` (add one entry to `SOURCES`) |
| Search, filters and sort above a list | `src/logic/listQuery.js` + `src/ui/components/listToolbar.js` |
| A table that sorts by clicking its column titles | `src/ui/components/dataTable.js` (`align: 'left'` for text columns) |
| Caching expensive derived data per plan revision | `src/ui/memo.js` |
| Design mode: which pages offer it | `designable(key, name)` next to each view; the list is `src/ui/components/designPages.js` |
| Design mode: dragging, keyboard, the size pop-up, saving a layout | `src/ui/components/designGrid.js` (`isDesigning(key)` is the one test for "this page is being arranged") |
| Design mode: where cards go and how others make room (pure, unit-tested) | `src/core/grid.js` |
| Saved layouts and the Design mode switch (browser preferences, not plan data) | `normLayouts` and `designMode` in `src/models/db.js` |
| Bills or incomes entered twice | `duplicateLines` in `src/logic/audit.js` |
| What a plan may contain, defaults, migrations | `src/models/plan.js` |
| What happens when the user changes something | `src/state/actions.js` |
| Undo, redo, saving, the activity log | `src/state/store.js` |
| Where data is stored | `src/services/storage.js` |
| Export, import, encryption, CSV | `src/services/backup.js` |
| The dates on every record (createdAt, updatedAt, deletedAt), deleted records, per-month change times | `src/models/records.js` (`stampPlan`, called by the store on every save) |
| A change to the stored format | `src/models/migrations.js` and `APP.schema` in `src/config.js` |
| How two copies of the data merge (Drive sync, QR, import) | `src/models/recordMerge.js` (rules at the top; `docs/sync.md`) |
| Google Drive sync: when it runs, statuses, passphrase | `src/state/driveSync.js`; the API calls in `src/services/drive.js`, sign-in in `src/services/googleAuth.js`; the card in `src/ui/views/syncSettings.js` |
| QR transfer | `src/logic/qrChunks.js` (frames), `src/ui/modals/qrTransfer.js` (screens), `src/ui/qr/` and `src/ui/qrLoader.js` (loaded on demand), `build/qr.js` (how they are built) |
| The preview before an import is merged | `src/ui/modals/importPreview.js` |
| The data file (save to a JSON file in a synced folder) | `src/state/fileSync.js`, `src/services/fileAccess.js`, `src/models/dataFile.js` (merged by `src/models/recordMerge.js`) |
| The security policy, the installable app (service worker, manifest, icons) | `build/csp.js`, `build/pwa.js`, `src/ui/pwa.js` |
| Dates, pay periods | `src/core/dates.js` |
| The calendar: grid, densities (full, compact, mini), keyboard, day panel | `src/ui/components/calendar.js` (the page passes `mode`) |
| The plan on a calendar: events, day figure and markers, menus | `src/ui/components/calendarData.js` (`planCalendar`) |
| Calendar arithmetic: weeks, spans, end-of-day balances, the next 7 days | `src/logic/calendar.js` (Day by day uses `dayBalances` too) |
| Calendar settings (Settings › Calendar) | `src/models/calendarPrefs.js` (`normCalendar`) and `src/ui/views/calendarSettings.js` |
| Money formatting and parsing | `src/core/format.js` |
| The currency and formats a first plan starts with (from the browser language) | `src/core/locale.js` |
| "New plan" in three steps, and the plan settings fields | `newPlanModal` and `planFields` in `src/ui/modals/settings.js` |
| Translation machinery | `src/core/i18n.js` |
| Colours, spacing, themes | `src/styles/tokens.css` |
| Styles of a component | `src/styles/` (see `main.css` for the list and order) |
| Data shapes for editor hints | `src/types.js` |

Every file starts with a `@file` comment that states its one responsibility.

## How the data flows

1. The user does something in a view or modal.
2. The UI calls one function of `Actions` (for example `Actions.save('goals', goal)`).
3. The action calls `Store.commit(mutator, label)`, which: copies the plan for undo, applies the change, passes the plan through `normPlan`, dates what changed (`stampPlan`: new and changed records get `updatedAt`, removed ones move to `plan.deleted`), re-runs `project(plan)`, saves through the storage adapter, and notifies the UI. Drive sync and the data file are told after the save and run later.
4. `App.render()` redraws the current view from `Store.plan` (the data) and `Store.proj` (the projection).

The UI never edits `Store.plan` directly and never calculates money itself. Plan objects are never changed in place: the store caches each plan's stored text by object (`TEXT` in `store.js`), so a plan changed in place would be saved with its old text. That text is `planText(plan)` (`models/records.js`): the JSON without `deletedAt: null` and without a `createdAt` equal to `updatedAt`, which `normPlan` puts back when it reads it. Compare and store plan texts with `planText`, never with `JSON.stringify`.

## Sync rules (read before touching records, merging or Drive sync)

- Every record (account, income, bill, item, trip, trip cost, loan, goal, wish, and the plan itself) has `id`, `createdAt`, `updatedAt` and `deletedAt` (epoch ms). `stampPlan` sets them on every save; the migrations and `normPlan` only fill them in for data that has none.
- The time comes from `Store.now()`, which never goes below the newest time the data already holds (this device's last save, or a change merged in from another device): a clock put back, or another device's clock running ahead, cannot make a new edit lose to the version it replaced. Pure code takes the time as a parameter.
- A deleted record is kept in `plan.deleted`, never in the live lists, so totals and the projection never see it. The newest 500 per kind are kept in full; older ones, up to 5,000, as markers (id and dates). A marker is what stops another device from bringing the record back.
- The plan's own fields merge one by one by `plan.fieldsUpdatedAt`; the month maps (`paid`, `fixes`, `overrides`, `reserveOver`, `notes`) merge month by month and line by line by `plan.keysUpdatedAt`, so ticks made on two devices are both kept. Its times are kept in sorted order (identical data must give identical text, or every merge sees a change), and months before the plan's first month keep none.
- Per record, the newer `updatedAt` wins; a tie with different content is settled by the content, so every device makes the same choice. Merging must be the same in both directions and idempotent (`tests/unit/recordMerge.test.js`).
- Data rewritten by an older version of the app (which drops dates) is detected at start (`schemaSeen` in the storage adapter) and migrated with the oldest date, so it cannot beat newer edits from other devices.

## The money model (read before touching `logic/projection.js`)

- Time is counted in **budget months**. With a payday set, a month runs from one salary to the day before the next (`Period` in `core/dates.js`). `payFor: 'next'` means the salary that arrives on 26 October pays for "November".
- `project(plan, { today })` builds, for every month, a **ledger** of entries (income, bills, purchases, trip costs, loan payments, wishlist, savings) and rolls it into balances.
- For each month:
  - `now` = what the month started with + every **paid** line (ticked lines and logged spends).
  - `todo` = every line that is **not** paid (for a budget: what is left of it).
  - `close` = `now + todo`. Ticking a line moves its amount from `todo` to `now`; **a tick must never change `close`.**
- A **budget** ("up to" bill) is spent bit by bit. Logged spends are real lines; the budget line itself is only what is still reserved.
- A **limit** (budget with `reserve: false`) holds nothing back in any month: only logged spends count. This is a product decision (v0.9): future months therefore do not include limits, so a limit only lowers a month once spends are logged against it.
- **Money in / money out** (`m.inc`, `m.out`, `m.net`) describe earning and spending. A line with category `refund` lowers money out instead of raising money in. Money drawn from a credit card or savings (`item.cover`) is group `transfer`: it is in `m.moved`, not in `m.inc`, and the month ends at `open + net + moved + correction`.
- **One month, one sum**: every screen that shows where the current month stands uses `monthPosition()` (`logic/position.js`) and `monthEquation` (`ui/components/monthEquation.js`): `now + comingIn − toPay − budgetsLeft = close`.
- A **correction** (`plan.fixes[month]`) is the difference between real money and the paid lines on the day the user checked. It is one more paid line.
- **Credit cards**: a purchase planned on a card costs no cash; it adds to what the card owes in that month. A bill with `payTo` pays the card down. `account.owed` is what is owed **today**; `projection.cards[id]` has, per month, `added` (still planned on the card), `paidOff` (still to be paid off) and `series` (owed at the end of the month). Any screen that shows a card must say which of these it shows.
- **Trips** that cross a payday share each cost between the salary months by trip days (`logic/trips.js`), unless the cost has its own pay month.

## Recipes

### Add a new page

1. Create `src/ui/views/myPage.js`. Start with a `@file` comment, import `V` from `./registry.js`, and assign the render function:
   ```js
   V.myPage = () => page($t('My page'), $t('What this page is for.'), null, card($t('Title'), null, null, content));
   ```
2. Import it in `src/ui/views/index.js`.
3. Add one line to `NAV` in `src/ui/app.js`: `['myPage', $t('My page'), 'iconName']`.

Nothing else changes. Read data from `Store.plan` and `Store.proj`; change data only through `Actions`.

### Add a new editing window

Create `src/ui/modals/myThing.js` and use `formModal({ title, values, fields, onSave })` from `ui/components/form.js`. Copy `modals/goal.js` as a starting point. Save with `upsert('listName', record)` from `ui/helpers.js`.

### Add a table

Use `dataTable({ id, rows, columns })` from `ui/components/dataTable.js`. A column with a `value` function sorts when its title is clicked; a column without one (buttons) does not. For a status column, return a rank from `value` (see "Does it fit?" in `views/trips.js`).

### Add search, filters and sort to a list

Describe the columns once as `fields` (`{ key, label, type, value(row), options? }`), keep the state with
`listState(id)`, get the rows with `applyQuery(rows, query, fields)` (`src/logic/listQuery.js`, pure and unit-tested)
and draw `listToolbar({ id, query, fields, result, filters, sorts })` (`src/ui/components/listToolbar.js`) above them.
Totals that describe the whole list (like "Total bills per month") stay computed over all rows.

### Let the cards of a page be arranged (Design mode)

1. Next to the view, declare the page: `const DESIGN = designable('myPage', $t('My page'));`.
2. Return `designPage(DESIGN, title, subtitle, actions, cards, options)` instead of `page(...)`. Each card is
   `{ id, title, el, w, h, minW, … }` with a stable `id`; `el: null` hides a card and keeps its place.
3. A list of things gives each card `item: true` and an id made from the thing's id (`'trip-' + trip.id`). A page that
   changes what it shows while it is arranged (Trips and Wishlist drop their search) tests that with `isDesigning(DESIGN)`.

The full option list (`layoutKey`, `ordered`, `note`, `before`) is in the README, section "Design mode".

### Make a new kind of record searchable

Add one entry to `SOURCES` in `src/logic/search.js` and one opener in `src/ui/modals/search.js`.

### Add a tool (calculator)

Add an entry to `TOOLS` and a render function in `src/ui/views/tools.js`. Pure maths belongs in `src/logic/`, with a unit test.

### Add a field to the data

1. Add it to the matching record in `normPlan` (`src/models/plan.js`) with validation and a default. Old plans then get the default automatically.
2. Use it in `logic/` or the UI.
3. Add it to `src/types.js`.
4. Add a unit test in `tests/unit/plan.test.js`.

### Add a calculation

Write a pure function in `src/logic/` (plan in, result out; no `Store`, no DOM, no `Date.now()`; take `today` as a parameter). Add a unit test. Call it from the view.

### Add a change the user can make

Add a method to `Actions` (`src/state/actions.js`) that calls `Store.commit(plan => { … }, $t('Label for the activity log'))`. One action is one undo step.

## Coding standards

**Readability**

- Write for the next developer, not for the fewest characters. Prefer several plain statements over one clever expression.
- Names say what the value is: `monthKey`, `currentGoal`, `daysLeft`. Single letters only for loop counters and for the documented conventions below.
- One declaration per statement, braces on every block (both enforced by ESLint).
- No nested ternaries in new code. Use `if` / `else` or a small named function.
- Functions do one thing. If a function needs a comment to separate its "parts", split it.

**Documentation**

- Every file starts with a `@file` comment.
- Every exported function has a JSDoc comment that says what it returns and, for money maths, **why** the rule is what it is.
- Use the types in `src/types.js` in `@param` and `@returns`.

**Structure**

- Respect the layer table. If a `logic/` or `models/` file needs something from `ui/` or `state/`, the design is wrong.
- `logic/` functions are pure. Same input, same output.
- No module may run code that calls into another UI module while it is loading (UI modules import each other in cycles; top-level code must only define things).

**Defensive coding**

- Validate at the boundaries: `normPlan` for all plan data, `normDB` for the stored database, `IO.read` for imported files. Inside those boundaries, trust the data.
- Errors shown to the user are sentences in `$t(...)`. `App.render` catches a failing view and `main.js` reports uncaught errors as a notification; do not rely on them, handle expected failures where they happen.

**Performance**

- The app re-renders the current view after each change. Measured after the v0.9 performance pass (Chromium, real plan, CPU 1x): `project()` 1.4 ms, a tick 15 ms (commit 3 ms, redraw 11 ms), every page redraws in 3-11 ms, the Wishlist's first draw after a change 35 ms. Budget: under 50 ms with the CPU slowed 4x (a mid-range phone). Event delegation and a lighter commit were measured and left out: not needed at these numbers. Measure (`npm run perf`) before adding partial-update machinery.
- Wishlist "earliest month" searches screen each candidate month with `screenExtraCost` (`logic/advice.js`) and confirm the month found with one projection; keep that test (`tests/unit/advice.test.js`) green if the engine changes how a wish's lines are counted.
- Expensive derived data (what-if projections, forecasts) goes through `memo(key, inputs, fn)` in `ui/memo.js`: it is reused until `Store.rev` changes (every recalculation) or its inputs change. Never cache anything that reads the DOM or the date outside `Store`.
- `Store.save()` is coalesced: it writes once at the end of the current task. `Store.flush()` writes at once; `main.js` calls it on `visibilitychange` and `pagehide`. Code that needs the data on disk immediately (before a reload) must call `Store.flush()`.
- The undo stack keeps at most 60 steps and about 1M characters of snapshots. The purchase log keeps at most 5,000 entries per plan: `Store.commit` warns at 4,500 and refuses a change that would go past the limit.
- Any listener added to `document` or `window` inside a function must be removed when the thing closes (see `popover.js`, `sortable.js`). Timers must be cleared (see `autosaver` in `modal.js`).
- Do not keep references to DOM nodes of a previous render.

**Styles**

- Use the tokens in `styles/tokens.css`; no hard-coded colours.
- Class names are specific (`.tipbtn`, `.nowgrid`). Generic names such as `.info`, `.now` or `.empty` have caused collisions before.

## Naming conventions you will meet

Some short names are part of stored data or of APIs used everywhere. They are stable; do not rename them without a migration.

| Name | Meaning |
|---|---|
| `M` | Month helpers. A month is an integer `year * 12 + month`; `M.key(index)` gives `"YYYY-MM"`. |
| `D` | Day helpers. A day is an integer (days since 1970, UTC); `D.key(day)` gives `"YYYY-MM-DD"`. |
| `Period` | Budget months that follow a payday. |
| `h(tag, props, ...children)` | Creates a DOM element. `text:` sets `textContent`. |
| `$t(text, ...values)` | Translates. `plural(n, 'month')` for counted words. |
| `V` | The view registry: `V.<name>()` renders a page. |
| `Store.plan`, `Store.proj` | The active plan and its projection. |
| month fields `k`, `key`, `open`, `inc`, `out`, `net`, `now`, `todo`, `close` | See `Month` in `src/types.js`. |
| entry fields `key`, `group`, `amount`, `paid`, `still`, `of`, `onCard` | See `Entry` in `src/types.js`. |
| loan result `P`, `pay`, `f0`, `sch`, `int`, `balAt` | Documented at the top of `loanCalc`. |

## Tests

```
tests/
  unit/          simple, fast, no private data. Run on every change (npm test). helpers/ has a fake Google Drive,
                 fake files and storage, and a fake service worker.
  regression/    large suites: the engine against real backups, and the browser suites (Playwright).
  fixtures/      test data. real*.json are real backups: ignored by git, never publish them.
```

- **Unit tests** cover the mechanics: dates and pay periods, money parsing, loans, the month sum (ticks, budgets, corrections), trips across a payday, `normPlan`, backup round trips, records and migrations, merging, the store, the data file, Drive sync (against `helpers/fakeDrive.js`), QR frames and the installable app's worker. Keep them simple: one behaviour per test, made-up data, plain assertions. When a mechanic changes on purpose, change its test in the same commit.
- **Regression suites** compare against real backups and drive the built file in a browser. Run them before a release. They need `tests/fixtures/real*.json`.
- Tests live outside `src/` and are never bundled. The only test hook inside `src/` is `debug.js`, which the normal build removes.

## Invariants (never break these)

`auditChecks` in `src/logic/audit.js` lists the rules every projection must satisfy: balances carry over, a month is the sum of its lines, `now + todo = close`, money in and out match the lines, net worth is cash plus savings minus debt. They are shown on the Audit page and run in `tests/unit/review.test.js`. If you change the engine and one fails, the engine is wrong, not the rule.

## Definition of done

- `npm run check` passes.
- New behaviour has a unit test when it is logic; a manual check in `npm run dev` when it is UI.
- New text is in `$t()`.
- No new runtime dependency, no network access beyond Drive sync (constraints 1 and 2).
- This file and `src/types.js` are updated when the structure or the data changes.

## Known debt (be honest about it)

- **Dense code inherited from the single-file version.** The code is formatted and the most cryptic locals are renamed, but many callbacks still use one-letter parameters (`e` for an entry or an event, `m` for a month, `x`), and several views are long functions with nested ternaries. Clean these up **when you touch them**, with the tests green before and after; do not rewrite untouched code in bulk.
- **`src/styles/features.css`** groups later additions by when they were added, not by component.
- **Views re-render fully.** Fine at today's sizes (see Performance).
- **`logic/projection.js` is one long function.** It is the best-tested file; split it only with the regression suite at hand.
- **Deleting a "from savings" cover line** does not put the money back in the savings account (undo does).
- **Drive sync has only been tested against a fake Google** (`tests/unit/helpers/fakeDrive.js`). Check against the real API, in particular whether `If-Match` on an upload is honoured and whether the `ETag` header can be read cross-origin. Correctness does not depend on either (a replaced write is repaired by its device at its next sync), but conflicts cost an extra round when they are not.
- **Clocks.** The newer edit wins by time. A device whose clock runs far ahead still wins its own edits against the others until they have merged its changes (from then on their times start after its times).
