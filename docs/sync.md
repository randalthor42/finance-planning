# Using Runway on several devices

Runway keeps every change on the device first (the browser storage, and the data file when one is chosen), so it
opens at once and works offline. To have the same plans on a computer, a phone and a tablet there are four ways, all
in **Settings › Storage** (and on the welcome screen of a new device):

| Way | Network | Account | How it stays in step | Code |
|---|---|---|---|---|
| **Data file** in a synced folder | the folder's own sync client | none of ours | every change, both ways (computers with the File System Access API) | `state/fileSync.js`, README "Storage" |
| **Google Drive sync** | Google Drive | the person's Google account | every change, both ways, record by record | `state/driveSync.js` (this page) |
| **QR codes** | none | none | once, when sent | `ui/modals/qrTransfer.js`, [qr-transfer.md](qr-transfer.md) |
| **Backup file** (export, import) | none | none | once, when imported | `ui/modals/backup.js` |

Drive sync, QR transfers and importing a backup all merge with the same rules (`models/recordMerge.js`, below).
Importing a backup or receiving QR codes first shows what would change (`ui/modals/importPreview.js`): **Merge**, or
**Add as separate copies** (what importing always did), or Cancel.

## Google Drive sync

### What the person sees

- *Turn on sync* (Settings › Storage, or *Sync with Google Drive* on the welcome screen): Google's window asks to
  let Runway use **its own app folder** in their Drive (the `drive.appdata` scope). Before the first sync touches
  anything, a backup of this device's data is kept (IndexedDB `backups`). The plans of both sides are merged.
- A second device signs in with the same Google account: that is all the pairing there is.
- A small icon in the menu's foot (computer) and the top bar (phone) shows the status; its tooltip says more:

  | Status | Icon | Meaning |
  |---|---|---|
  | `synced` | cloud (green) | this device and the cloud copy are in step |
  | `syncing` | turning arrows | data is moving (a routine check that finds nothing new does not show it) |
  | `offline` | cloud crossed out | no connection; changes are saved here and wait |
  | `signin` | alert | Google's token ran out: *Sign in again* (a click on the icon) |
  | `locked` | lock | the cloud copy is encrypted with a passphrase this device does not have |
  | `error` | alert (red) | Drive was busy or failed; tried again in a minute |

- The card shows the status, the last sync and the encryption, with *Sync now*, *Encrypt with a passphrase* (or
  *Remove the passphrase*), *Turn off sync* and *Delete my cloud data*.
- *Turn off sync* stops syncing on this device; the data stays here and in Drive. *Delete my cloud data* first lets a
  sync under way finish and starts no other, then deletes every sync file from Drive and turns sync off here; other devices notice on their next check, stop syncing and say so (they do
  not upload it again). *Delete everything* (Settings › Backup) turns sync off first, so the cloud copy is neither
  emptied nor brought back.
- Deleting a plan with sync on deletes it on every device (the confirmation says so).

### When it syncs

Nothing ever waits for the network: a change is made and saved on the device at once, and synced afterwards.

| When | What |
|---|---|
| the app opens (`Drive.start`, after the first paint) | a full sync, in the background |
| about 5 s after local changes (`Drive.changed`, debounced) | changes made in a row go together, in one upload |
| the page is hidden (`Drive.leave`) | changes waiting for those 5 s go at once |
| back in the foreground, or focus (`Drive.visible`) | a look for other devices' changes, at most every 10 s |
| every minute while the app is open and shown (`DRIVE.poll`) | the same look |
| the connection returns (`online` event) | everything that waited |

A look for changes is **one listing request** (every sync file's `createdTime`, `modifiedTime` and `version`). The file is downloaded only
when another device changed it since the last sync, and uploaded only when it lacks something of this device. A save
that changes no plan (a theme, a layout) is not a change to sync.

### One sync, step by step (`DriveSync.step`)

1. List the sync files in the app data folder (`runway-sync.json`), the first one made first. Normally there is one.
   If two devices made it at the same moment there are two: the first one made is the file, the others are read and
   merged into this device's data, the file is written, and the others are deleted. No account stays split.
2. If the file's `modifiedTime`/`version` are the ones of the last sync (and there is no other file), it has nothing
   new: go to 4 if this device changed, else done.
3. Otherwise download it, decrypt it if needed, and **merge** it with this device's plans (`mergeData`). What this
   device lacked is applied at once (`Store.adoptMerged`: the open plan's undo history restarts only if it changed).
4. If the file lacks something: look at its metadata **again**; if another device wrote meanwhile, start over at 3.
   Otherwise upload with `If-Match` (the file's ETag); a `412` (or `409`) also starts over. At most three rounds,
   then "try again in a minute".
5. Remember the file's id, `modifiedTime`, `version` and ETag, and the plan texts **that were uploaded** (taken before
   the upload): a change made during the upload differs from them, so it stays pending and goes up next.

Whether Drive honours `If-Match` on an upload, and whether the browser may read the `ETag` header, has not been
checked against the real API. Nothing depends on it: without it, the last write wins, and the device whose write was
replaced finds a version it has not seen at its next sync, merges and writes its changes back
(`driveSync.test.js`: "if Drive does not check If-Match…").

**Concurrent devices.** If two devices upload at the same moment and one write still replaces the other, nothing is
lost: every device keeps its own data, and its next sync finds a version it has not seen, merges, sees that the file
lacks its records, and uploads them again. The file is a meeting point; the records live on the devices.

**Offline queue.** "This device has changes the file lacks" is a flag kept with the sync state
(`runway.drive` in localStorage, `pending`), so changes made offline, or before the app was closed, are uploaded on
the next sync, even after a restart.

### Merge rules (`models/recordMerge.js`, pure)

- Per record id (accounts, incomes, bills and subscriptions, transactions, trips, loans, goals, wishes), the version with the
  newer `updatedAt` wins. A deleted record (`deletedAt`, kept in the plan's `deleted` lists) is a version like any
  other: a deletion made after an edit wins, and an edit made after a deletion brings the record back.
- The same `updatedAt` with different content (undated records of an old backup, say): a deletion wins, then the
  version whose JSON sorts last. Every device makes the same choice, so they end with the same data.
- A plan's own fields `name` and `settings` merge **one by one**, each by the time it last changed
  (`plan.fieldsUpdatedAt`, schema 8).
- The month maps (`paid`, `fixes`, `overrides`, `reserveOver`, `notes`) merge **month by month and line by line**, by
  `plan.keysUpdatedAt`: the time each month, or month and line ("2026-01 bill:ab12"), last changed. A tick made on the
  phone and a tick made on the computer are both kept, even in the same month; a later untick wins over an earlier
  tick. Data from before these times counts each path at the field's time.
- Deleted records are kept so a deletion can travel: the newest 500 per kind in full, older ones (up to 5,000) as
  markers with only the id and dates. A device that still has the record cannot bring it back while the marker exists.
- Data rewritten by an older version of the app (which drops all dates) is detected at start and given the oldest
  date, so it never beats newer edits from other devices; entries deleted in the older version may come back.
- A trip's own fields come from its winning version; its costs merge one by one, so a cost deleted on one device stays
  deleted when the trip is edited on the other.
- A deleted plan (`db.deletedPlans`) wins over the plan if it is at least as new as the plan's last change.
- A record without dates (an old backup) counts as the oldest: any dated version wins over it.
- Order: the other copy's order first, then what only this device has, so both end with the same list.

The dates are set by the store on every save (`models/records.js stampPlan`), so no page can forget them. They come
from each device's clock: a device whose clock is far ahead wins conflicts it should not. Within minutes this does
not matter in practice; it is the usual trade-off of last-writer-wins without a server.

`tests/unit/recordMerge.test.js` covers each rule, that merging is the same in both directions, and that merging a
result again changes nothing.

### The file

`runway-sync.json` in the app data folder: the backup format (`services/backup.js`), plus the deleted plans and the
device that wrote it. With a passphrase, it is the encrypted envelope instead.

```json
{"app":"runway","kind":"backup","v":8,"exported":"2026-11-16T10:00:00.000Z","by":"<device id>",
 "deletedPlans":{"<planId>":{"id":"…","createdAt":0,"updatedAt":0,"deletedAt":0}},
 "plans":[{ …plan, with its deleted records… }]}

{"app":"runway","kind":"encrypted","v":1,"kdf":"PBKDF2-SHA256","cipher":"AES-256-GCM","iter":310000,
 "salt":"…","iv":"…","zip":"gzip","data":"…"}
```

The plan texts the store already has are joined (`IO.backupText`), not serialised again.

### Encryption (optional, off by default)

*Encrypt with a passphrase* asks for it twice and says plainly that **a lost passphrase cannot be recovered** by
anyone. The file is then gzip-compressed and encrypted on the device (AES-256-GCM, key from PBKDF2-SHA256 with
310,000 rounds and a random salt; a new IV for every upload). The key of a passphrase is derived once per visit
(`IO.keys`). Another device shows *Passphrase needed* until the passphrase is entered once (a wrong one is refused);
its changes wait meanwhile; a passphrase is kept only once it has opened the file. The passphrase is kept on each
device (IndexedDB `kv`, in plain text, readable by anything that runs in the page) so sync runs unattended, and
removed by *Turn off sync*.

**Changing it.** Only the device that set or removed the passphrase rewrites the file (`state.rewrite`). The others
follow the file: a device that still has a passphrase while the file is plain forgets its own instead of encrypting
the file again, and a file still encrypted with the old passphrase is written again with the new one by the device
that changed it.

### Requests (`services/drive.js`)

Only these, to `https://www.googleapis.com`, with the `drive.appdata` token:

| Request | Used for |
|---|---|
| `GET /drive/v3/files?spaces=appDataFolder&q=name='runway-sync.json' and trashed=false` | the routine look: every sync file |
| `GET /drive/v3/files/<id>?fields=id,name,createdTime,modifiedTime,version` | the check before writing |
| `GET /drive/v3/files/<id>?alt=media` | downloading it |
| `POST /upload/drive/v3/files?uploadType=multipart` | creating it in `appDataFolder` |
| `PATCH /upload/drive/v3/files/<id>?uploadType=media` + `If-Match` | replacing its content |
| `DELETE /drive/v3/files/<id>` | *Delete my cloud data* (every sync file); an extra file once merged |

Errors: no connection → `offline`; `401` → `signin`; `409`/`412` → read, merge and try again; `403`/`429`/`5xx` →
`error`, again in a minute; `404` on the remembered file → look for it by name (another device may have made it
again), and if there is none, it was deleted on purpose: sync stops here.

### Signing in (`services/googleAuth.js`)

Google Identity Services' *token model*, no backend. Its script (`accounts.google.com/gsi/client`) is loaded only
when needed: on the click on *Turn on sync*, and ahead of time only once sync is on and the status is `signin` (so
Google's window opens from the click on *Sign in again* itself). **Nothing is sent to Google, not even a request for
its script, before the person clicks Turn on sync.** Browsers open a window only right after a click: if the script
took too long to load and the browser blocked Google's window, Runway says so ("Click once more"); the second click
opens it at once. The access token lasts about an
hour and there is no refresh token without a backend, so after an hour away the status is *Sign in again*: one
click, and Google's window usually closes by itself when access was already given. The token is kept in IndexedDB
`kv` until it expires, and forgotten by *Turn off sync*. It is not revoked: revoking would withdraw Google's
permission for every device of the account. To withdraw Runway's access to Drive altogether: Google Account ›
Security › Third-party apps with account access.

### Setting it up for a build (the Google client ID)

Drive sync is built in only when the build has a Google OAuth client ID. Without one the card explains that sync is
not set up in this copy, and the security policy allows no Google address at all.

1. In the Google Cloud console, create a project and enable the **Google Drive API**.
2. *OAuth consent screen*: add the scope `https://www.googleapis.com/auth/drive.appdata` (Runway asks for nothing
   else). Publish the app (or add test users while testing).
3. *Credentials › Create OAuth client ID › Web application*. Under *Authorized JavaScript origins* add every origin
   Runway is served from (for example `https://runway.example.com`, and `http://localhost:5173` for `npm run dev`).
   No redirect URI and no client secret are needed.
4. Put the ID in `.env.local` (ignored by git) and build:

   ```
   VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   ```

   `vite.config.js` then adds Google to the security policy (`build/csp.js csp({ google: true })`):
   `script-src https://accounts.google.com/gsi/client`, `frame-src https://accounts.google.com/gsi/`,
   `style-src https://accounts.google.com/gsi/style`, `connect-src https://accounts.google.com/gsi/ https://www.googleapis.com`.

**Not available** in a page opened as a file (`file://`): Google signs in only pages served from an authorised
origin. The card says so; the data file and QR codes work there.

### Tests

- `tests/unit/driveSync.test.js`: two or three "devices" (stores with their own storage) against a fake Google Drive
  (`tests/unit/helpers/fakeDrive.js`: the REST calls above, ETags and `If-Match`, tokens, offline). Turning on, a
  second device, same-record edits, deletions of records and plans, offline changes and coming back online, pending
  changes after a restart, concurrent uploads (a refused `If-Match`), an expired token, the passphrase, turning off
  (also in another tab, or in the middle of a sync), deleting the cloud data, routine checks costing one metadata
  request, and that a local change never waits for the network.
- `tests/regression/drive.ui.cjs` (`npm run test:drive`): a computer and a phone as two browser contexts of the test
  build. Playwright answers Google's script (a stand-in that hands out tokens) and the Drive API (the same fake
  Drive). Every change is made in the app, and after each one the test checks that **both devices and the cloud file
  hold the same plans, text for text**. Screenshots in `tests/regression/shots/drive-*.png`.

Nothing here reaches the real Google in tests. A real check needs a client ID (above) and two signed-in browsers.
