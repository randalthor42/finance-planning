/**
 * @file Drive sync: the plans kept in one file in the person's Google Drive (its hidden app data folder), merged
 * record by record with every device signed in to the same Google account. No backend: Google Identity Services
 * gives a drive.appdata token in the browser (services/googleAuth.js); the browser reads and writes the file
 * (services/drive.js). See docs/sync.md.
 *
 * Offline first: every change is saved on the device at once, as always; sync runs afterwards, in the background,
 * and nothing ever waits for it. When: on app open (start), back in the foreground (visible), about 5 s after local
 * changes (changed, debounced) and when the connection returns (online).
 *
 * One sync: look at the file's metadata; if another device changed it since our last sync, download it, merge it
 * (models/recordMerge.js: the newer updatedAt wins per record, deletions travel) and apply the result here; then, if
 * the file lacks something, upload, but only if the file is still the version we read (a fresh look at its
 * modifiedTime and version, and If-Match with its ETag). If it changed in between, read, merge and try again.
 *
 * Status: off · syncing · synced · offline · signin (sign in again) · locked (passphrase needed) · error (try later).
 */
import { APP } from '../config.js';
import { $t } from '../core/i18n.js';
import { isObj } from '../core/util.js';
import { mergeData } from '../models/recordMerge.js';
import { normDB } from '../models/db.js';
import { normPlan } from '../models/plan.js';
import { IO } from '../services/backup.js';
import { driveClient } from '../services/drive.js';
import { googleAuth } from '../services/googleAuth.js';
import { backup, kv, readJSON, writeJSON } from '../services/storage.js';
import { Store } from './store.js';

/** Drive sync's timings and limits, and where its state is kept (localStorage key). */
export const DRIVE = {
  /** Local changes are synced this long after the last one (ms). */
  debounce: 5000,
  /** After Drive was busy or failed, the next try (ms). */
  retry: 60000,
  /** Concurrent changes: read, merge and write again at most this many times in one sync. */
  attempts: 3,
  /** A token this close to its end is not used: a request would fail halfway (ms). */
  margin: 60000,
  /** While the app is open and shown, other devices' changes are looked for this often (ms)… */
  poll: 60000,
  /** …and, back in the foreground, not again within this time (ms). */
  quiet: 10000,
  stateKey: 'runway.drive',
};

/** Runs that start by themselves (a timer, an event): skipped while the file waits for a passphrase. */
const AUTOMATIC = new Set(['change', 'leave', 'online', 'foreground', 'poll', 'retry']);

const localState = key => ({ load: () => readJSON(key), save: value => writeJSON(key, value) });
const sameTexts = (list, texts) => !!texts && list.length === texts.length && list.every((p, i) => p.text === texts[i]);
/**
 * A short fingerprint of the plan texts (cyrb53, a fast non-cryptographic hash), kept with the sync state so that,
 * after a restart, a save that changes no plan is still told apart from a change to sync.
 */
function fingerprint(texts) {
  const joined = texts.join('\u0000');
  let h1 = 0xdeadbeef ^ texts.length;
  let h2 = 0x41c6ce57 ^ texts.length;
  for (let i = 0; i < joined.length; i++) {
    const code = joined.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** What kind of failure an error with this HTTP status is (fail): 'busy', 'refused' or 'failed'. */
function failureKind(status) {
  if (status === 403 || status === 429 || status >= 500) {
    return 'busy';
  }
  if (status >= 400) {
    return 'refused';
  }
  return 'failed';
}
/** The cloud file needs a passphrase we do not have, or a wrong one. */
class Locked extends Error {}

export class DriveSync {
  /**
   * @param {import('./store.js').PlanStore} store
   * @param {Object} options client (token => Drive client), auth ({signIn, load?}), keep (kv: token and
   *   passphrase), meta ({load, save}: sync state), online (() => boolean), debounce (ms), backup ((text, info) =>
   *   Promise), now (() => ms)
   */
  constructor(store, options = {}) {
    this.store = store;
    this.client = options.client || (token => driveClient({ token }));
    this.auth = options.auth || googleAuth({ clientId: APP.google.clientId });
    this.keep = options.keep || kv;
    this.meta = options.meta || localState(DRIVE.stateKey);
    this.isOnline = options.online || (() => typeof navigator === 'undefined' || navigator.onLine !== false);
    this.debounce = options.debounce ?? DRIVE.debounce;
    this.keepBackup = options.backup || backup;
    this.now = options.now || (() => Date.now());
    const saved = this.meta.load();
    /** What is remembered between visits: on or off, the file and its version at the last sync, waiting changes. */
    this.state = isObj(saved) ? saved : {};
    this.status = this.state.enabled ? 'syncing' : 'off';
    this.detail = '';
    this.token = null;
    this.passphrase = null;
    /**
     * The passphrase the file may still be encrypted with after setPassphrase changed it, until the file is written
     * with the new one. Kept on the device too (driveFormerPassphrase), so a restart in between can still read it.
     */
    this.former = null;
    /** Counts passphrase changes: a write that began before one does not count as applying it. */
    this.generation = 0;
    this.timer = 0;
    this.retryTimer = 0;
    this.running = null;
    /** The reason of a run asked for while one was under way ('' when none): it runs once more after it. */
    this.again = '';
    /** "Delete my cloud data" is under way: no sync reads or writes the file. */
    this.deleting = false;
    /** When visible() last looked for changes. */
    this.looked = 0;
    /** The plan texts at the last sync: a save that changes none of them (a preference) is not a change to sync. */
    this.syncedTexts = null;
    this.onChange = () => {}; // the status changed: redraw the icon
    this.onNotify = () => {};
    store.savedHooks.add(() => this.changed());
  }

  get enabled() {
    return !!this.state.enabled;
  }
  get pending() {
    return !!this.state.pending;
  }
  get encrypted() {
    return !!this.state.encrypted;
  }
  get lastSync() {
    return this.state.lastSync || 0;
  }
  save() {
    this.meta.save(this.state);
  }
  setStatus(status, detail = '') {
    if (status !== this.status || detail !== this.detail) {
      this.status = status;
      this.detail = detail;
      this.onChange();
    }
  }

  /* --- what the page calls --- */

  /** At app start: if sync is on, catch up in the background. */
  async start() {
    if (!this.enabled) {
      return this.setStatus('off');
    }
    await this.loadSecrets();
    this.run('open');
  }
  /** Reads what is kept on this device: the token (if still valid), the passphrase and the former passphrase. */
  async loadSecrets() {
    try {
      const saved = await this.keep.get('driveToken');
      this.token = isObj(saved) && saved.expiresAt - DRIVE.margin > this.now() ? saved : null;
      this.passphrase = (await this.keep.get('drivePassphrase')) || null;
      this.former = (await this.keep.get('driveFormerPassphrase')) || null;
    } catch (e) {}
  }
  /**
   * "Turn on sync" (from a click: Google's window opens). Signs in, keeps a backup of this device's data, and syncs.
   * Resolves to false when the person closed Google's window or refused.
   */
  async turnOn() {
    if (!(await this.signIn('consent'))) {
      return false;
    }
    this.state = { enabled: true, pending: true };
    this.save();
    await this.run('turn on');
    return true;
  }
  /** Loads Google's sign-in script ahead of a click that will need it (its window must open from the click). */
  prepare() {
    if (this.auth.load) {
      this.auth.load().catch(() => {});
    }
  }
  /** "Sign in again" (from a click), then sync what waited. */
  async signInAgain() {
    if (await this.signIn('')) {
      await this.run('signed in');
      return true;
    }
    return false;
  }
  /**
   * Opens Google's window (prompt: 'consent' or '') and keeps the token. Resolves to whether a token was given; when
   * not, the person is told what to do if there is something to do.
   */
  async signIn(prompt) {
    try {
      this.token = await this.auth.signIn({ prompt });
      await this.keep.set('driveToken', this.token);
      return true;
    } catch (e) {
      if (e && e.type === 'offline') {
        this.onNotify($t('Google could not be reached. Check your connection and try again.'), { kind: 'bad' });
      } else if (e && e.type === 'popup_failed_to_open') {
        // the browser blocked Google's window (opened too long after the click, while its script loaded): it is
        // loaded now, so a second click opens it at once
        this.onNotify($t('The browser blocked Google’s window. Click once more.'), { kind: 'bad' });
      } else if (e && e.type === 'scope') {
        this.onNotify(
          $t(
            'Runway needs access to its own folder in your Google Drive to sync. Try again and leave that box ticked.',
          ),
          { kind: 'bad' },
        );
      }
      return false;
    }
  }
  /**
   * "Turn off sync": no more syncing. The data stays on this device and in Drive. The token is forgotten here, not
   * revoked: revoking withdraws the access Google gave to the app for every device of the account (the person can
   * do that in their Google Account; the token expires within the hour anyway).
   */
  async turnOff() {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = 0;
    this.state = {};
    this.save();
    this.token = null;
    this.passphrase = null;
    this.former = null;
    try {
      await this.keep.del('driveToken');
      await this.keep.del('drivePassphrase');
      await this.keep.del('driveFormerPassphrase');
    } catch (e) {}
    this.setStatus('off');
  }
  /** "Delete my cloud data" (from a click): removes the Drive file, then turns sync off. Data here stays. */
  async deleteCloudData() {
    if (!this.validToken() && !(await this.signIn(''))) {
      return false;
    }
    // a sync waiting or under way would read or make the file again: none starts, the running one finishes first
    this.deleting = true;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = 0;
    this.retryTimer = 0;
    try {
      await this.running;
    } catch (e) {}
    try {
      const client = this.client(() => (this.token ? this.token.token : ''));
      for (const file of await client.list()) {
        await client.remove(file.id).catch(e => {
          if (e.status !== 404) {
            throw e;
          }
        });
      }
    } catch (e) {
      this.deleting = false;
      this.fail(e);
      return false;
    }
    await this.turnOff();
    this.deleting = false;
    return true;
  }
  /**
   * The passphrase of the cloud copy (null: none). It stays on this device; it cannot be recovered. The file is
   * written again, encrypted or not.
   */
  async setPassphrase(passphrase) {
    // the file may still be encrypted with the one before: it is read with it once more. While an earlier change is
    // not written yet, the file is still as it was before that one, so its former passphrase stays.
    let formerOne = this.passphrase;
    if (this.state.rewrite) {
      formerOne = this.former;
    }
    this.generation++;
    this.passphrase = passphrase || null;
    this.state.encrypted = !!passphrase;
    this.state.rewrite = true; // this device changed it: the file follows this device (followEncryption)
    this.state.pending = true;
    this.state.modifiedTime = null; // write it again, whatever the file is
    this.save();
    await this.setFormer(formerOne);
    try {
      if (passphrase) {
        await this.keep.set('drivePassphrase', passphrase);
      } else {
        await this.keep.del('drivePassphrase');
      }
    } catch (e) {}
    await this.run('passphrase');
  }
  /** The passphrase the file may still be encrypted with (null: none), here and on the device. */
  async setFormer(passphrase) {
    this.former = passphrase || null;
    try {
      if (this.former) {
        await this.keep.set('driveFormerPassphrase', this.former);
      } else {
        await this.keep.del('driveFormerPassphrase');
      }
    } catch (e) {}
  }
  /**
   * The passphrase another device set: tried on the file; kept if it opens it. Resolves to whether it did. While this
   * device's own passphrase change is not written yet, the one entered is taken as the former one (unlockFormer).
   */
  async unlock(passphrase) {
    if (this.state.rewrite) {
      return this.unlockFormer(passphrase);
    }
    const previous = this.passphrase;
    this.passphrase = passphrase;
    await this.run('unlock');
    if (this.status !== 'synced') {
      // wrong, or not tried (offline, signed out): not kept, so it is asked again once the file can be read
      this.passphrase = previous;
      return false;
    }
    this.state.encrypted = true;
    this.save();
    try {
      await this.keep.set('drivePassphrase', passphrase);
    } catch (e) {}
    return true;
  }
  /**
   * This device set or removed its passphrase, but the file is still encrypted with one it no longer has (an older
   * version of the app kept it in memory only): the one entered opens the file once, and the file is then written as
   * this device chose. The device's own choice stays.
   */
  async unlockFormer(passphrase) {
    const previous = this.former;
    this.former = passphrase;
    await this.run('unlock');
    if (this.status !== 'synced') {
      this.former = previous;
      return false;
    }
    return true;
  }
  /** Whether the plans are those of the last sync (after a restart: by the fingerprint kept with the sync state). */
  matchesSynced() {
    const list = this.store.planList();
    if (this.syncedTexts) {
      return sameTexts(list, this.syncedTexts);
    }
    return !!this.state.syncedHash && fingerprint(list.map(p => p.text)) === this.state.syncedHash;
  }
  /** A local change was saved: sync in a few seconds (changes in a row are synced together). */
  changed() {
    if (!this.enabled) {
      return;
    }
    if (!this.matchesSynced()) {
      if (!this.state.pending) {
        this.state.pending = true;
        this.save();
      }
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.run('change');
    }, this.debounce);
  }
  /** The connection is back. */
  online() {
    if (this.enabled) {
      this.run('online');
    }
  }
  /** The connection is gone: say so at once (the next sync would find out too). */
  offline() {
    if (this.enabled && this.status !== 'signin' && this.status !== 'locked') {
      this.setStatus('offline');
    }
  }
  /** The page is being hidden (maybe closed): changes waiting for the short delay are sent now. */
  leave() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
      this.run('leave');
    }
  }
  /** Another tab turned sync on or off (its state in localStorage changed). */
  reload() {
    const saved = this.meta.load();
    const was = this.enabled;
    this.state = isObj(saved) ? saved : {};
    if (!this.enabled && was) {
      clearTimeout(this.timer);
      clearTimeout(this.retryTimer);
      this.timer = 0;
      this.token = null;
      this.passphrase = null;
      this.former = null;
      this.setStatus('off');
    } else if (this.enabled && !was) {
      this.start();
    }
  }
  /**
   * The app is in the foreground again, or has been open a while (main.js, every DRIVE.poll): changes from other
   * devices are looked for (one metadata request), at most once every DRIVE.quiet ms.
   */
  visible() {
    if (!this.enabled || this.running || this.now() - this.looked < DRIVE.quiet) {
      return;
    }
    this.looked = this.now();
    this.run('foreground');
  }
  /** Syncs now (one at a time: a request during a sync runs once more after it). */
  sync(reason = 'now') {
    return this.run(reason);
  }
  /**
   * Starts a sync, or, while one runs, asks for one more after it. Resolves when both are done (finally waits for the
   * run it returns), so unlock sees the status of the run that tried its passphrase. While the file waits for a
   * passphrase, runs that start by themselves (AUTOMATIC) are skipped: each would download the file to fail again.
   */
  run(reason) {
    if (this.status === 'locked' && AUTOMATIC.has(reason)) {
      return Promise.resolve();
    }
    if (this.running) {
      if (!this.again || AUTOMATIC.has(this.again)) {
        this.again = reason; // a run the person asked for (unlock, passphrase) is not skipped as an automatic one
      }
      return this.running;
    }
    this.running = this.once(reason).finally(() => {
      this.running = null;
      const next = this.again;
      if (next) {
        this.again = '';
        return this.run(next);
      }
    });
    return this.running;
  }
  /** Resolves when no sync is running or waiting (tests). */
  async idle() {
    while (this.timer || this.running) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = 0;
        this.run('change');
      }
      await this.running;
    }
  }

  /* --- one sync --- */

  validToken() {
    return this.token && this.token.expiresAt - DRIVE.margin > this.now() ? this.token : null;
  }
  async once() {
    if (!this.enabled) {
      return;
    }
    if (!this.isOnline()) {
      return this.setStatus('offline');
    }
    if (!this.validToken()) {
      return this.setStatus('signin');
    }
    // a routine look (nothing changed anywhere) does not flicker the icon: "Syncing…" shows once data moves (step)
    if (this.status !== 'synced') {
      this.setStatus('syncing');
    }
    try {
      for (let attempt = 0; attempt < DRIVE.attempts; attempt++) {
        if (await this.step()) {
          return this.setStatus(this.enabled ? 'synced' : 'off');
        }
      }
      this.later('busy');
    } catch (e) {
      this.fail(e);
    }
  }
  /**
   * One read, merge and write. Resolves to true when this device and the file are in step, false to try again. A
   * passphrase change made meanwhile (this.generation moved on) is not taken as written: the run it asked for does it.
   */
  async step() {
    const startGeneration = this.generation;
    if (this.deleting) {
      return true; // "Delete my cloud data" is under way: nothing is read or written meanwhile
    }
    const client = this.client(() => (this.token ? this.token.token : ''));
    // one request: every sync file. Two devices that made it at the same moment each made one: the first one made is
    // the file, the others are merged into it and deleted, so the account never stays split
    const files = await client.list();
    const file = files[0] || null;
    const extras = files.slice(1);
    if (!file && this.state.fileId) {
      // it was there at the last sync: "Delete my cloud data" on another device. Not uploaded again.
      this.onNotify(
        $t('Your data in Google Drive was deleted from another device. Sync is off here; your data here stays.'),
      );
      await this.turnOff();
      return true;
    }
    const known =
      !!file &&
      !extras.length &&
      file.id === this.state.fileId &&
      file.modifiedTime === this.state.modifiedTime &&
      String(file.version) === String(this.state.version);
    let etag = known ? this.state.etag : null;
    if (!this.state.backedUp) {
      // before the first sync touches anything, a copy of this device's data (services/storage.js backups)
      await this.keepBackup(this.store.dbText(), {
        from: APP.schema,
        to: APP.schema,
        reason: 'before the first Drive sync',
      });
      this.state.backedUp = true;
      this.save();
    }
    // decided after the last wait above: a change made while waiting is seen here, not marked as synced unsent
    let push = !file || (known && this.localChanges());
    if (file && !known) {
      this.setStatus('syncing');
      // the extra files first (rare): what only they hold comes here, then goes into the first file
      for (const extra of extras) {
        if (!(await this.pull(client, extra))) {
          return true;
        }
      }
      const read = await client.read(file.id);
      etag = read.etag || null;
      const remote = await this.pull(client, file, read.text);
      if (!remote) {
        return true;
      }
      push = remote.changed || extras.length > 0 || this.encryptionToWrite(remote);
    }
    if (!push) {
      if (startGeneration === this.generation) {
        this.state.rewrite = false; // nothing to write: the file is already as this device chose
      }
      this.remember(file, etag, this.texts(), startGeneration);
      return true;
    }
    this.setStatus('syncing');
    // the plans as they are now: the upload sends these, and only these count as synced once it is done
    const sent = this.texts();
    // and the passphrase it is encrypted with (encode reads it before its first wait)
    const generation = this.generation;
    const writtenWith = this.passphrase;
    const text = await this.encode(sent);
    if (!this.enabled) {
      return true;
    }
    let saved;
    if (!file) {
      saved = await client.create(text);
    } else {
      // still the version we read? (another device may have written meanwhile)
      const now = await client.meta(file.id);
      if (now.modifiedTime !== file.modifiedTime || String(now.version) !== String(file.version)) {
        this.state.modifiedTime = null;
        return false;
      }
      try {
        saved = await client.update(file.id, text, etag || now.etag);
      } catch (e) {
        if (e.status === 412 || e.status === 409) {
          this.state.modifiedTime = null;
          return false;
        }
        throw e;
      }
    }
    if (generation === this.generation) {
      this.state.rewrite = false; // the file is now encrypted, or not, as this device chose
    } else {
      // the passphrase changed during the upload: until it is written, the file is read with the one it has now
      await this.setFormer(writtenWith);
    }
    this.remember(saved, saved.etag, sent, generation);
    for (const extra of extras) {
      // merged into the first file: no longer needed (gone already if another device deleted it first)
      await client.remove(extra.id).catch(e => {
        if (e.status !== 404) {
          throw e;
        }
      });
    }
    return true;
  }
  /**
   * Reads one sync file (its text, when already read) and merges it into this device's data. Resolves to
   * { changed: the file lacks something this device has, encrypted }, or null when sync was turned off meanwhile.
   */
  async pull(client, file, text) {
    const content = text === undefined ? (await client.read(file.id)).text : text;
    const remote = await this.decode(content);
    if (!this.enabled || this.deleting) {
      return null; // turned off meanwhile (Delete everything, say): nothing is brought in any more
    }
    const local = { plans: this.store.planList().map(p => p.plan), deletedPlans: this.store.db.deletedPlans };
    const merged = mergeData(local, remote);
    if (merged.localChanged) {
      this.store.adoptMerged(merged.plans, merged.deletedPlans, $t('Synced changes from Google Drive'));
    }
    this.followEncryption(remote.encrypted);
    return { changed: merged.remoteChanged, encrypted: remote.encrypted, stale: remote.stale };
  }
  /**
   * The file is plain while this device still has a passphrase that it did not just set: another device removed the
   * passphrase. This one follows (it forgets its own) instead of encrypting the file again.
   */
  followEncryption(encrypted) {
    if (!encrypted && this.passphrase && !this.state.rewrite) {
      this.passphrase = null;
      this.state.encrypted = false;
      this.save();
      this.keep.del('drivePassphrase').catch(() => {});
    }
  }
  /** Whether the file must be written again to apply this device's own passphrase choice (setPassphrase). */
  encryptionToWrite(remote) {
    return !!this.state.rewrite && (remote.encrypted !== !!this.passphrase || remote.stale);
  }
  /** This device's plan texts, in order. */
  texts() {
    return this.store.planList().map(p => p.text);
  }
  /**
   * This device and the file are in step: their version, and the plan texts the file now holds (`texts`, taken before
   * the upload). A change made during the upload differs from them, so it stays pending and goes up next time.
   * generation: this.generation when the file was read or written. If the passphrase changed since, the file is not
   * yet as this device chose: it stays pending and its version unknown, so the run setPassphrase asked for writes it.
   */
  remember(file, etag, texts, generation = this.generation) {
    if (!this.enabled) {
      return;
    }
    this.state.fileId = file.id;
    this.state.version = String(file.version);
    this.state.etag = etag || null;
    this.state.lastSync = this.now();
    this.syncedTexts = texts;
    this.state.syncedHash = fingerprint(texts);
    if (generation !== this.generation) {
      this.save();
      return;
    }
    if (this.former) {
      this.setFormer(null);
    }
    this.state.modifiedTime = file.modifiedTime;
    this.state.pending = !sameTexts(this.store.planList(), texts);
    this.save();
    if (this.state.pending && !this.timer) {
      // changed during the upload and no sync is waiting for it yet: one more, after the usual short delay
      this.changed();
    }
  }
  /**
   * Whether this device changed since the last sync: the plan texts differ from those of the last sync in this visit,
   * or (after a restart, when they are not known) a change was saved and flagged (state.pending).
   */
  localChanges() {
    return this.state.pending || (!!this.syncedTexts && !sameTexts(this.store.planList(), this.syncedTexts));
  }
  /** The file's text: the backup format, with deleted plans; encrypted with the passphrase, if one is set. */
  async encode(texts) {
    const text = IO.backupText(texts, { by: this.store.deviceId || '', deletedPlans: this.store.db.deletedPlans });
    return this.passphrase ? JSON.stringify(await IO.encrypt(text, this.passphrase, { zip: true })) : text;
  }
  /** The file's plans (cleaned by normPlan) and deleted plans. */
  async decode(text) {
    const encrypted = /"kind"\s*:\s*"encrypted"/.test(text.slice(0, 200));
    const tries = encrypted ? [this.passphrase, this.former].filter(Boolean) : [''];
    if (!tries.length) {
      throw new Locked('needed');
    }
    let read = null;
    let opener = '';
    for (const passphrase of tries) {
      try {
        read = await IO.read(text, passphrase, { allowEmpty: true });
        opener = passphrase;
        break;
      } catch (e) {
        if (e.code !== 'password') {
          throw e;
        }
      }
    }
    if (!read || read.needsPassword) {
      throw new Locked(this.passphrase ? 'wrong' : 'needed');
    }
    return {
      plans: read.plans.map(p => normPlan(p)),
      deletedPlans: normDB({ plans: {}, deletedPlans: read.deletedPlans }).deletedPlans,
      encrypted,
      // opened only with the passphrase this device replaced: it must be written again with the new one
      stale: encrypted && opener !== this.passphrase,
    };
  }
  /**
   * A sync failed: sets the status that says what to do. The detail of 'error' is a code for the page ('busy',
   * 'refused', 'failed'; see failureKind), never the error's own text (Google's or the browser's, in English), which
   * goes to the console.
   */
  fail(e) {
    if (!this.enabled) {
      return this.setStatus('off'); // turned off meanwhile: whatever failed does not matter any more
    }
    if (e instanceof Locked) {
      return this.setStatus('locked', e.message);
    }
    const status = e && e.status;
    if (status === 0) {
      return this.setStatus('offline');
    }
    if (status === 401) {
      this.token = null;
      this.keep.del('driveToken').catch(() => {});
      return this.setStatus('signin');
    }
    console.warn('Google Drive sync failed:', e);
    this.later(failureKind(status));
  }
  /** Drive was busy or something failed (detail: what kind, see fail): say so, and try again in a minute. */
  later(detail) {
    this.setStatus('error', detail);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.run('retry'), DRIVE.retry);
    if (this.retryTimer.unref) {
      this.retryTimer.unref();
    }
  }
}

/** The app's Drive sync. main.js starts it and wires the page events. */
export const Drive = new DriveSync(Store);
