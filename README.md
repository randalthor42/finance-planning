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
  services/             storage adapter (optionally encrypted), backup files, PIN hashing, biometrics
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
| `src/core/format.js` | `FMT` (`FMT.hidden`: amounts show as `MASK`), `MASK`, `setFmt`, `money`, `signed`, `compact`, `plainMoney` (never hidden: the activity log), `maskMoney` (hides amounts in a finished text), `fmtNum`, `parseMoney` |
| `src/core/gesture.js` | `SLOP`, `axisOf`, `swipeStep`, `resist`, `velocity`, `sheetSnap` |
| `src/core/random.js` | `mulberry32`, `poisson` |
| `src/core/grid.js` | `GRID_COLS`, `GRID_MAX_H`, `arrange`, `arrangeOrdered`, `place`, `resize`, `nudge`, `snapDrop`, `findSpot`, `removeEmptyRows`, `fitSize`, `rowCount`, `byReading`, `toSaved`, `sameLayout` |
| `src/core/i18n.js` | `I18N` (`useKeys`, `KEYS`, `WORDS` read on first use), `$t`, `plural`, `ordinal` |
| `src/core/locale.js` | `formatsForLanguage` |
| `src/core/util.js` | `isObj`, `has`, `r2`, `clamp`, `uid`, `pmt` |

### Layer 2 · Models: the shape of the data and its validation

| Module | Exports |
|---|---|
| `src/models/agenda.js` | `AGENDA_TONES`, `REPEATS`, `AGENDA_LAYERS`, `DEFAULT_LAYERS`, `AGENDA_FIGURES`, `LAYER_NAMES`, `FIGURE_NAMES`, `DRAFT_LISTS`, `PIN_LISTS`, `AGENDA_MAX`, `FIRST_CAL`, `normAgenda` |
| `src/models/calendarPrefs.js` | `CAL_LAYOUTS`, `CAL_FIGURES`, `CAL_GROUPS`, `CAL_ADD`, `CAL_LINE`, `SPENDING`, `calendarDefaults`, `normCalendar` |
| `src/models/sim.js` | `SIM_HORIZONS`, `SIM_RUNS`, `CHANGE_KINDS`, `simDefaults`, `normSim` |
| `src/models/categories.js` | `CATS`, `INCATS`, `CAT_NAME`, `EVERY`, `SHIFTS`, `KEY_RE` (also `appt:<id>:<day>`, a counted appointment) |
| `src/models/db.js` | `normDB`, `normLayouts`, `normReminders` |
| `src/models/plan.js` | `normPlan` |
| `src/models/samplePlan.js` | `samplePlan` |

### Layer 3 · Logic: pure calculations

| Module | Exports |
|---|---|
| `src/logic/agenda.js` | `prepareEntries`, `occurrences`, `agendaEvents`, `moneyOf`, `draftMoney`, `draftEvents`, `draftCount`, `draftIds`, `pinKey`, `categoryFilter`, `withDrafts`, `moveDrafts`, `draftImpact`, `agendaChanges`, `editOccurrence`, `deleteOccurrence` |
| `src/logic/advice.js` | `roomSeries`, `firstFit`, `budgetTrend` |
| `src/logic/calendar.js` | `monthRange`, `weekPos`, `calendarWeeks`, `normEvents`, `lastDay`, `layoutEvents`, `eventsOn`, `eventsIn`, `totals`, `quiet`, `entryGroup`, `entryEvents`, `tripEvents`, `dayBalances`, `nextDays` |
| `src/logic/occurrences.js` | `prepareEntries`, `occurrences` (used by the projection and the calendar) |
| `src/logic/loans.js` | `loanCalc`, `payoffPlan` |
| `src/logic/lock.js` | `MAX_ATTEMPTS`, `BIO_ATTEMPTS`, `LOCK_TIMEOUTS`, `validPin`, `cooldownFor`, `afterFailure`, `afterSuccess`, `waitLeft`, `afterBioFailure`, `bioAllowed`, `shouldLock` |
| `src/logic/projection.js` | `recurs`, `project` |
| `src/logic/recurs.js` | `recurs` |
| `src/logic/reminders.js` | `REMINDER_DAYS`, `REMINDER_KINDS`, `dueReminders`, `newReminders`, `pruneSeen` |
| `src/logic/sim/` (loaded on demand, see SIMULATION.md) | `fitModel`, `baseFlows`, `simulate`, `simulateInChunks`, `effectiveModel`, `drawSpending`, `backtest`, `verdictOf`, `risksOf`, `describe`, `median`, `mad`, `quantile`, `FALLBACK`, `INCOME_FALLBACK`, `MIN_MONTHS`, `WINDOW_MAX` |
| `src/logic/trips.js` | `tripSpan`, `tripParts` |
| `src/logic/wishes.js` | `wishCalc` |

### Layer 4 · Services: storage and backup files

| Module | Exports |
|---|---|
| `src/services/backup.js` | `IO` |
| `src/services/storage.js` | `LocalStorageAdapter` (plain, or sealed with a key: `sealed`, `unlock`, `seal`, `unseal`, `reload`, `settled`, `onError`) |
| `src/services/pin.js` | `PIN_ITER`, `hashPin`, `verifyPin`, `newSalt`, `dataKey`, `sealText`, `openText`, `isSealed` |
| `src/services/lockConfig.js` | `LOCK_KEY`, `normLock`, `readLock`, `writeLock` |
| `src/services/biometric.js` | `support`, `register`, `verify`, `derToRaw` |
| `src/services/lazySim.js` | `loadSimulation` |

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
| `src/ui/components/agendaData.js` | `AGENDA_CAL`, `draftChoices`, `draftsTitle`, `openDraft`, `dayForNew`, `agendaCalendar` |
| `src/ui/components/calendar.js` | `CAL_MODES`, `calendarState`, `calendar` |
| `src/ui/components/calendarData.js` | `PLAN_GROUPS`, `SPENDING`, `addChoices`, `lineChoices`, `planCalendar` |
| `src/ui/components/gestures.js` | `HOLD_MS`, `gridGestures` |
| `src/ui/components/charts.js` | `cashChart`, `netBars`, `sparkline`, `fanChart` |
| `src/ui/components/designGrid.js` | `designGrid`, `designToggle`, `isDesigning` |
| `src/ui/components/designPages.js` | `designable`, `pageName`, `isDesignable`, `designPages` |
| `src/ui/components/form.js` | `NOTE`, `formModal` |
| `src/ui/components/info.js` | `info`, `linkify` |
| `src/ui/components/layout.js` | `page`, `designPage`, `card`, `empty`, `amt`, `chip`, `tile`, `bar`, `prow`, `segc`, `row`, `mono`, `cardDel`, `keep`, `budgetText` |
| `src/ui/components/modal.js` | `modal`, `autosaver`, `confirmModal` |
| `src/ui/components/moneyInput.js` | `moneyInp` |
| `src/ui/components/monthNotes.js` | `coverNote`, `fixNote` |
| `src/ui/components/pickers.js` | `monthField` |
| `src/ui/components/popover.js` | `POP`, `closePop`, `ctxMenu`, `popover` |
| `src/ui/components/sheet.js` | `showSheet`, `setSheet`, `closeSheet`, `sheetState`, `sheetFollow`, `sheetRelease`, `sheetToggleLabel` |
| `src/ui/components/sortable.js` | `grip`, `sortable`, `moveIn` |
| `src/ui/components/toast.js` | `toast` |
| `src/ui/dom.js` | `$`, `h`, `sv` |
| `src/ui/helpers.js` | `upsert`, `remove`, `tickOf`, `accName`, `mainAcc`, `find`, `need`, `dayFields`, `inPlan`, `inDrafts` |
| `src/ui/icons.js` | `icon` |
| `src/ui/lock.js` | `Lock`, `applyPrivacy` |
| `src/ui/modals/account.js` | `ACC_TYPES`, `spendable`, `accountModal` |
| `src/ui/modals/agendaSettings.js` | `agendaSettingsModal` |
| `src/ui/modals/applyDrafts.js` | `allDrafts`, `draftWhen`, `draftAmount`, `impactRows`, `applyDraftsModal` |
| `src/ui/modals/appointment.js` | `SCOPES`, `deleteScopeModal`, `appointmentModal` |
| `src/ui/modals/backup.js` | `exportModal`, `importFlow` |
| `src/ui/modals/balances.js` | `balancesModal` |
| `src/ui/modals/change.js` | `changeModal` |
| `src/ui/modals/entry.js` | `entryModal` |
| `src/ui/modals/goal.js` | `goalModal` |
| `src/ui/modals/item.js` | `itemModal`, `logSpend`, `logPurchase` |
| `src/ui/modals/loan.js` | `loanModal` |
| `src/ui/modals/pin.js` | `pinModal` |
| `src/ui/modals/pinPicker.js` | `pinPicker` |
| `src/ui/modals/scenario.js` | `scenarioModal` |
| `src/ui/modals/simOverride.js` | `simOverrideModal` |
| `src/ui/modals/recurring.js` | `recModal` |
| `src/ui/modals/settings.js` | `settingsModal`, `rollModal` |
| `src/ui/modals/trip.js` | `tripModal` |
| `src/ui/modals/wish.js` | `wishModal` |
| `src/ui/reminders.js` | `dueNow`, `whenText`, `systemNotifications`, `checkReminders`, `askNotifications`, `dueSoonCard` |
| `src/ui/state.js` | `UI`, `nowK`, `curK`, `selK`, `monthAt`, `rangeLabel` |
| `src/ui/simRun.js` | `simulation`, `forgetSimulation` |
| `src/ui/simFormat.js` | `chance`, `chanceAbout`, `rough` |
| `src/ui/views/accounts.js` | (registers its view) |
| `src/ui/views/agenda.js` | (registers its view and its leave question) |
| `src/ui/views/calendarSettings.js` | `calendarSettingsCards` |
| `src/ui/views/forecast.js` | `FTABS`, `forecastInputs`, `forecastCloses` (registers its view) |
| `src/ui/views/simulation.js` | `simulationPage`, `simCsv` |
| `src/ui/views/goals.js` | (registers its view) |
| `src/ui/views/items.js` | (registers its view) |
| `src/ui/views/language.js` | `langPicker`, `languageCard` |
| `src/ui/views/loans.js` | (registers its view) |
| `src/ui/views/months.js` | (registers its view) |
| `src/ui/views/overview.js` | (registers its view) |
| `src/ui/views/recurring.js` | `recStatus` |
| `src/ui/views/registry.js` | `V`, `LEAVE` |
| `src/ui/views/review.js` | (registers its view) |
| `src/ui/views/security.js` | `securityCards`, `reminderCards` |
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

**On a phone or tablet** (the `compact` density) the calendar acts like Google Calendar. The `sheet` and `swipe` options
(both on by default) control this:

- **Swipe the grid sideways** to change month. The grid follows the finger, then the next or previous month slides in,
  or it springs back. At the plan's first or last month it gives way a little and springs back. An up or down swipe
  scrolls the page as usual (`touch-action: pan-y`).
- **Tap a day** and it opens in a **bottom sheet** that peeks up over the dimmed page, with its first lines. Press and
  drag the sheet up, or flick it, and it opens to nearly the whole screen with **every detail**: the day's balance and
  markers, and each line as a card with its time, amount, group, notes and its menu as buttons (Edit, Mark as paid,
  Skip this month, Delete…). Drag it down to go back to the peek, then away. **Swipe it sideways** for the day before
  or after; the grid follows, into the next month if needed.
- **Press and hold a day, then swipe up:** its details rise with the finger. Let go high for every detail, lower for
  the peek. Holding still lets the phone's own long press open the day menu, as before.
- Every gesture has a button or key too: Previous day, Next day, More details / Fewer details, Close, Esc. A tap on the
  dimmed page also closes the sheet, and the focus returns to the day. The sheet stays open when the page is drawn
  again (a change saved from it) and leaves with the page. "Less motion" turns the glides off.
- A phone keeps the month list under the grid while a day is open. A wide screen is unchanged: the day is listed
  under the grid. Widening the window while a sheet is open moves the day there, still chosen.

The arithmetic (which way a finger goes, whether a swipe changes the month, where the sheet settles, fling speed) is
`core/gesture.js`, unit tested. The pointer and touch code is `ui/components/gestures.js` (grid) and
`ui/components/sheet.js` (a generic bottom sheet). `tests/regression/calendar.touch.ui.cjs` drives it with real touches
(Chrome's `Input.dispatchTouchEvent`), so `touch-action` and the browser's own scrolling take part. A sideways swipe
consumes its own touch moves, so the browser starts no fling that would swallow the next tap.

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

## My calendar

**Plans and goals › My calendar** (`views/agenda.js`) is the person's own calendar page, on the same `calendar()`
component: their appointments next to what they choose to see of the plan, and **drafts**, money that counts for
nothing until they apply it.

- **Appointments** (`New appointment`, or right click a day): a title, one of their own calendars, a day or several,
  an optional start and end time, and a repeat (every day, week, month or year, optionally until a day). A monthly one on
  the 31st falls on the last day of shorter months, like a bill.
- **Money on an appointment**: what it costs (a dentist) or brings in (babysitting), with a category. Like a wish or a
  trip, it counts only when **Count in my plan** is on, or once it is applied with the drafts. Until then it is a draft:
  drawn dashed, listed in Review and apply, and asked about when leaving the page. Counted, every occurrence is a ledger
  line `appt:<id>:<day>` on its day, in its budget month (`logic/projection.js`). It can be ticked as paid, shows in the
  Month planner, the Overview and the Forecast, and opens the appointment (`entryModal`). On My calendar the
  appointment itself shows its money, so that line is not shown twice.
- **One day of a repeat**: a click on a day opens the appointment on that day, and the window asks what the changes
  are for: **This day** (the day leaves the repeat and becomes an appointment of its own), **This and following days**
  (the repeat ends the day before and a new one starts with the changes), or **Every day** (a new day moves every day
  by as much). The fields that changed also reach the days changed on their own, within the scope. Delete asks the
  same three questions, and a line's menu has all three. Split parts and days changed on their own stay linked
  (`series`), so "every day" means every part. That window saves with its button only, never as you type.
- **Own calendars** ("Personal" at first; `Customise` adds more, each with a colour of the app) are groups of the
  legend, so each can be shown or hidden.
- **What of the plan it shows**: layers (`Customise`: income, bills, budgets, transactions, trips and events, loans,
  savings, wishlist…), spending categories (only bills, budgets and transactions are filtered; a spend logged against a
  budget has its budget's category), the number on each day (balance, net, spent or nothing), and single records pinned
  with `Add from your plan` (or "Always show on my calendar" in a line's menu), which show whatever the layers say.
- **Drafts** (`Add a draft`, or the day menu): a spending, an income, a trip or an event, made in the usual windows
  (`itemModal`, `tripModal` with the `inDrafts` target of `ui/helpers.js`) and kept in `plan.agenda.drafts`. They are
  drawn dashed (`tentative` events) and are not added up anywhere: not in balances, not in the month's money in and
  out. The bar above the calendar counts them and says what they would do. **Review and apply** ticks the ones to add,
  shows before → after (money in and out over the plan, lowest month end, months below zero, end of the plan), and
  adds them in one step: one Undo makes them drafts again. Applied drafts are pinned, so they stay on the calendar as
  the real lines they now are.
- **Leaving the page** while drafts made or changed in this visit are still drafts asks once whether to add them
  ("Review and apply" or "Keep as drafts"); views can register such a question in `LEAVE` (`views/registry.js`).
- The search (Ctrl K) finds appointments and drafts too.

Every change to the calendar is written down in the activity log with its own line (see below), including the ones
made in Customise, each switch on its own, while the whole window stays one Undo step (`logEach`).

The data is `plan.agenda` (cleaned by `normAgenda` in `models/agenda.js`, called from `normPlan`, so it is in backups,
Undo and the activity log like the rest of the plan). The shape is `Agenda` in `types.js`. The arithmetic (repeats,
events, drafts, what applying changes) is in `logic/agenda.js` and tested in `tests/unit/agenda.test.js`; the actions in
`tests/unit/agendaActions.test.js`; the page in `tests/regression/agenda.ui.cjs` (part of `npm run test:ui`, with the
clock fixed, needs only the sample plan).

**Performance.** A change that touches only `plan.agenda` and no counted money (an appointment without money or not
counted yet, a draft, the calendar's settings) cannot change a number. It is committed with `{ sameMoney: true }`
and `Store` keeps the projection instead of working it out again (Undo and Redo still recalculate). Actions try an
appointment change on a copy of the agenda first (`agendaCommit`): when the counted appointments are the same before and
after, the projection is kept. Repeats are worked out, not walked (`occurrences`): a daily appointment
started years ago costs the same as a new one. Dates are parsed once per drawing of the page (`prepareEntries`), and
the drafts bar's projection is cached until the drafts change (`ui/memo.js`). `npm run perf:calendar` times the page
with 300 appointments and 30 drafts on top of the heavy plan, and a save of each kind.

## Activity log

Every change is written down in **Settings › Activity**, in words:
- plan data: one line per commit (`Store.commit` labels). An autosaving window keeps one line, its last words.
  Changes that each say something (the Customise window of My calendar) keep one line each with `logEach`, inside
  one Undo step.
- preferences that are not plan data (theme, notifications, autosave, Design mode and every layout change, Cards or
  List, Settings › Calendar): `Store.setPref(key, value, words)`, only when the value really changes.
- plans (added, opened, renamed, deleted), languages (used, added, removed: `Store.note`, written at once because the
  page reloads), clearing the log, and erasing all data.
Undo and Redo are written down too. `tests/unit/activity.test.js` checks it.

## Translations

Every user-facing text is written as `$t('English sentence {0}', value)`. The build collects all of them into the virtual module `virtual:i18n-keys` (see `vite.config.js`), which feeds "Export language" in Settings. New text only needs the `$t()` call. In a build the list is not code: it waits in the page as inert JSON and is read the first time it is needed (`I18N.useKeys`), so the app does not build about 1 700 strings at every start.

## Accessibility

Checked with axe-core (WCAG 2.0, 2.1 and 2.2, A and AA) on every page, light and dark, desktop and phone, and in the
windows and the day sheet of the calendars; the result is held by `tests/unit/contrast.test.js` and
`tests/regression/a11y.ui.cjs` (no extra dependency). What to keep in mind when adding to the app:

- **Contrast.** Text colours are tokens that pass 4.5:1 on every surface (`--text`, `--muted`, `--faint`; checked
  from `tokens.css` by the unit test). Something quieter is quieter by **colour, never by opacity**: opacity lowers the
  contrast of the text inside (paid lines, days of the next month, switched-off cards, hidden chart series).
- **A row that opens something** has a real button as its title, stretched over the row (`row()` in `layout.js`,
  `.row-go` in `a11y.css`). Never make a container a button when it holds other controls: a screen reader would not
  reach them.
- **Windows** are named by their title (`aria-labelledby`); pages name the browser tab; a page opened from the menu
  moves the focus to its title; "Skip to the content" is the first Tab stop; `<html lang>` follows the language.
- **Tabs** (the months of the planner) are one Tab stop; arrow keys, Home and End move between them.
- **Touch (Android, iOS).** Targets are at least 24 px, and on touch screens icon buttons and buttons 44 px; fields are
  16 px on touch screens, so iOS does not zoom into them; pinch zoom is allowed; nothing needs a long press (iOS has no
  long-press menu): every menu has a button. The page keeps clear of the notch and the home bar (`env(safe-area-…)`).
- **Calendars** are grids: arrow keys, Home, End, Page Up and Down, Enter, and Shift+F10 or the menu key for a day's
  menu. A day's label starts with what the day shows ("2", "26 Oct") and sums up its lines, which are buttons of their
  own. axe's "label in name" heuristic reports days that have lines: reviewed, on purpose (reading every line on every
  arrow key would be worse for screen-reader users; speech input finds the day by its number and each line by its name).

## App lock, encryption and hidden amounts

Settings › Lock and privacy. What each part does, and does not:

- **PIN (4 to 12 digits).** A screen lock. Stored only as a salted PBKDF2-SHA256 hash (310 000 rounds, 16-byte salt)
  in `runway.lock.v1`, apart from the data, never the PIN itself; compared in constant time. On its own it does **not**
  encrypt anything, and the settings say so: someone with the browser's storage or developer tools can still read the
  data.
- **Lock after:** immediately, 1, 5 or 15 minutes, or 1 hour away (in the background or closed). "Immediately" locks as
  soon as the page goes to the background, so a phone's app switcher shows the lock screen. A reload sooner than the
  chosen time stays open (the app was in use until then).
- **Wrong PINs.** Every 5 wrong PINs: a pause of 30 seconds, doubled each time up to 15 minutes, kept across reloads.
  The number of wrong PINs is written in the activity log at the next unlock.
- **Fingerprint or face** (WebAuthn, a platform authenticator with user verification). Needs a web address (https or
  localhost): a file opened from the device cannot use it, and the settings say why. The credential's public key is
  kept and each unlock's signature, challenge, origin and "user verified" flag are checked. After 5 failed tries only
  the PIN opens the app, until the next unlock.
- **Encrypt the data on this device.** Plans, settings and log are stored sealed with AES-256-GCM under a key made from
  the PIN (PBKDF2, own salt). The key is only in memory while the app is open; a freshly opened app shows nothing until
  the PIN. Fingerprint and face are off then (they cannot make the key). Writes are sealed in the background in order;
  `Store.adapter.settled()` waits for them. The strength is the PIN's: a longer PIN is much harder to try out.
- **Forgot the PIN:** the lock screen can erase the data in this browser (after a tick box saying
  that every plan here is deleted); then restore a
  backup file. There is no other way in, on purpose.
- **Hide amounts until tapped.** Shows `•••` for every amount (pages, charts, notifications); a tap on an amount, or the
  eye button, shows them until Runway goes to the background. The activity log keeps the real amounts.

## Bill reminders

Settings › Reminders: recurring bills and subscriptions, loan payments and one-off payments with a day, on the day or
1, 2, 3 or 7 days before, and overdue ones for a week, until they are ticked as paid (`logic/reminders.js`). They show
as **Due soon** at the top of the Overview, as a notification in the app, and, if allowed, as system notifications; each
payment is told once (`runway.reminded.v1`). With the lock or hidden amounts on, a system notification only says how
many payments are due, never which or how much. Runway has no server, so reminders come only while it is open in a tab
(also in the background); on iPhone and iPad system notifications need the web app on the Home Screen.

`tests/unit/lock.test.js`, `reminders.test.js`, `storage.test.js` and `tests/regression/lock.ui.cjs` (Chrome's virtual
authenticator stands in for a fingerprint) cover them.

## Forecast › Simulation

A range of possible futures learned from the person's history: a fan chart, the chances of going below zero and under
a safety buffer, savings goals, the main risks in words, their own values for anything learned, what-if scenarios side
by side, and a backtest with a calibration indicator. The simulation code is loaded only when the page is opened.
Everything about it (what history exists, the model, the maths, bundle size, tests, limits) is in
[SIMULATION.md](SIMULATION.md).

## Test data

`tests/fixtures/real*.json` are real backups and are ignored by git. Do not publish them. The engine tests need them; replace them with made-up plans before sharing the repository.
