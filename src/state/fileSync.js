/**
 * @file The data file: the plans kept in one JSON file the person chooses (File System Access API), written as they
 * make changes, and merged with the changes other devices save to it (the file can sit in a synced folder).
 *
 * The browser storage (services/storage.js) stays the working copy: the app opens from it at once and keeps working
 * while the file is out of reach (no permission yet on this visit, moved, on a disconnected drive). When the file is
 * back, both are merged record by record (models/recordMerge.js, the same rules as Drive sync): the newer version of
 * each record wins, deletions travel, ticks made on both sides are kept.
 *
 * Status: 'unsupported' (no API in this browser) · 'off' (turned off in Settings) · 'unlinked' (on, no file chosen yet)
 * · 'prompt' (the browser needs the person's OK for this visit) · 'ok' · 'error' (see .error; the browser copy is safe).
 *
 * Costs, since saving happens on every change: a save joins the plans' cached texts (PlanStore.textOf), runs at most
 * every writeDelay ms, and is skipped when only browser preferences changed. Looking for another device's changes
 * reads only the file's date and size every watchEvery ms while the page is visible; the file is read only when
 * those changed.
 */
import { APP } from '../config.js';
import { $t } from '../core/i18n.js';
import { isObj, uid } from '../core/util.js';
import { decodeDataFile, encodeDataFile } from '../models/dataFile.js';
import { mergeData } from '../models/recordMerge.js';
import { FileAccess } from '../services/fileAccess.js';
import { HandleStore } from '../services/handleStore.js';
import { readJSON, writeJSON } from '../services/storage.js';
import { Store } from './store.js';

export const SYNC = {
  /** A change is written to the file at most this often (ms): typing in an autosaving pop-up is one write, not 20. */
  writeDelay: 300,
  /** How often the file is checked for another device's changes while the page is visible (ms). */
  watchEvery: 3000,
  fileName: 'runway-data.json',
  /** This browser's record of the data file: a random browser name (shown as "saved by"). */
  metaKey: APP.key + '.file',
};
const HANDLE = 'file';

/** This browser's record of the last sync, in localStorage (through the data access module). */
function localMeta(key) {
  return { load: () => readJSON(key), save: value => writeJSON(key, value) };
}
/** What an empty file (or one being replaced by a sync client) holds: nothing, and no deletions. */
const EMPTY = { kind: 'data', list: [], deletedPlans: {} };
/** Runs fn when the browser has a quiet moment (within 2 s), so work that can wait does not delay a click or a key. */
const whenIdle =
  typeof requestIdleCallback === 'function'
    ? fn => requestIdleCallback(fn, { timeout: 2000 })
    : fn => setTimeout(fn, 50);
const cancelIdle = typeof cancelIdleCallback === 'function' ? id => cancelIdleCallback(id) : id => clearTimeout(id);
const sameStat = (a, b) => !!a && !!b && a.modified === b.modified && a.size === b.size;
const sameTexts = (list, texts) => !!texts && list.length === texts.length && list.every((p, i) => p.text === texts[i]);

/** The message when the plans here and in the file are more than a browser can hold together. */
const tooMany = name =>
  $t(
    'Together, this browser and {0} have more than {1} plans. Delete some plans here, then try again.',
    name,
    APP.maxPlans,
  );

export class FileSync {
  /**
   * @param {import('./store.js').PlanStore} store
   * @param {Object} [options] io (FileAccess), keep (HandleStore), meta ({load, save}), writeDelay, watchEvery,
   *   visible (() => boolean): replaced in tests.
   */
  constructor(store, options = {}) {
    this.store = store;
    this.io = options.io || FileAccess;
    this.keep = options.keep || HandleStore;
    this.meta = options.meta || localMeta(SYNC.metaKey);
    this.writeDelay = options.writeDelay ?? SYNC.writeDelay;
    this.watchEvery = options.watchEvery ?? SYNC.watchEvery;
    /** Whether the page is in view: the watcher rests while it is not (main.js tells; the store knows no page). */
    this.visible = options.visible || (() => true);
    this.status = this.io.supported() ? 'off' : 'unsupported'; // known at once, so the first paint is right
    this.error = '';
    this.handle = null;
    this.name = '';
    /** When the file was last saved and by which browser (read from the file). */
    this.savedAt = '';
    this.savedBy = '';
    /** Date and size of the file as last read or written: a difference means someone else saved it. */
    this.known = null;
    /** The file's text as last read or written, and the plan texts in it. */
    this.lastText = null;
    this.pushed = null;
    const saved = this.meta.load();
    const meta = isObj(saved) ? saved : {};
    this.device = typeof meta.device === 'string' && /^[a-z0-9]{4,16}$/.test(meta.device) ? meta.device : uid();
    /** File operations run one after the other. gen changes when the file is changed or dropped: late results of
     * operations on the previous file are ignored. */
    this.chain = Promise.resolve();
    this.gen = 0;
    this.busy = 0;
    this.timer = 0;
    this.watchTimer = 0;
    this.metaTimer = 0;
    if (meta.device !== this.device) {
      this.writeMeta(); // a new browser name is kept at once
    }
    this.onChange = () => {}; // status changed: redraw (not on every save)
    this.onNotify = () => {}; // a message for the person
    store.onSaved = () => this.queue();
  }

  /* --- what the page calls --------------------------------------------------------------------------------- */

  /** On start and when turned on: finds the remembered file and, if the browser still allows it, catches up. */
  async start() {
    if (!this.io.supported()) {
      return this.setStatus('unsupported');
    }
    if (!this.store.db.fileSync) {
      return this.setStatus('off');
    }
    if (!this.handle) {
      try {
        this.handle = (await this.keep.get(HANDLE)) || null;
      } catch (e) {
        this.handle = null;
      }
    }
    if (!this.handle) {
      return this.setStatus('unlinked');
    }
    this.name = this.handle.name;
    let state;
    try {
      state = await this.io.permission(this.handle, false);
    } catch (e) {
      state = 'prompt';
    }
    if (state !== 'granted') {
      return this.setStatus('prompt');
    }
    await this.run(gen => this.pull(gen));
  }
  /** The browser asks the person to allow the remembered file again (from a click). */
  async reconnect() {
    if (!this.handle) {
      return false;
    }
    let state;
    try {
      state = await this.io.permission(this.handle, true);
    } catch (e) {
      state = 'denied';
    }
    if (state !== 'granted') {
      this.setStatus('prompt');
      this.onNotify($t('Runway still has no permission for {0}. Your changes are kept in this browser.', this.name), {
        kind: 'bad',
      });
      return false;
    }
    await this.run(gen => this.pull(gen));
    return this.status === 'ok';
  }
  /** "Choose where to save": a new file, or an existing one to replace (Runway data in it is merged, not lost). */
  async linkNew() {
    return this.link(() => this.io.pickNew(SYNC.fileName), 'new');
  }
  /** "Open a data file": an existing file, e.g. the one another computer saves to. */
  async linkOpen() {
    return this.link(() => this.io.pickExisting(), 'open');
  }
  /** "Stop using this file": forgets it. The file is left as it is; the plans stay in this browser. */
  unlink() {
    this.drop();
    this.saveMeta();
    this.setStatus(this.restingStatus());
    return this.keep.del(HANDLE).catch(() => {});
  }
  /** The status with no file in use: unsupported by this browser, waiting for one, or turned off. */
  restingStatus() {
    if (!this.io.supported()) {
      return 'unsupported';
    }
    return this.store.db.fileSync ? 'unlinked' : 'off';
  }
  /** The Settings switch. Off: the file is not written (it is still remembered). On again: catches up with it. */
  async setEnabled(on) {
    this.store.setPref('fileSync', !!on);
    if (on) {
      return this.start();
    }
    this.gen++;
    clearTimeout(this.timer);
    this.timer = 0;
    this.setStatus(this.io.supported() ? 'off' : 'unsupported');
  }
  /** The switch was changed in another tab (shared browser storage): follow it here. */
  refresh() {
    if (!this.store.db.fileSync && this.status !== 'off' && this.status !== 'unsupported') {
      this.gen++;
      clearTimeout(this.timer);
      this.timer = 0;
      this.setStatus('off');
    } else if (this.store.db.fileSync && this.status === 'off') {
      return this.start();
    }
    return Promise.resolve();
  }
  /** After an error about the file's content: writes this browser's plans over it, because the person said so. */
  overwrite() {
    return this.run(async gen => {
      await this.writeNow(gen);
      this.setStatus('ok');
    });
  }
  /** Looks for changes another device saved (a timer, and when the page comes back into view). */
  check() {
    if (this.status !== 'ok' || !this.store.db.fileWatch || this.busy || this.timer) {
      return Promise.resolve();
    }
    return this.run(async gen => {
      const stat = await this.io.stat(this.handle);
      if (gen === this.gen && !sameStat(stat, this.known)) {
        await this.pull(gen);
      }
    });
  }
  /** Called after every save to the browser storage: the file follows, writeDelay later at most. */
  queue() {
    if (this.timer || !this.handle || (this.status !== 'ok' && this.status !== 'error')) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.run(gen => this.push(gen));
    }, this.writeDelay);
  }
  /** Writes a waiting change now (the page is being hidden or closed). */
  flushNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = 0;
      this.run(gen => this.push(gen));
    }
  }
  /** The page is being hidden or closed: start the waiting write and keep the sync record now. */
  leave() {
    this.flushNow();
    this.flushMeta();
  }
  /** Resolves when nothing is waiting to be written (tests, and before leaving). */
  async idle() {
    while (this.timer || this.busy) {
      this.flushNow();
      await this.chain;
    }
    this.flushMeta();
  }

  /* --- inside ---------------------------------------------------------------------------------------------- */

  setStatus(status, error = '') {
    const changed = status !== this.status || error !== this.error;
    this.status = status;
    this.error = error;
    this.watch();
    if (changed) {
      this.onChange();
    }
  }
  /** Runs a file operation after the ones before it. Errors become a status; the browser copy is never touched. */
  run(fn) {
    if (!this.store.db) {
      return Promise.resolve(); // nothing read yet (the app is locked with its data encrypted: ui/lock.js)
    }
    const gen = this.gen;
    this.busy++;
    const next = this.chain
      .then(() => (gen === this.gen ? fn(gen) : undefined))
      .catch(e => {
        if (gen === this.gen) {
          this.fail(e);
        }
      })
      .finally(() => {
        this.busy--;
        // a change made while the file was busy (e.g. while catching up at start) is written now
        if (!this.busy && !this.timer && this.status === 'ok' && !sameTexts(this.store.planList(), this.pushed)) {
          this.queue();
        }
      });
    this.chain = next;
    return next;
  }
  fail(e) {
    const kind = e && e.name;
    if (kind === 'NotAllowedError' || kind === 'SecurityError') {
      return this.setStatus('prompt');
    }
    if (kind === 'NotFoundError') {
      return this.setStatus(
        'error',
        $t(
          '{0} was moved or deleted. Choose it again or save to a new file. Your changes are kept in this browser.',
          this.name,
        ),
      );
    }
    this.setStatus(
      'error',
      $t('Could not use {0}: {1}. Your changes are kept in this browser.', this.name, String((e && e.message) || e)),
    );
  }
  watch() {
    const on = this.status === 'ok' && this.watchEvery > 0;
    if (on && !this.watchTimer) {
      this.watchTimer = setInterval(() => this.visible() && this.check(), this.watchEvery);
    } else if (!on && this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = 0;
    }
  }
  drop() {
    this.gen++;
    clearTimeout(this.timer);
    this.timer = 0;
    this.handle = null;
    this.name = '';
    this.known = null;
    this.lastText = null;
    this.pushed = null;
    this.savedAt = '';
    this.savedBy = '';
  }
  /** Keeps the record of the last sync in the browser storage, at the next quiet moment. */
  saveMeta() {
    if (!this.metaTimer) {
      this.metaTimer = whenIdle(() => {
        this.metaTimer = 0;
        this.writeMeta();
      });
    }
  }
  /** Writes the record now (the page is being hidden or closed). */
  flushMeta() {
    if (this.metaTimer) {
      cancelIdle(this.metaTimer);
      this.metaTimer = 0;
      this.writeMeta();
    }
  }
  writeMeta() {
    this.meta.save({ device: this.device });
  }
  /** A change here: written to the file, unless another device saved it since; then both are merged first. */
  async push(gen) {
    if (!this.handle || (this.status !== 'ok' && this.status !== 'error')) {
      return;
    }
    if (this.status === 'ok' && sameTexts(this.store.planList(), this.pushed)) {
      return; // only preferences changed: they are not in the file
    }
    const stat = await this.io.stat(this.handle);
    if (gen !== this.gen) {
      return;
    }
    if (!sameStat(stat, this.known)) {
      return this.pull(gen);
    }
    await this.writeNow(gen);
    if (gen === this.gen) {
      this.setStatus('ok');
    }
  }
  /** Reads the file and merges it with the plans here; writes it back if this browser had something new. */
  async pull(gen) {
    const read = await this.io.read(this.handle);
    if (gen !== this.gen) {
      return;
    }
    const stat = { modified: read.modified, size: read.size };
    if (read.text === this.lastText) {
      this.known = stat;
      return this.setStatus('ok');
    }
    let remote = null;
    if (read.text.trim()) {
      try {
        remote = decodeDataFile(read.text);
      } catch (e) {
        return this.setStatus('error', $t('{0} cannot be read: {1} Nothing was written to it.', this.name, e.message));
      }
    }
    // an empty file (being replaced by a sync client, or emptied by hand) deletes nothing: it has no deletions
    const result = this.merge(remote || EMPTY, 'pull');
    if (!result) {
      return;
    }
    await this.finish(gen, result, remote, read.text, stat);
  }
  /** After a merge: the file is written if it lacks something, else both sides are recorded as in step. */
  async finish(gen, result, remote, text, stat) {
    if (remote) {
      this.savedAt = remote.saved;
      this.savedBy = remote.by;
    }
    if (result.remoteChanged || !remote || remote.kind !== 'data') {
      await this.writeNow(gen);
    } else {
      this.settle(this.store.planList(), text, stat);
    }
    if (gen === this.gen) {
      this.setStatus('ok');
    }
  }
  /** Writes the plans here, with the deleted plans (so a deletion reaches the other devices). */
  async writeNow(gen) {
    const list = this.store.planList();
    const saved = new Date().toISOString();
    const text = encodeDataFile(
      list.map(p => p.text),
      { saved, by: this.device, deletedPlans: this.store.db.deletedPlans },
    );
    const stat = await this.io.write(this.handle, text);
    if (gen !== this.gen) {
      return;
    }
    this.savedAt = saved;
    this.savedBy = this.device;
    this.settle(list, text, stat);
  }
  /** The file and this browser hold the same plans now. */
  settle(list, text, stat) {
    this.known = stat;
    this.lastText = text;
    this.pushed = list.map(p => p.text);
    this.saveMeta();
  }
  /**
   * Merges the file's plans into this browser's (synchronously: no change can slip in between), record by record.
   * Returns { localChanged, remoteChanged }, or null when it cannot be applied (over the plan limit).
   */
  merge(remote, how) {
    const merged = this.mergeWith(remote);
    if (merged.plans.length > APP.maxPlans) {
      const text = tooMany(this.name);
      if (how === 'pull') {
        this.setStatus('error', text);
      } else {
        this.onNotify(text, { kind: 'bad' });
      }
      return null;
    }
    if (merged.localChanged) {
      const label = how === 'pull' ? $t('Loaded changes from {0}', this.name) : $t('Opened {0}', this.name);
      this.store.adoptMerged(merged.plans, merged.deletedPlans, label);
      if (how === 'pull') {
        this.onNotify(label);
      }
    }
    return { localChanged: merged.localChanged, remoteChanged: merged.remoteChanged };
  }
  /** The merge of the plans here with the file's (models/recordMerge.js). */
  mergeWith(remote) {
    const local = { plans: this.store.planList().map(p => p.plan), deletedPlans: this.store.db.deletedPlans };
    return mergeData(local, { plans: remote.list.map(p => p.plan), deletedPlans: remote.deletedPlans || {} });
  }
  /** Picks a file, then makes it the data file: merged with the plans here, never overwritten blindly. */
  async link(pick, how) {
    let handle;
    try {
      handle = await pick();
    } catch (e) {
      if (!e || e.name !== 'AbortError') {
        this.onNotify($t('Could not open the file: {0}', String((e && e.message) || e)), { kind: 'bad' });
      }
      return false;
    }
    return (await this.run(() => this.adopt(handle, how))) === true;
  }
  async adopt(handle, how) {
    try {
      let read = null;
      try {
        read = await this.io.read(handle);
      } catch (e) {
        if (how === 'open') {
          throw e;
        }
      }
      const text = read ? read.text : '';
      let remote = null;
      if (text.trim()) {
        try {
          remote = decodeDataFile(text);
        } catch (e) {
          // a file chosen to open must be Runway data; a file chosen to save to is replaced, as the person confirmed
          if (how === 'open') {
            this.onNotify(e.message, { kind: 'bad' });
            return false;
          }
        }
      }
      // check the plan limit before anything changes
      if (this.mergeWith(remote || EMPTY).plans.length > APP.maxPlans) {
        this.onNotify(tooMany(handle.name), { kind: 'bad' });
        return false;
      }
      this.drop();
      const gen = this.gen;
      this.handle = handle;
      this.name = handle.name;
      try {
        await this.keep.set(HANDLE, handle);
      } catch (e) {} // remembered for this visit only: after a reload it has to be chosen again
      if (!this.store.db.fileSync) {
        this.store.setPref('fileSync', true);
      }
      const result = this.merge(remote || EMPTY, how);
      await this.finish(gen, result, remote, text, read && { modified: read.modified, size: read.size });
      this.onNotify(
        how === 'open'
          ? $t('Opened {0}. Your changes are saved to it as you make them.', this.name)
          : $t('Saving to {0}. Your changes are saved to it as you make them.', this.name),
      );
      return true;
    } catch (e) {
      this.fail(e);
      return false;
    }
  }
}

/** The app's data file, following the app's store. main.js starts it and wires the page events. */
export const Sync = new FileSync(Store);
