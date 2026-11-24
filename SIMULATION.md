# Forecast › Simulation

A range of possible financial futures, learned from the person's real history, instead of one projection. It is the
last way of looking ahead in **Forecast** (it replaces "Range of outcomes", see the review below). Everything runs in
the browser, offline: no network call, no data leaves the device, no new dependency (plain JS and a 15-line seeded
generator).

> Simulations are estimates based on your past behaviour, not financial advice. (The page says so, always.)

## 1. What was there: inspection

### Data model (what history exists)

A plan (`models/plan.js` `normPlan`, shape in `types.js`) keeps:

| Part | What it holds | History? |
|---|---|---|
| `items` | one-offs: purchases, spends logged against a budget, money received, up to 5 000, each with a budget month and usually a day | **yes**: the main source. Kept when the plan is rolled forward (`Actions.rollForward` only moves `startMonth`), so items older than the plan's first month stay. |
| `overrides` | an amount changed for one month (`"YYYY-MM" → { "inc:<id>": 1800 }`) | **yes**: what an income or a bill really was that month |
| `paid` | ticks per month, with the day and account | yes, but a tick repeats the planned amount: it says *that*, not *how much* |
| `fixes` | one correction per checked month ("I really have X") | yes: unplanned spending in total, not by category |
| `incomes`, `bills`, `loans`, `goals`, `wishes`, `trips`, `agenda` | what is planned (recurring or dated) | no: the plan itself |
| `settings.startMonth`, `horizon` | the months the projection covers (3 to 120) | the projection has **no past months** before `startMonth` |

**How far back history goes** depends on the person: as far back as their first logged item (at most 5 000 items).
There is no fixed limit and no imported bank history. The simulation uses the complete budget months before the
current one, from the first with data, at most **24** (`WINDOW_MAX`). The **sample plan has no complete month of
history** (3 logged spends, all in the current month; no overrides, ticks or corrections), so on it every range is a
wide guess, flagged as such: that is the "no history" path, and it is tested.

### Projection logic

`logic/projection.js` `project(plan, { today })` turns the plan into months: every income, bill, budget, loan payment,
trip cost, wish instalment, savings transfer, counted appointment and logged item as a ledger line, then balances.
A budget line is the amount still set aside (the budget minus what was logged). It is **fully deterministic**: the
same plan and day always give the same numbers, and nothing in it is random or learned.

### Report types that existed

| Where | What |
|---|---|
| Forecast › As planned | the projection by month or year (table, CSV) |
| Forecast › Your real overspend | costs raised by the overrun measured in checked months (budget variance) |
| Forecast › Like the next months / Weighted pace / Follow the trend | the next N *planned* months as a ceiling: average, exponential smoothing, damped trend |
| Forecast › Costs run higher / Income drops | stress tests by a percentage |
| Forecast › Range of outcomes | a Monte Carlo "range" (reviewed below) |
| Review | one month or one year: money in and out, categories, budgets, what went well, what to watch |
| Audit | the whole ledger and consistency checks |
| Overview | insights, the next 7 days, the cash chart |
| Export CSV | the plan, the forecasts |

**Already deterministic:** `project()`, every forecast scenario, the Review and the Audit. Even the old Monte Carlo was
seeded (mulberry32 with a fixed seed).

### Review of the Forecast section

- **Range of outcomes was misleading.** Its "realistic ups and downs" were bootstrapped from the plan's *next planned
  months*, not from anything that happened: the spread was the spread of the plan itself (a month with a trip against
  one without), and it said "realistic". It also capped later months at the sample average before adding shocks, and
  ran a fixed 2 000 runs over the whole plan. **Replaced** by Simulation, which learns from history. Two Monte Carlo
  views giving different answers would only confuse. Its seeded generator moved to `core/random.js` (still exported
  as `seededRandom` by `logic/forecast.js`, same numbers).
- **Pace / Weighted pace / Follow the trend** are honest about what they are (the next *planned* months as a ceiling)
  and keep fixed parameters because a handful of months cannot fit them. Kept.
- **Your real overspend** is the only one based on what happened (corrections against planned costs). Kept.
- **The month planner's forecast view** can show the simulation's middle (median) line too. It runs in the background
  and the planner shows the plan until it is ready.

## 2. Learning from history (`logic/sim/fit.js`)

Everything here is pure: plan in, numbers out (no text; the page words it).

**Recurring items vs variable spending.** Bills, subscriptions, loans, planned one-offs, trips, wishes and counted
appointments are **taken as planned** (`logic/sim/baseline.js`): the plan already knows them. The simulation replaces:
budget lines (the plan sets an amount aside; the simulation uses the real everyday spending of that category), spends
logged ahead against a budget, recurring income lines (income model below), savings goals (see below), and
freelance income logged one by one.

**Everyday spending per category.** Each purchase and spend counts in its category (a spend against a budget in the
budget's category: "Supermarket, from Groceries" is food). For each category, the monthly totals from its first month
with spending to the last complete month give:

- the **median** (the usual month) and the **MAD** (median absolute deviation: how far a month usually is from the
  usual month), plus the 10th / 25th / 75th / 90th percentiles. One wild month barely moves them (tested: a 900 month
  among 300s leaves the median at 302.5 and the MAD at 7.5; the mean jumps to 352);
- the months themselves, for an **empirical bootstrap**: the simulation resamples real months instead of assuming a
  bell curve, because spending is skewed (a month can cost twice the usual, hardly ever nothing). One past month is
  drawn for **all categories together** (a holiday month costs more in several categories at once).

**Large irregular expenses (rare events).** A purchase is large and irregular when it is at least 4× the median
purchase and at least half a median month of everyday spending (with at least 6 purchases to compare). Those are
taken out of everyday spending and modelled as a **Poisson process**: frequency per year = count / years of history
(with at least half a year assumed, so one event in two months is not "6 a year"), sizes resampled from the real ones.

**Income.**
- A recurring income whose amount varied (overrides in at least 3 months, MAD above 2% of the median) is **variable**:
  each payment is the planned amount times one of the real months against the median (bootstrapped ratios).
- A freelance income (category "side") without that history is variable with a **wide fallback** range, flagged low.
- Everything else, a salary, is **fixed**: as planned. Its risks are the person's to set: a chance a payment is late
  (it arrives the month after), and lasting changes: a chance per year of a cut or a raise, and by how much.
- Freelance income logged one by one (items of category "side", when no recurring line is freelance) is learned like
  a spending category, as money in.

**Too little data.** A category with fewer than **3 months** of data (`MIN_MONTHS`) is not learned: the best guess
(the budget if there is one, else the mean of what there is) is spread with a wide, right-skewed shape
(`FALLBACK`: ×0.45 … ×2, median ×1) and **flagged "low confidence"** on the page. A budget with nothing logged for
months is not taken as "spends nothing" (the person may not log it): the budget is used, flagged. Rare events are
"low" with fewer than 3 events or 6 months.

**Own values.** Every fitted parameter can be set by hand (**What it learned › Change**), saved in the plan
(`plan.sim`, `models/sim.js`, so in backups, Undo and the activity log):
- a category: its usual month and how much it varies, or left out. The shape of the real months is kept:
  `value = usual' + (past month − median) × spread' / MAD`;
- rare events: how many a year, typical size, or left out;
- an income: fixed or varies (and how much), chance of a late payment, chance and size of a cut or a raise.
"Use what was learned" forgets them.

## 3. The simulation (`logic/sim/engine.js`)

Monte Carlo, **2 000 runs by default, 100 to 10 000**, over **3, 6, 12 or 24 months** (cut to the plan's own months,
and it says so). Each run, each month:

```
balance += the plan's certain lines
         + each income: as planned, or × a learned ratio; late or changed by the person's risks
         − everyday spending: one past month drawn for all categories
         − rare events: a Poisson number, each as big as a past one
         ± what the what-if changes
then each savings goal takes its monthly amount, only from money that is there;
a goal released this month comes back to cash.
```

The current month starts from what you have now and only simulates the part still ahead. A month that runs short
**cannot put money aside**, so goals can slip; this is what makes a goal uncertain.

**Seeded**: mulberry32 (`core/random.js`). The same plan, settings and seed give exactly the same result (tested);
"Try another seed" shows how much the numbers move by chance alone. 10 000 runs are done in chunks of 1 000 with a
pause for the page in between (`simulateInChunks`); the result is identical to one go (tested).

**Output** (all rounded on the page, see §6):
- a **fan chart**: the median line, the 50% band (25th–75th percentile) and the 90% band (5th–95th) of the balance at
  each month end, against zero, the safety buffer and the plan's own line; hover or touch for a month's numbers; the
  same in a table ("Month by month") and a CSV;
- the **chance of the balance going below zero** and **under the safety buffer** (the plan's cushion unless set), at
  any month end within the horizon;
- **savings goals**: the chance of reaching each by its date (when the date is within the horizon), and the month by
  which it is reached in half and in nine in ten of the futures; when even the plan itself cannot make the date
  (payments too small), the page says so instead of blaming chance, and a goal without a date that simply takes
  longer than the months simulated is long-term, not a risk;
- **months until the balance hits zero in the worst 1 in 10** (the 10th-percentile path);
- **the main risks** in plain words (`logic/sim/risks.js` → ids and numbers, worded by the page): below zero and when,
  the worst 1 in 10, the buffer, goals at risk, the plan expecting more than history suggests, what drives the
  uncertainty (the sources whose middle half of runs lies furthest apart), rare events, too little history, low
  confidence, a backtest that missed, a horizon cut short.

**What if** (`plan.sim.scenarios`): a name and up to 8 changes, each from a month: income changes by a percentage, a
new cost every month, a one-off purchase, saving more (or less) every month into a goal or set aside. The baseline and
the scenario run **side by side with the same random futures** (common random numbers: the draws never depend on the
scenario), so the difference is the what-if alone: a one-off of 800 lowers every later median by exactly 800 (tested).
The page shows both (chances, middle and worst 1 in 10 at the end, each goal) with the difference, and draws the
scenario on the chart. The plan itself is not changed.

## 4. Backtest and calibration (`logic/sim/backtest.js`)

The latest **3 complete months are hidden**, the model is learned from the months before them only, their spending
is simulated (everyday spending and rare events: the part the model learns; the plan's certain lines are known
anyway), and what really happened is compared with the bands, month by month, cumulatively: inside the middle half
(50% band)? inside nine in ten (90% band)?

One window says little, so the same is done from every earlier starting point with at least 3 months before it (up
to 12 of them): how often reality fell inside the bands is the **calibration**. The page shows one indicator:

| Verdict | Meaning |
|---|---|
| Trustworthy for your data | inside nine in ten at least 80% of the time, the middle half 30–80%, and the last 3 months inside |
| Roughly right | inside nine in ten at least 60% of the time (or one of the last 3 months outside) |
| Not trustworthy now | worse, or the last months missed although earlier ones fitted (habits changed) |
| Too little history to tell | fewer than 5 checks (a clear miss of the last months is still said) |

The verdict is the worse of "the last 3 months" and "every earlier check". Own values are not used: the backtest checks
what was learned. Needs at least 6 months of history (3 to learn from, 3 to check).

## 5. Offline, privacy and bundle size

- No network: the page makes no request (tested: every request of the browser test is `file:` or `data:`); the strict
  Content Security Policy of the build (`default-src 'none'`) is unchanged.
- **The simulation code is not in the start-up code.** `vite.config.js` `lazySimulation` builds `logic/sim` on its
  own (Vite's own `build()`, no new dependency) as one script that sets `globalThis.RunwaySim`, and puts it in the page
  as inert text (`<script type="text/plain" id="runway-sim">`): the browser neither parses nor runs it. The first time
  Forecast › Simulation is opened, `services/lazySim.js` runs it as an inline script (allowed by the existing policy:
  nothing fetched, no `blob:`, no `eval`). Its date helpers' import of the app's formatting and languages is replaced
  by a stub, so it has no second copy of the translations. In development it is an ordinary `import()`, removed from
  builds.
- **The list of every text for "Export language" is not start-up code any more either.** It was an array literal in
  the main script (1 743 texts, 13% of it) evaluated at every start only for "Export language" and the Language card;
  it now waits in the page as inert JSON and is read the first time it is needed (`I18N.useKeys`, tested). The
  exported language file is identical.

Production build (`npm run build`), bytes (gzip level 9):

| | Before feature 2 | After | Difference |
|---|---:|---:|---:|
| Start-up JavaScript | 382 149 (135 205) | **358 083 (127 722)** | **−24 066 (−7 483)** |
| Simulation, run on demand | – | 17 100 (7 233) | +17 100 (+7 233) |
| Texts for "Export language", read on demand | (in start-up JS) | about 60 000 as JSON | moved |
| Whole file (`dist/index.html`) | 435 258 (146 677) | 486 400 (165 780) | +51 142 (+19 103) |

Without moving the texts, the start-up JavaScript would have grown by 31 490 bytes (+10 100 gzip): the page, its two
windows and the fan chart are ordinary page code, and every new sentence was stored twice (in the code and in the
list). Start-up time was measured A/B (the file before and after, alternating, a fresh page per load, 4× CPU
throttling, 24 loads each): script time 380 vs 385 ms, total task time 807 vs 773 ms, within this machine's noise; V8
parse and compile of the start-up script 14.5 vs 14.2 ms (V8 compiles functions lazily). So the honest claim is: the
feature adds nothing to start-up, and the start-up code is 24 KB smaller than before it.

Simulation speed (Node, this machine): fitting 2 ms; 2 000 runs × 24 months × 10 categories 38 ms; 10 000 runs 118 ms
(in chunks, the page stays responsive); backtest 37 ms.

## 6. Presentation: no false precision

- Chances: "under 1%", whole percents under one in ten, steps of 5% above, "over 99%": never "0%" or "100%"
  (`ui/simFormat.js`, tested). In sentences: "about 35%".
- Amounts of the future: two significant figures ("about €13,000", "€11,000 to €14,000"), in the plan's currency,
  number and date format (`money`, `M.label`). Amounts of the past (what was really spent) are exact.
- The page says when it is guessing: no history, fewer than 3 months, low confidence per category, a horizon cut
  short, a backtest that missed.
- The disclaimer is always on the page.

## 7. Tests

| File | What |
|---|---|
| `tests/unit/simStats.test.js` | seeded generator (same seed, same numbers; Poisson mean), median, MAD (robust to an outlier), quantiles |
| `tests/unit/simulation.test.js` | fitting on known synthetic data (median 302.5, MAD 7.5 with an outlier month; budget spends in the budget's category; a large purchase as a rare event with its frequency; salary fixed, freelance learned or wide); edge cases: no history, one month of history, an all-zero budget category, a negative starting balance, a plan shorter than the horizon; determinism with a fixed seed; "nothing uncertain = the plan"; probabilities; goals (and a goal the plan cannot make); own values; what-if (exact difference with common random numbers); chunked runs identical; risks; backtest (steady data inside the bands; a sudden change outside and called untrustworthy; too little history); settings cleaning |
| `tests/unit/simActions.test.js` | settings, own values and scenarios saved, written in the activity log, undoable, projection kept |
| `tests/unit/simFormat.test.js` | rounding of chances and amounts |
| `tests/unit/i18nKeys.test.js` | the texts for "Export language" read once, on first use |
| `tests/regression/simulation.ui.cjs` | in a browser: lazy loading, the policy, no network requests, no history, a plan with 14 months of history, the fan chart, chances, goals, own values, settings, what if, backtest, the month planner view, a phone |

## 8. Assumptions and limits

- Months are independent draws of past months: no seasonality (December is not known to cost more) and no trend in
  spending; a change of habits shows up in the backtest verdict, not in the bands.
- Month ends only: a balance that dips below zero in the middle of a month and recovers by its end is not counted.
- Cash only: savings pots and debt are not simulated, except that goals only take money that is there.
- Planned future one-offs are taken as planned, next to the learned everyday spending of their category; the rare
  events stand for large *unplanned* purchases.
- Income ups and downs are learned only from amounts changed for one month (overrides); ticks repeat the planned
  amount. Salary risks (late, cut, raise) are the person's own numbers: there is nothing to learn them from.
- The backtest checks spending, the part that is learned; it cannot check the person's own values.

## 9. Files

`src/core/random.js` · `src/logic/recurs.js` · `src/logic/sim/` (`fit.js`, `baseline.js`, `engine.js`, `backtest.js`,
`risks.js`, `stats.js`, `index.js`) · `src/models/sim.js` · `src/services/lazySim.js` · `src/ui/simRun.js` ·
`src/ui/simFormat.js` · `src/ui/views/simulation.js` · `src/ui/modals/simOverride.js` · `src/ui/modals/scenario.js` ·
`fanChart` in `src/ui/components/charts.js` · `src/styles/sim.css` · `vite.config.js` (`lazySimulation`, `i18nKeys`).
