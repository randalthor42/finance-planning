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
| `src/core/locale.js` | `formatsForLanguage` |
| `src/core/util.js` | `isObj`, `has`, `r2`, `clamp`, `uid`, `pmt` |

### Layer 2 · Models: the shape of the data and its validation

| Module | Exports |
|---|---|
| `src/models/calendarPrefs.js` | `CAL_LAYOUTS`, `CAL_FIGURES`, `CAL_GROUPS`, `CAL_ADD`, `CAL_LINE`, `SPENDING`, `calendarDefaults`, `normCalendar` |
| `src/models/categories.js` | `CATS`, `INCATS`, `CAT_NAME`, `EVERY`, `SHIFTS`, `KEY_RE` |
| `src/models/db.js` | `normDB`, `normLayouts` |
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

Every user-facing text is written as `$t('English sentence {0}', value)`. The build collects all of them into the virtual module `virtual:i18n-keys` (see `vite.config.js`), which feeds "Export language" in Settings. New text only needs the `$t()` call.

## Test data

`tests/fixtures/real*.json` are real backups and are ignored by git. Do not publish them. The engine tests need them; replace them with made-up plans before sharing the repository.
