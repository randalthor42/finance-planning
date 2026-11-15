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
| `src/core/i18n.js` | `I18N`, `$t`, `plural`, `ordinal` |
| `src/core/util.js` | `isObj`, `has`, `r2`, `clamp`, `uid`, `pmt` |

### Layer 2 · Models: the shape of the data and its validation

| Module | Exports |
|---|---|
| `src/models/calendarPrefs.js` | `CAL_LAYOUTS`, `CAL_FIGURES`, `CAL_GROUPS`, `CAL_ADD`, `CAL_LINE`, `SPENDING`, `calendarDefaults`, `normCalendar` |
| `src/models/categories.js` | `CATS`, `INCATS`, `CAT_NAME`, `EVERY`, `SHIFTS`, `KEY_RE` |
| `src/models/db.js` | `normDB` |
| `src/models/plan.js` | `normPlan` |
| `src/models/samplePlan.js` | `samplePlan` |

### Layer 3 · Logic: pure calculations

| Module | Exports |
|---|---|
| `src/logic/advice.js` | `roomSeries`, `firstFit`, `budgetTrend` |
| `src/logic/calendar.js` | `monthRange`, `weekPos`, `calendarWeeks`, `normEvents`, `lastDay`, `layoutEvents`, `eventsOn`, `eventsIn`, `totals`, `entryGroup`, `entryEvents`, `tripEvents`, `dayBalances` |
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
| `src/ui/components/form.js` | `NOTE`, `formModal` |
| `src/ui/components/info.js` | `info`, `linkify` |
| `src/ui/components/layout.js` | `page`, `card`, `empty`, `amt`, `chip`, `tile`, `bar`, `prow`, `segc`, `row`, `mono`, `cardDel`, `keep`, `budgetText` |
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

## Calendar component

`calendar(options)` in `src/ui/components/calendar.js` shows anything dated on a month grid, in four layouts: `full` (a page-wide month with every line and its amount), `tablet` (the same grid, names only and the day's net), `mobile` (days with coloured dots, the lines listed underneath) and `compact` (a mini month for a card). The default, `auto`, picks full, tablet or mobile by the width the calendar itself gets, so it also fits a narrow column on a wide screen.

It does not read the store: a page passes events (`{ id, title, date, end?, amount?, group? }`, see `CalendarEvent` in `src/types.js`) and groups for the legend, colours and filters. `planCalendar()` in `calendarData.js` returns ready-made options for the open plan: every ledger line, trips with dates as bars, a figure on each day (the end-of-day balance, or with `figure: 'spent'` what went out that day), payday months, and clicks that open the usual windows.

Where it is used:

- **Overview**, "Spending calendar": money going out day by day (`only: SPENDING`, `figure: 'spent'`). It opens on this month and the arrows page through the plan.
- **Month planner**, the **Calendar** view mode next to "By type" and "Day by day": the planner's month (`month: k`, `header: false`), kept in step with the month strip both ways, with the end-of-day balance on each day.

Both have context menus (`dayMenu` and `eventMenu` options; `planCalendar` fills them). Right click a day, or press the menu key or Shift+F10 on it, to add something there, in three sections: *On this day* (an expense, a spend from a budget, income), *Plans* (a trip or an event starting that day, with the last day left to pick in the window's date picker; a wish for that month) and *From this day on* (a recurring bill, a subscription, a recurring income, a savings goal, a loan). Right click a line to edit it, tick it off, skip it this month or copy it. **Delete** always asks first, with Confirm and Cancel, and says what goes: one transaction, a bill or budget from every month, a loan with all its payments, a trip with its costs. Undo still works after confirming. On touch screens "+", Add and the "⋯" button on each line in the day panel open the same menus. A calendar filtered to some groups only offers to add what it shows (the Overview's spending calendar does not offer income).

```js
calendar({ ...planCalendar(), id: 'planner-cal' });                                         // the whole plan
calendar({ ...planCalendar({ only: ['bill', 'loan'] }), id: 'due-cal', mode: 'compact' });  // what is due
calendar({ ...planCalendar({ only: SPENDING, figure: 'spent' }), id: 'spent-cal' });        // what goes out
calendar({ id: 'my-cal', events, groups, onEvent: ev => ... });                             // any data
```

**Settings › Calendar** decides how both calendars look and what their menus offer: the first day of the week (Monday or Sunday), always six weeks, lines per day, trips as bars, the legend; for the Overview whether it shows a calendar, its layout, the number on each day and which groups it shows; for the Month planner its layout and number on each day; and a switch for the context menus and for each thing they can add or do (Edit is always there). The settings are kept with the browser preferences (`db.calendar`, cleaned by `normCalendar` in `src/models/calendarPrefs.js`), like the theme: the same for every plan and not in backups. `planCalendar()` reads them, so a new calendar gets them for free; an option passed to it wins. The switches are built from the same lists as the menus (`addChoices`, `lineChoices`), so a new menu option needs a key in `CAL_ADD` and a line in `addChoices`.

**Performance** (`npm run perf:calendar`, or `node scripts/perf-calendar.cjs sample|heavy <cpu slowdown> [page] [--profile]` to compare builds or see where the time goes). What keeps it fast, worth keeping in mind when changing it:

- Dates as text reuse one `Intl.DateTimeFormat` per language and set of options (`core/dates.js`). `toLocaleDateString` builds a new one on every call and was about 70% of a calendar's drawing time; the whole app gains from it (the month strip, "Day by day"). The text is the same (`tests/unit/dates.test.js` compares them).
- A calendar asks the page for a month's events once and keeps them while it is on the page, so choosing a day, a filter or "Show more" does not rebuild them.
- There is one "+" per calendar that moves to the day under the pointer, instead of one per day; the day menu's choices are worked out once per calendar and the lines' records are looked up in a Map, not a list.
- The mobile month list draws whole days up to 150 lines, then "Show 150 more", like the paged tables (a month of daily spending would otherwise be thousands of elements).
- Only a guessed layout is checked right after drawing (it forces a layout); afterwards the ResizeObserver follows the width, so a calendar in a card below the fold is not laid out before it is needed.
- Choosing a day changes only the two days and what is under the grid; the rest of the calendar is not drawn again.
- `defer: true` (the Overview uses it) draws a calendar further down a page just after the page's first paint, the first time in a visit, keeping about its height meanwhile; later redraws are immediate.

Every option is described at the top of `calendar.js`; the arithmetic (weeks, spans, totals, balances) is in `src/logic/calendar.js` and tested in `tests/unit/calendar.test.js`; `tests/regression/calendar.ui.cjs` checks both pages in a browser (part of `npm run test:ui`, needs only the sample plan).

## Translations

Every user-facing text is written as `$t('English sentence {0}', value)`. The build collects all of them into the virtual module `virtual:i18n-keys` (see `vite.config.js`), which feeds "Export language" in Settings. New text only needs the `$t()` call.

## Test data

`tests/fixtures/real*.json` are real backups and are ignored by git. Do not publish them. The engine tests need them; replace them with made-up plans before sharing the repository.
