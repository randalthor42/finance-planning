/**
 * @file Shared JSDoc types. No runtime code: import the names in a JSDoc comment, for example
 *   @param {import('../types.js').Plan} plan
 * Editors use these for autocomplete and hints. The single source of truth for the shapes is normPlan (models/plan.js)
 * and project (logic/projection.js); keep this file in step when either changes.
 */

/**
 * @typedef {object} Settings
 * @property {string} currency ISO code, for example "EUR".
 * @property {'eu'|'us'} numFmt 1.234,56 or 1,234.56.
 * @property {'dmy'|'mdy'} dateFmt
 * @property {string} startMonth First month of the plan, "YYYY-MM".
 * @property {number} horizon How many months are planned.
 * @property {number} opening Cash at the start of the first month.
 * @property {number} cushion Balance you do not want to go under.
 * @property {boolean} cents Show and round to cents.
 * @property {number} hoursMonth Working hours a month (for the "hours of work" tool).
 * @property {number} payDay Day of the month the salary arrives; 0 means calendar months.
 * @property {'none'|'next'|'prev'} payShift What happens when the payday is on a weekend.
 * @property {'same'|'next'} payFor Whether a salary pays for the month it arrives in or the month after.
 */

/**
 * @typedef {object} Plan
 * @property {string} id
 * @property {string} name
 * @property {Settings} settings
 * @property {object[]} accounts { id, name, type: 'debit'|'cash'|'savings'|'credit', balance, limit, owed, apr, main }
 * @property {object[]} incomes Recurring money in: { id, name, amount, cat, every, from, to, day, shift, account }
 * @property {object[]} bills Recurring money out, same fields plus { budget, vary, payTo, untilLoan }
 * @property {object[]} items One-offs and logged spends: { id, name, amount, kind: 'out'|'in', month, date, cat, budget, account, cover }
 * @property {object[]} trips { id, name, kind: 'trip'|'event'|'idea', month, from, to, on, budget, reserve, items: [{ id, name, amount, pay }] }
 * @property {object[]} loans
 * @property {object[]} goals Savings goals: { id, name, on, target, saved, monthly, from, to, by, rate, release }. `on: false` keeps the pot but adds nothing.
 * @property {object[]} wishes Wishlist.
 * @property {Object<string, Object<string, number>>} overrides One month only amounts: { "YYYY-MM": { entryKey: amount } }
 * @property {Object<string, Object<string, boolean>>} reserveOver One month only choice for a budget: { "YYYY-MM": { entryKey: true (reserved) | false (tracked) } }
 * @property {Object<string, Object<string, (true|{d: string, a: ?string, v: number, t: ?string})>>} paid Ticks: { "YYYY-MM": { entryKey: tick } }
 * @property {Object<string, {d: ?string, a: number}>} fixes One correction per month from real money.
 * @property {Object<string, string>} notes
 * @property {{accounts: object[], incomes: object[], bills: object[], items: object[], trips: object[], loans: object[], goals: object[], wishes: object[], tripItems: object[]}} deleted
 *   Deleted records, never read by totals or the projection: the newest 500 of each kind in full, older ones (up to
 *   5,000) as markers `{ id, createdAt, updatedAt, deletedAt }`. A trip cost also has `tripId`.
 * @property {Object<string, ?number>} fieldsUpdatedAt When each of the plan's own fields last changed (name, settings,
 *   fixes, overrides, reserveOver, paid, notes), epoch ms.
 * @property {Object<string, {base: number, at: Object<string, number>}>} keysUpdatedAt For the month maps (fixes,
 *   notes, overrides, reserveOver, paid): when each month, or month and line ("2026-01 bill:ab12"), last changed. A
 *   path not in `at` has the time `base`.
 * @property {number} createdAt Epoch ms. Every record in the lists has createdAt, updatedAt and deletedAt too.
 * @property {number} updatedAt Epoch ms: the last save that changed the plan or one of its records.
 * @property {null} deletedAt A live plan; a deleted plan is a DeletedPlan in the database.
 */

/**
 * Sync metadata every record carries (accounts, incomes, bills, items, trips, trip costs, loans, goals, wishes), set
 * only by stampPlan (models/records.js).
 * @typedef {object} RecordMeta
 * @property {string} id
 * @property {number} createdAt Epoch ms.
 * @property {number} updatedAt Epoch ms: the last save that changed this record.
 * @property {?number} deletedAt Epoch ms, or null while the record is live.
 */

/**
 * The stored database (localStorage, normDB in models/db.js).
 * @typedef {object} Database
 * @property {number} schemaVersion The data format (APP.schema); older data is migrated at start (models/migrations.js).
 * @property {Object<string, Plan>} plans
 * @property {?string} active The open plan's id.
 * @property {Object<string, {id: string, createdAt: number, updatedAt: number, deletedAt: number}>} deletedPlans
 *   Deleted plans, as markers, so that a deletion reaches other devices (at most 100).
 */

/**
 * One line of one month in the ledger.
 * @typedef {object} Entry
 * @property {string} key Stable id inside the month, for example "bill:<id>" or "trip:<tripId>:<costId>".
 * @property {'inc'|'bill'|'item'|'trip'|'loan'|'wish'|'goal'|'adjust'} group
 * @property {string} label
 * @property {number} amount Signed: money in is positive, money out negative.
 * @property {?number} date Day number, or null when the line has no fixed day.
 * @property {boolean} paid Ticked, or a logged spend.
 * @property {number} still The part of the amount that is still to come (0 when paid).
 * @property {{planned: number, spent: number, left: number, closed: boolean, done: boolean}} [budget] Only on "up to" budgets.
 */

/**
 * One projected budget month.
 * @typedef {object} Month
 * @property {number} k Month index (year * 12 + month).
 * @property {string} key "YYYY-MM".
 * @property {number} start First day (day number).
 * @property {number} end Last day (day number).
 * @property {Entry[]} entries
 * @property {number} open Balance at the start.
 * @property {number} inc Money in.
 * @property {number} out Money out.
 * @property {number} net inc - out.
 * @property {number} now What you should have right now: open + every paid line.
 * @property {number} todo Everything that is not paid yet (signed).
 * @property {number} close Balance at the end: now + todo.
 * @property {?{d: ?number, a: number}} fix The correction of this month, if any.
 * @property {'ok'|'tight'|'neg'} status
 * @property {number} cardDebt
 * @property {number} debt
 * @property {number} savings
 * @property {number} worth
 */

/**
 * One thing on a calendar (components/calendar.js). Anything dated can be shown: a page builds these from its data,
 * and logic/calendar.js normEvents cleans them. entryEvents and tripEvents build them from the plan.
 * @typedef {object} CalendarEvent
 * @property {string} id Unique among the events shown.
 * @property {string} title
 * @property {?number} date Day number (D.of) or 'YYYY-MM-DD'; null means "no fixed day" in the month shown.
 * @property {?number} [end] Last day, for something that lasts several days (a trip): drawn as a bar across them.
 * @property {?number} [amount] Signed like a ledger line: money in is positive, money out negative. Null when none.
 * @property {string} [group] Key of a group given to the calendar: its legend entry, colour and filter.
 * @property {string} [tone] Colour of this event only: good, bad, warn, acc, cash, save, debt, trip, wish, muted.
 * @property {string} [color] Any CSS colour for this event only; wins over tone.
 * @property {string} [sub] A second line in lists and tooltips.
 * @property {boolean} [done] Paid or received: drawn quieter.
 * @property {*} [data] Anything the page wants back in onEvent (the plan adapters keep the ledger line here).
 */

export {};
