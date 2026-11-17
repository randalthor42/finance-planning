# Runway data model

The shape of everything Runway stores, at **schema 8**. How it is stored, saved and migrated is in
[docs/data.md](docs/data.md). Everything is on the person's device: there is no server of ours. The one copy that can
leave it is the Google Drive sync file, only when the person turns sync on ([docs/sync.md](docs/sync.md)), in their own
Drive, optionally encrypted.

## Where it lives

| Store | What | Key |
|---|---|---|
| localStorage | the **database** (below): plans, browser preferences, activity log | `runway.db.v1` |
| localStorage | language packs | `runway.i18n` |
| localStorage | the data file's sync record (browser name, base of the last sync) | `runway.db.v1.file` |
| localStorage | a copy of the device id, in case IndexedDB is unavailable | `runway.device` |
| localStorage | Drive sync's state: on or off, the cloud file's id, `modifiedTime`, `version` and ETag at the last sync, `pending` (changes not uploaded yet), `encrypted`, `lastSync` | `runway.drive` |
| IndexedDB `runway` › `kv` | the data file's handle (`file`), the device id (`deviceId`), `indexed:<planId>` marks; Drive sync's access token (`driveToken`, until it expires) and passphrase (`drivePassphrase`, when one is set) | key |
| IndexedDB `runway` › `records` | the record index: every record of every plan, live and deleted | `<planId>/<type>/<id>` |
| IndexedDB `runway` › `backups` | the database text as it was before each migration | auto id |
| a JSON file the person chooses | the data file: the plans, for their other devices (`models/dataFile.js`) | — |
| the person's Google Drive, app data folder | Drive sync's file `runway-sync.json`: the plans and deleted plans (a backup), optionally encrypted | — |

Only `src/services/storage.js` reads or writes localStorage and IndexedDB (a unit test checks it).

## The database (`runway.db.v1`)

```json
{
  "v": 8,
  "schemaVersion": 8,
  "active": "<planId>",
  "plans": { "<planId>": { …plan… } },
  "deletedPlans": { "<planId>": { "id": "…", "createdAt": 0, "updatedAt": 0, "deletedAt": 0 } },
  "theme": "auto", "autosave": false, "toastPos": "tr", "tripView": "grid", "wishView": "grid",
  "designMode": false, "fileSync": true, "fileWatch": true, "layouts": {}, "calendar": {},
  "log": [{ "t": "2026-11-16T10:00:00.000Z", "text": "Added bill “Rent”" }]
}
```

- `schemaVersion`: the schema of this data (`v` is the same number, kept for readers from before schema 7).
- `deletedPlans`: plans deleted in this browser, as stubs (id and dates; their contents are not kept). The newest 100.
- The preferences and the log belong to this browser: they are not records, not in backups or the data file.

## Records

A **record** is one thing a person adds, with an id. Every record has:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | the app's short id (`uid`: 4–16 of `a-z0-9`), or a UUID for a record that arrived without one |
| `createdAt` | epoch ms | when it was first saved |
| `updatedAt` | epoch ms | when it was last saved with a change |
| `deletedAt` | epoch ms or `null` | when it was deleted; `null` while it is live |

These four are set by the store on every save (`models/records.js stampPlan`); no component sets them. A deleted
record is kept, with `deletedAt`, in the plan's `deleted` lists, so nothing that reads the live lists (lists, totals,
charts, the projection, search, exports of live data) ever sees it.

| Type (index `type`) | Plan list | Fields besides the four above |
|---|---|---|
| `plan` | (the plan) | `name`, `settings`, `fixes`, `overrides`, `reserveOver`, `paid`, `notes`, `deleted` |
| `account` | `accounts` | `name`, `type` (debit, cash, savings, credit), `balance`, `limit`, `owed`, `apr`, `main`, `note` |
| `income` | `incomes` | `name`, `amount`, `cat`, `every`, `from`, `to`, `day`, `shift`, `note`, `account` |
| `bill` | `bills` | as an income, and `budget`, `reserve`, `vary`, `payTo`, `untilLoan` |
| `item` | `items` | `name`, `amount`, `kind` (out, in), `month`, `date`, `cat`, `budget`, `account`, `cover`, `note` |
| `trip` | `trips` | `name`, `kind` (trip, event, idea), `month`, `from`, `to`, `on`, `budget`, `reserve`, `note`, `items` |
| `tripItem` | `trips[].items` | `name`, `amount`, `pay`, `note`; when deleted, also `tripId` |
| `loan` | `loans` | `name`, `on`, `amount`, `rate`, `term`, `first`, `day`, `shift`, `note`, `feePct`, `feeMin`, `feeFin`, `payout`, `extra`, `extras`, `early1`, `early2` |
| `goal` | `goals` | `name`, `on`, `target`, `saved`, `monthly`, `from`, `to`, `by`, `rate`, `release`, `note` |
| `wish` | `wishes` | `name`, `price`, `how` (cash, save, finance), `month`, `months`, `apr`, `flex`, `on`, `note`, `link` |

Months are `YYYY-MM` text, days `YYYY-MM-DD` text, amounts numbers with two decimals. The limits of each list, and
the cleaning of every field, are in `models/plan.js normPlan`.

### Not records

Parts of the plan record, changed with it (a change there gives the plan a new `updatedAt`): `settings`, and the maps
by month `fixes` (balance corrections), `overrides` (one month's amount of an entry), `reserveOver`, `paid` (ticks)
and `notes`. Their keys name entries as `<group>:<id>` (`bill:k3j4h5g6`, `trip:<tripId>:<costId>`).

Since schema 8 the plan also keeps **when each of its own fields last changed**, `fieldsUpdatedAt` (`name`,
`settings`, `fixes`, `overrides`, `reserveOver`, `paid`, `notes`; epoch ms, set by `stampPlan` like every date). Sync
merges `name` and `settings` one by one with it. The month maps (`paid`, `fixes`, `overrides`, `reserveOver`,
`notes`) also keep **when each month or line last changed**, `keysUpdatedAt` (`{ field: { base, at: { path: time } } }`,
a path being "2026-01" or "2026-01 bill:ab12"), so a tick made on one device and a tick made on another are both kept
([docs/sync.md](docs/sync.md)).

## A plan

```json
{
  "id": "…", "name": "Household",
  "settings": { "currency": "EUR", "numFmt": "eu", "dateFmt": "dmy", "startMonth": "2026-11", "horizon": 120, … },
  "accounts": [], "incomes": [], "bills": [], "items": [], "trips": [], "loans": [], "goals": [], "wishes": [],
  "fixes": {}, "overrides": {}, "reserveOver": {}, "paid": {}, "notes": {},
  "deleted": {
    "accounts": [], "incomes": [], "bills": [], "items": [], "trips": [],
    "loans": [], "goals": [], "wishes": [], "tripItems": []
  },
  "fieldsUpdatedAt": { "name": 1794860000000, "settings": 1794860000000, "fixes": 1794860000000,
    "overrides": 1794860000000, "reserveOver": 1794860000000, "paid": 1794861000000, "notes": 1794860000000 },
  "createdAt": 1794860000000, "updatedAt": 1794861000000, "deletedAt": null
}
```

`deleted.<list>` holds deleted records of that kind, oldest deletion first: the newest 500 of each kind complete, and
older ones, up to 5,000, as markers `{ id, createdAt, updatedAt, deletedAt }`. A deleted trip keeps its costs inside it; a cost deleted from a live trip is in
`deleted.tripItems` with its `tripId`.

## The record index (IndexedDB `records`)

One entry per record, for queries a future sync needs:

```json
{ "key": "<planId>/<type>/<id>", "planId": "…", "type": "bill", "id": "…",
  "createdAt": 0, "updatedAt": 0, "deletedAt": null, "data": { …the record… } }
```

Indexes: `updatedAt` (everything, by last change), `deletedAt` (deleted records only: IndexedDB leaves out entries whose
key is `null`), `planId`, `type`. The plan entry's `data` is the plan without its lists. A deleted plan is one entry
(its stub); its records leave the index with it.

## Files

- **Backup** (Settings › Backup): `{ app: "runway", kind: "backup", v: 8, exported, plans: [ …plans… ] }`, optionally
  encrypted (`{ app, kind: "encrypted", v: 1, kdf, cipher, iter, salt, iv, zip: "gzip", data }`: gzip, then
  AES-256-GCM). Plans include their dates and deleted lists. Importing one shows first what merging would change.
- **Drive sync file** and **QR transfers**: the same backup, with `deletedPlans` (and `by`, the device that wrote it);
  QR transfers are always encrypted, with the one-time code ([docs/qr-transfer.md](docs/qr-transfer.md)).
- **Data file** (Settings › Storage): `{ app: "runway", kind: "data", v: 8, saved, by, deletedPlans, plans }`,
  merged record by record like Drive sync (README › Storage).
- Both open in older schemas too: every plan goes through `normPlan`, and one without dates gets them when it is added.
