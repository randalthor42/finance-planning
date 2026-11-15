# Runway money planner

An offline personal finance planner. The source is plain JavaScript in ES modules with plain CSS, built by Vite. The build is still **one self-contained HTML file** with no network access, so it can be handed out or opened from disk exactly like before.

## Commands

```
npm install          # once
npm run dev          # local dev server with hot reload
npm run build        # writes dist/runway-money-planner.html (and dist/index.html, the same file)
npm test             # unit tests for the core mechanics, plain Node
npm run check        # lint + unit tests + build: run before every commit
```

**Working in this code? Read `AGENTS.md` first.** It has the architecture rules, a "where is…?" table, recipes for adding a page, a window, a field or a calculation, and the coding standards.

## Structure

```
index.html              the page shell only
vite.config.js          single-file build, strict CSP at build time, translation key collection
src/
  main.js               entry: styles, views, global events, start
  config.js             constants
  core/                 util, i18n, dates, format        (pure, no DOM)
  models/               plan schema (normPlan), database, categories, sample plan
  logic/                projection engine, loans, wishes, trips, advice   (pure)
  services/             storage adapter, backup files
  state/                store (state, undo, log) and actions (every mutation)
  ui/
    dom.js, icons.js, state.js, helpers.js, app.js
    components/         buttons, modal, form, pickers, charts, toast, ...
    modals/             one file per editing window
    views/              one file per page; index.js loads them all
  styles/               main.css imports tokens, base, layout, components, ... in order
tests/
  unit/                 simple tests for the core mechanics (npm test)
  regression/           large engine and browser suites (need the private fixtures)
  fixtures/             test data
```

## Rules that keep it clean

1. **Imports only point down the layers**: `ui` → `state` → `services` / `logic` / `models` → `core`. Nothing outside `src/ui/` imports from it or touches the page, with two small exceptions: `services/backup.js` creates a download link, and `core/i18n.js` reloads the page when the language changes.
2. **`logic/` is pure.** `project(plan, { today })` takes a plan and returns months, with no storage, no DOM and no clock other than the `today` you pass. That is why `npm test` runs it in Node.
3. **`normPlan` is the only way data gets in.** Loaded, imported and edited plans all pass through it; it also migrates old versions.
4. **The UI never writes to the store directly.** It calls `Actions.*`; each action is one undo step.
5. **Views register themselves** on the registry `V` (`ui/views/registry.js`), and `ui/app.js` renders `V[name]()`.

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
| `src/core/util.js` | `isObj`, `has`, `r2`, `clamp`, `uid`, `pmt` |

### Layer 2 · Models: the shape of the data and its validation

| Module | Exports |
|---|---|
| `src/models/categories.js` | `CATS`, `INCATS`, `CAT_NAME`, `EVERY`, `SHIFTS`, `KEY_RE` |
| `src/models/db.js` | `normDB`, `normLayouts` |
| `src/models/plan.js` | `normPlan` |
| `src/models/samplePlan.js` | `samplePlan` |

### Layer 3 · Logic: pure calculations

| Module | Exports |
|---|---|
| `src/logic/advice.js` | `roomSeries`, `firstFit`, `budgetTrend` |
| `src/logic/loans.js` | `loanCalc`, `payoffPlan` |
| `src/logic/projection.js` | `recurs`, `project` |
| `src/logic/trips.js` | `tripSpan`, `tripParts` |
| `src/logic/wishes.js` | `wishCalc` |

### Layer 4 · Services: storage and backup files

| Module | Exports |
|---|---|
| `src/services/backup.js` | `IO` |
| `src/services/storage.js` | `LocalStorageAdapter` |

### Layer 5 · State: the store and every change to it

| Module | Exports |
|---|---|
| `src/state/actions.js` | `Actions` |
| `src/state/store.js` | `PlanStore`, `Store` |

### Layer 6 · UI: everything that touches the page

| Module | Exports |
|---|---|
| `src/ui/app.js` | `App` |
| `src/ui/components/button.js` | `btn`, `ibtn` |
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
| `src/ui/modals/account.js` | `ACC_TYPES`, `spendable`, `accountModal` |
| `src/ui/modals/backup.js` | `exportModal`, `importFlow` |
| `src/ui/modals/balances.js` | `balancesModal` |
| `src/ui/modals/change.js` | `changeModal` |
| `src/ui/modals/entry.js` | `entryModal` |
| `src/ui/modals/goal.js` | `goalModal` |
| `src/ui/modals/item.js` | `itemModal`, `logSpend`, `logPurchase` |
| `src/ui/modals/loan.js` | `loanModal` |
| `src/ui/modals/recurring.js` | `recModal` |
| `src/ui/modals/settings.js` | `settingsModal`, `rollModal` |
| `src/ui/modals/trip.js` | `tripModal` |
| `src/ui/modals/wish.js` | `wishModal` |
| `src/ui/state.js` | `UI`, `nowK`, `curK`, `selK`, `monthAt`, `rangeLabel` |
| `src/ui/views/accounts.js` | (registers its view) |
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
| `src/ui/views/subs.js` | (registers its view) |
| `src/ui/views/tools.js` | `TOOLS` |
| `src/ui/views/trips.js` | `budgetTone` |
| `src/ui/views/welcome.js` | (registers its view) |
| `src/ui/views/wishes.js` | (registers its view) |

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

## Translations

Every user-facing text is written as `$t('English sentence {0}', value)`. The build collects all of them into the virtual module `virtual:i18n-keys` (see `vite.config.js`), which feeds "Export language" in Settings. New text only needs the `$t()` call.

## Test data

`tests/fixtures/real*.json` are real backups and are ignored by git. Do not publish them. The engine tests need them; replace them with made-up plans before sharing the repository.

## Known debt

See the last section of `AGENTS.md`.
