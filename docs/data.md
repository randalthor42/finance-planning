# Data: storage, records, migrations

How Runway stores data and why, for the sync work to come. The shape of every record is in
[../data_model.md](../data_model.md). Everything here runs on the device. Moving data between devices (Drive sync, QR
transfer, the data file) is built on top of it: see [sync.md](sync.md) and [qr-transfer.md](qr-transfer.md).

## 1. One data access module

`src/services/storage.js` is the only code that touches the browser's storage: localStorage and IndexedDB. A unit
test (`tests/unit/migrations.test.js`, "only services/storage.js touches the browser storage") fails if any other
file names `localStorage`, `sessionStorage`, `indexedDB`, `IDBKeyRange` or `document.cookie`.

| Who | Uses |
|---|---|
| `state/store.js` (the store) | `LocalStorageAdapter`: the database, backups, the record index |
| `state/fileSync.js` (the data file) | `readJSON`/`writeJSON` for its sync record; `kv` (via `services/handleStore.js`) for the file handle |
| `core/i18n.js` (translations) | `readJSON`/`writeJSON` for language packs: the one import from a lower layer to a higher one, because the language must be known before any text is made |
| `main.js` | `deviceId()` at start |

No component (nothing in `src/ui/`) reads or writes storage. Pages read the store's state (`Store.plan`, `Store.db`)
and change it only through `Actions` and the store's methods.

## 2. The one place records are saved

Every change to a plan goes through the store (`state/store.js`): `commit` (every action), `undo`/`redo`,
`addPlan`, `renamePlan`, `removePlan`, `replacePlans` (merges from the data file), `adoptMerged` (merges from Google
Drive, a QR transfer or an imported backup: `models/recordMerge.js`) and `wipe`. On each of them:

1. the changed plan is cleaned by `normPlan` (`models/plan.js`), which keeps every record's `id` (a missing or repeated
   one gets a UUID: `crypto.randomUUID`, or the same format from `crypto.getRandomValues` where it is not available)
   and moves any record carrying `deletedAt` out of the live lists;
2. `stampPlan(previous, next, now)` (`models/records.js`) compares it with the plan as it was:
   - a record like before (dates aside) keeps its dates;
   - a changed record gets `updatedAt = now`;
   - a new record gets `createdAt = updatedAt = now`, `deletedAt = null` (a copy too: it is a new record);
   - a record that is no longer there is **not dropped**: it goes to `plan.deleted.<list>` with
     `deletedAt = updatedAt = now` (a cost of a live trip goes to `deleted.tripItems` with its `tripId`);
   - a deleted record that comes back (undo) is live again with `updatedAt = now`;
   - the plan record gets `updatedAt = now` when anything in it changed (records, settings, ticks, notes…), and
     each of its own fields that changed gets its time in `fieldsUpdatedAt` (schema 8);
   - nothing changed: nothing is saved, no date moves.
3. the result is written (localStorage, at the end of the task) and the record index follows.

Because the dates are set there, from what actually changed, **no component sets them and none can forget them**;
dates set by a page are replaced by the store's (`tests/unit/saves.test.js`). Renaming sets the plan's `updatedAt` (and `fieldsUpdatedAt.name`);
deleting a plan keeps a stub in `db.deletedPlans` (`id`, `createdAt`, `updatedAt`, `deletedAt`; its contents are not
kept, they can be large). Merges from the data file, Google Drive, QR transfers and imports keep the dates of the
device that made each change.

"Delete everything" (Settings › Backup) is the one exception, on purpose: a reset of this browser for privacy, not a
deletion of records. It clears the database, the record index and the migration backups (the device id stays). With Google Drive sync
on, it turns sync off first: the cloud copy is neither emptied nor brought back.

### Deleted records are never counted

Deleted records live in `plan.deleted`, not in the lists. Lists, totals, charts, the projection, search, the
calendar, reviews and audits read only the live lists, so they cannot include them, and `normPlan` moves a record
with `deletedAt` out of a list whatever its origin (an import, a hand-edited file). Tests: "deleted records are
ignored by lists, totals and charts" (`records.test.js`) and "deleting a record keeps it … out of the lists and
totals" (`saves.test.js`). Each kind keeps its newest 500 deleted records in full and older ones, up to 5,000, as
markers (id and dates only), enough to keep the deletion from being undone by another device.

## 3. Schema version and migrations

The database carries `schemaVersion` (8 now; `v`, the same number, is kept for readers from before). The runner and
the migrations are in `src/models/migrations.js`:

- `versionOf(raw)`: `schemaVersion`, or `v` before it existed (1 if neither).
- `migrate(raw)`: applies, in order, every migration with `to` above that version, on the data as read (before
  `normDB` cleans it); sets `schemaVersion` and `v` after each. Data from a newer version is left alone.
- `MIGRATIONS`: `{ to, name, up(db, { now }) }`. A migration only adds or reshapes and is idempotent.

**Migration 7** (sync-ready records): every plan and every record in it gets `id` (a UUID only when missing: existing
ids are kept, every reference to them stays valid), `createdAt` and `updatedAt` (the time of the migration, when
unknown; dates already there are kept) and `deletedAt: null`; each plan gets empty `deleted` lists; the database gets
`deletedPlans: {}`. Nothing else changes: `tests/unit/migrations.test.js` compares all the data before and after.

**Migration 8** (field times, for sync): each plan gets `fieldsUpdatedAt`, the time each of its own fields (`name`,
`settings`, `fixes`, `overrides`, `reserveOver`, `paid`, `notes`) last changed, filled with the plan's `updatedAt`
(the best that is known). From then on `stampPlan` sets each one when that field changes, so sync can merge a tick
made on one device with a note made on another ([sync.md](sync.md)). Nothing else changes.

### When it runs

Automatically, at start (`PlanStore.init`), when the stored data is older than the app:

1. the stored text is read and migrated **in memory**; the app opens on the migrated data at once;
2. a **backup** of the stored text, exactly as it was, is kept: IndexedDB `runway` › `backups`
   (`{ id, at, from, to, applied, text }`), or localStorage `runway.db.v1.backup.v<from>` if IndexedDB fails;
3. only then is the migrated data written. Until the backup is kept, writes wait (`store.holding`): a change made
   meanwhile is kept in memory and written right after. If no backup can be kept at all, the data is still migrated
   (a migration only adds, so nothing is lost) and the activity log says so;
4. the activity log gets a line ("Your data was updated to format 8…"), and the record index is rebuilt.

Imported backups and data files from older versions need no migration step: each plan passes through `normPlan` and
`addPlan` (or the data file's merge), which give the missing dates.

### Running it again

It is idempotent: running it again only fills what is missing.

- **In the app**: make the stored data look older, then reload. In DevTools on the app's page (Application › Local
  storage, or the console):

  ```js
  const db = JSON.parse(localStorage.getItem('runway.db.v1'));
  db.schemaVersion = 6; db.v = 6;
  localStorage.setItem('runway.db.v1', JSON.stringify(db));
  location.reload(); // migrated again, after a new backup
  ```

- **On a file**, with Node (no browser needed), using the same runner:

  ```sh
  node scripts/migrate.mjs <input.json> [output.json]
  ```

  The input can be the stored database (the value of `runway.db.v1`, or a backup's `text`), an exported backup
  (not encrypted) or a data file; the output keeps its shape (a backup stays a backup, so *Import backup* opens it).
  Without an output file the data goes to stdout and the messages to stderr. An encrypted backup: import it in the
  app, which migrates it, then export it again.

### Restoring a backup

In DevTools on the app's page:

```js
const open = indexedDB.open('runway');
open.onsuccess = () => {
  const get = open.result.transaction('backups').objectStore('backups').getAll();
  get.onsuccess = () => {
    const last = get.result.at(-1); // { at, from, to, text }
    localStorage.setItem('runway.db.v1', last.text);
    location.reload(); // the app migrates it again (and keeps a new backup first)
  };
};
```

Or save `last.text` to a file and run `scripts/migrate.mjs` on it.

### Adding a migration

Append `{ to: 9, name, up(db, { now }) }` to `MIGRATIONS`, raise `APP.schema` to 9 (`src/config.js`), teach `normPlan`
or `normDB` the new shape, and add a test next to the ones for 7 and 8. Files written with the new schema are refused by
older apps ("made by a newer version"), which protects the data from them.

## 4. Device id

`deviceId()` (`services/storage.js`): a random UUID made on the first launch, kept in IndexedDB `kv` › `deviceId`
(and in localStorage `runway.device`, if IndexedDB is unavailable), the same on every later start. `main.js` puts it
in `Store.deviceId`. It names this browser installation and nothing about the person; "Delete everything" keeps it.
(The data file's "saved by" uses its own short browser name, from before.)

## 5. The record index (IndexedDB)

IndexedDB `runway` (version 2) › `records` holds every record of every plan, live and deleted, keyed
`<planId>/<type>/<id>`, with indexes on **`updatedAt`**, **`deletedAt`**, `planId` and `type`. It is a copy kept in
step with the database (which stays the source of truth), for the queries a sync will make:

```js
import { records } from './services/storage.js';
await records.changedSince(lastSync); // every record saved with a change since then (live or deleted)
await records.deleted();              // deleted records only (a live record's deletedAt is null: not indexed)
await records.ofPlan(planId);         // one plan's records
```

How it stays in step:

- after each save, the records `stampPlan` gave new dates (and the plan record) are written, gathered into one
  transaction per task, with the plan's mark `kv` › `indexed:<planId>` = its `updatedAt`;
- at start (when idle), after a migration, after a merge from the data file and after adding a plan, `Store.reindex()`
  rebuilds any plan whose mark is not its `updatedAt`, 50 records per transaction, each part in a quiet moment (an idle callback), so none is a long task;
- a failed write changes nothing in the database; the next start rebuilds. Deleting the marks forces a rebuild.

## 6. Sizes and performance

- The four fields add about 70 characters per record: the heavy test data (two 10-year plans of 4,700 transactions
  each, and a third, 10,309 records) grows from 1.75 M to 2.46 M characters. Chromium's localStorage holds about
  5.2 M characters; Firefox and Safari document about 5 MB. The storage meter in Settings assumes 5 MB.
- Saving compares records field by field (no text per record) and writes only the changed ones to the index.
- The migration's write and the index rebuild run after the first paint; the rebuild works in parts of 50 records, each in an idle callback.
- Lighthouse (mobile, 3 runs each, in turns, medians; `node scripts/lighthouse.mjs pair 3 <before> <after> 6 7`),
  the build before these changes with the heavy data in schema 6 against this one with it in schema 7:

  | | before | after |
  |---|---:|---:|
  | Performance | 90 | 92 |
  | Accessibility, Best practices, SEO, Agentic browsing | 100 | 100 |
  | LCP | 1681 ms | 1611 ms |
  | TBT | 379 ms | 321 ms |
  | CLS | 0 | 0 |
  | Main-thread work, whole run | 1.8 s | 4.5 s |

  The extra main-thread work is the first build of the record index (10,309 records), which every Lighthouse run
  pays because it starts from an empty browser profile; in a browser that has it, it is current at start and nothing
  is rebuilt (`storage.ui.cjs`: "reload: the record index is current"). Being made of parts of 50 records in idle
  callbacks, it adds no blocking time.

## 7. Tests

| Test | What |
|---|---|
| `tests/unit/records.test.js` | stampPlan: new, changed, unchanged, deleted, restored records; trip costs; ids; the 500 limit; deleted records not counted |
| `tests/unit/saves.test.js` | every action, undo/redo, rename, delete, import on the real store with a clock: the dates are always set |
| `tests/unit/migrations.test.js` | the runner; migrations 7 and 8 keep all data and are idempotent; backup before write; the CLI; only storage.js touches storage |
| `tests/unit/recordMerge.test.js`, `driveSync.test.js` | merging record by record; Drive sync between devices ([sync.md](sync.md)) |
| `tests/regression/storage.ui.cjs` | in Chromium: migration of a heavy plan with its backup, the device id across reloads, the record index and its queries, "Delete everything" |

```sh
npm test                 # unit tests
npm run test:storage     # the browser test (builds dist-test first)
```
