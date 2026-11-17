/**
 * @file Application state: the active plan, its projection, undo and redo, the activity log.
 *
 * The store is the one place where records are saved. Every write of a plan goes through stampPlan
 * (models/records.js), which sets each record's createdAt, updatedAt and deletedAt, so no component can forget them;
 * deleting keeps the record (deletedAt), in the plan's `deleted` lists. At start, stored data from an older schema is
 * migrated (models/migrations.js) after a backup of it is kept. The IndexedDB record index (services/storage.js)
 * follows every write. See docs/data.md.
 */
import { APP } from '../config.js';
import { D } from '../core/dates.js';
import { setFmt } from '../core/format.js';
import { $t } from '../core/i18n.js';
import { uid } from '../core/util.js';
import { project } from '../logic/projection.js';
import { dbText, normDB, normPrefs } from '../models/db.js';
import { migrate, versionOf } from '../models/migrations.js';
import { normPlan } from '../models/plan.js';
import {
  RECORD_TYPE,
  planEntriesOf,
  planRecord,
  planText,
  recordEntry,
  stampPlan,
  timestamp,
} from '../models/records.js';
import { LocalStorageAdapter } from '../services/storage.js';

/** The first data format with sync dates on every record (models/migrations.js, migration 7). */
const DATED_SCHEMA = 7;
/** The date given to records whose real date was lost: older than any real one (models/recordMerge.js LEGACY). */
const OLDEST = 1;

/** Undo keeps at most this many steps… */
const UNDO_STEPS = 60;
/** …and at most this many characters of plan snapshots (about 2 MB in memory: JS strings are UTF-16). */
const UNDO_CHARS = 1e6;
/** The purchase log keeps at most MAX_ITEMS entries per plan (normPlan); a warning comes ITEMS_WARN entries before. */
const MAX_ITEMS = 5000;
const ITEMS_WARN = 4500;
/**
 * The JSON text of each plan object, made once. Plan objects are never changed in place (every change builds a new
 * one through normPlan: commit, undo, renamePlan, replacePlans), so a text stays right for as long as its object
 * lives. A save then joins texts instead of serialising every plan again, and commit reuses the open plan's text.
 */
const TEXT = new WeakMap();

/** Holds the state, is the single place it changes, and keeps undo/redo and the activity log. Knows nothing about the page. */
export class PlanStore {
  constructor(adapter) {
    this.adapter = adapter;
    this.db = null;
    this.proj = null;
    this.undoS = [];
    this.redoS = [];
    this.saveOk = true;
    /** Goes up every time the projection is recalculated: derived data cached for one revision is then stale (ui/memo.js). */
    this.rev = 0;
    /** A write to storage is waiting for the end of the current task (see save). */
    this.savePending = false;
    /** Total length of the undo snapshots, kept so the stack can be bounded by size. */
    this.undoChars = 0;
    this.day = null;
    this.tag = null;
    this.lastTag = null; // set by an autosaving pop-up so its saves count as one step
    this.onChange = () => {};
    this.onNotify = () => {}; // the UI subscribes to these
    /** Told after each write to the browser storage: the data file follows from there (state/fileSync.js). */
    this.onSaved = () => {};
    /** More listeners told after each write, like onSaved (Drive sync: state/driveSync.js). */
    this.savedHooks = new Set();
    /** Plans read at start but not cleaned by normPlan yet (not the open one): see init and cleanPlans. */
    this.pending = new Set();
    /** Resolves when a migration at start is finished: its backup kept and the migrated data written. */
    this.migrated = Promise.resolve();
    /** Writes wait while this is true: a migration's backup is being kept. */
    this.holding = false;
    /** This device's id (services/storage.js deviceId), once known. */
    this.deviceId = null;
    /** Runs work that can wait (the record index): main.js gives the browser's idle callback. */
    this.later = fn => setTimeout(fn, 1000);
    /** The newest time written or seen: now() never goes below it. */
    this.lastStamp = 0;
  }
  /** The device's clock, in ms (tests replace it). */
  clock() {
    return Date.now();
  }
  /**
   * The time written on records: one clock for every save. Never earlier than a time the data already holds (this
   * device's last save, or the newest change merged in from another device): a clock that was put back, or another
   * device's clock that runs ahead, could otherwise give a new edit an older time than the version it replaces, and
   * the edit would lose every merge.
   */
  now() {
    const time = Math.max(this.clock(), this.lastStamp + 1);
    this.lastStamp = time;
    return time;
  }
  /** Moves the clock's floor past the newest time in these plans and deleted plans. */
  seeTimes(plans, deletedPlans) {
    for (const p of plans) {
      this.lastStamp = Math.max(this.lastStamp, timestamp(p && p.updatedAt) ?? 0);
    }
    for (const d of Object.values(deletedPlans || {})) {
      this.lastStamp = Math.max(this.lastStamp, timestamp(d && d.deletedAt) ?? 0);
    }
  }
  /**
   * Cleans the plans that were read at start but not used yet. Called when every plan is needed, and by main.js
   * when the browser is idle after start-up, so opening the app only cleans the plan it shows.
   */
  cleanPlans() {
    for (const id of [...this.pending]) {
      this.cleanPlan(id);
    }
  }
  /** Cleans one plan read at start (one at a time when idle: each is a short task of its own). */
  cleanPlan(id) {
    if (!this.pending.delete(id)) {
      return;
    }
    const plan = this.db.plans[id];
    if (plan) {
      const clean = normPlan(plan);
      clean.id = id;
      this.db.plans[id] = clean;
    }
  }
  /** A plan's JSON text, from the cache when the plan did not change since it was last serialised. */
  textOf(plan) {
    let text = TEXT.get(plan);
    if (text === undefined) {
      text = planText(plan);
      TEXT.set(plan, text);
    }
    return text;
  }
  /** Every plan with its text, in order: what goes into the data file. */
  planList() {
    this.cleanPlans();
    return Object.values(this.db.plans).map(plan => ({ id: plan.id, text: this.textOf(plan), plan }));
  }
  get plan() {
    return this.db.active ? this.db.plans[this.db.active] : null;
  }
  /**
   * Reads the database. Data of an older schema is migrated here, in memory; it is written (and so replaces what is
   * stored) only after a backup of the stored text is kept (afterMigration).
   */
  init() {
    const text = this.adapter.readText ? this.adapter.readText() : null;
    let raw = null;
    try {
      raw = text === null ? this.adapter.read() : JSON.parse(text);
    } catch (e) {}
    // an older version of the app (before sync dates) rewrote data this browser had already stored with dates: it
    // dropped every date and deletion. Migrated again with "now", this stale copy would beat newer edits made on other
    // devices, so its records get the oldest date instead (any dated version, or deletion, elsewhere wins over them).
    const seen = this.adapter.schemaSeen ? this.adapter.schemaSeen() : 0;
    const from = versionOf(raw);
    const downgraded = !!raw && seen >= DATED_SCHEMA && from < DATED_SCHEMA;
    const migration = migrate(raw, { now: downgraded ? OLDEST : this.now() });
    this.pending = new Set();
    this.db = normDB(migration.db, this.pending);
    this.seeTimes(Object.values(this.db.plans), this.db.deletedPlans);
    this.recalc();
    this.migrated = migration.applied.length ? this.afterMigration(text, migration) : Promise.resolve();
    if (downgraded) {
      this.log(
        $t(
          'Opened in an older Runway, which drops sync dates: changes made there count as older than other devices’, and entries deleted there may come back.',
        ),
      );
    }
    if (from > APP.schema) {
      this.log($t('This data was saved by a newer version of Runway. Update this copy before making changes.'));
    }
    if (this.adapter.markSchema) {
      // also on a first start: what this browser writes from now on is dated data, so an older version that rewrites
      // it later is recognised (see `downgraded` above)
      this.adapter.markSchema(APP.schema);
    }
  }
  /** Keeps a backup of the stored text, then writes the migrated data (and any change made meanwhile). */
  afterMigration(text, { from, to, applied }) {
    this.holding = true;
    const done = kept => {
      this.holding = false;
      this.log(
        kept
          ? $t('Your data was updated to format {0}. A copy of it as it was is kept in this browser.', to)
          : $t('Your data was updated to format {0}. A copy of it as it was could not be kept.', to),
      );
      this.savePending = true;
      this.flush();
      this.later(() => this.reindex());
    };
    let keeping;
    try {
      keeping = this.adapter.backup ? this.adapter.backup(text, { from, to, applied }) : false; // started at once
    } catch (e) {
      keeping = Promise.reject(e);
    }
    return Promise.resolve(keeping).then(
      kept => done(!!kept),
      () => done(false),
    );
  }
  /** The record index (IndexedDB) follows a save: the records saved with new dates, and the plan record. */
  track(plan, touched) {
    if (!this.adapter.index) {
      return;
    }
    const entries = touched.map(([list, r]) => recordEntry(plan.id, RECORD_TYPE[list], r));
    entries.push(recordEntry(plan.id, 'plan', planRecord(plan)));
    this.adapter.index(entries, [[plan.id, plan.updatedAt]]);
  }
  /**
   * Brings the record index up to date with every plan (and deleted plan) whose records were not indexed as of its
   * updatedAt: after a migration, a merge from the data file, or a save the index missed. Runs when idle.
   */
  async reindex() {
    if (!this.adapter.reindex) {
      return;
    }
    // each part waits for a quiet moment: a first index of 10,000 records never holds the page up
    const pause = () => new Promise(resolve => this.later(resolve));
    for (const id of Object.keys(this.db.plans)) {
      if (this.pending.has(id)) {
        await pause();
        this.cleanPlan(id);
      }
      const plan = this.db.plans[id];
      if (!plan) {
        continue;
      }
      if (!(await this.adapter.indexCurrent(plan.id, plan.updatedAt))) {
        await this.adapter.reindex(plan.id, planEntriesOf(plan), plan.updatedAt, pause);
        if (this.db.plans[plan.id] && this.db.plans[plan.id] !== plan) {
          this.later(() => this.reindex()); // it changed meanwhile: once more
        }
      }
    }
    for (const gone of Object.values(this.db.deletedPlans)) {
      if (!(await this.adapter.indexCurrent(gone.id, gone.updatedAt))) {
        await this.adapter.reindex(gone.id, [recordEntry(gone.id, 'plan', gone)], gone.updatedAt, pause);
      }
    }
  }
  recalc() {
    const p = this.plan;
    this.rev++;
    this.day = D.today();
    if (p) {
      setFmt(p.settings);
      this.proj = project(p, { today: this.day });
    } else {
      setFmt({ currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy', cents: false });
      this.proj = null;
    }
  }
  /**
   * Saves the database. Several changes in one task (Mark all paid, an autosaving pop-up) are written once:
   * the write waits until the current task ends. flush() writes at once; main.js calls it when the page is hidden.
   */
  save() {
    if (this.savePending) {
      return;
    }
    this.savePending = true;
    setTimeout(() => this.flush(), 0);
  }
  /** Writes a pending save now. If the result differs from the last one, the page is told (the "Saved" badge). */
  flush() {
    if (!this.savePending || this.holding) {
      return; // a migration's backup is being kept: the write waits for it (afterMigration)
    }
    this.savePending = false;
    const wasOk = this.saveOk;
    this.saveOk = this.adapter.write(this.db, this.dbText());
    if (wasOk !== this.saveOk) {
      this.onChange();
    }
    this.onSaved();
    for (const hook of this.savedHooks) {
      hook();
    }
  }
  dbText() {
    return dbText(this.db, plan => this.textOf(plan));
  }
  /** Size of the stored database, in characters, and its share of a typical 5 MB browser quota (UTF-16: 2 bytes each). */
  storageUse() {
    const chars = this.dbText().length + this.adapter.key.length;
    return { chars, share: (chars * 2) / (5 * 1024 * 1024) };
  }
  /** Adds an undo step and drops the oldest ones beyond the step and size limits. */
  pushUndo(entry) {
    this.undoS.push(entry);
    this.undoChars += entry.snap.length;
    while (this.undoS.length > 1 && (this.undoS.length > UNDO_STEPS || this.undoChars > UNDO_CHARS)) {
      this.undoChars -= this.undoS.shift().snap.length;
    }
  }
  /** Adds a line to the activity log (what changed, when). `merge` replaces the last line instead (one line per autosaving pop-up). */
  log(text, merge) {
    const e = { t: new Date().toISOString(), text: String(text).slice(0, 200) };
    if (merge && this.db.log.length) {
      this.db.log[this.db.log.length - 1] = e;
    } else {
      this.db.log.push(e);
    }
    if (this.db.log.length > APP.maxLog) {
      this.db.log.splice(0, this.db.log.length - APP.maxLog);
    }
  }
  /**
   * The only way plan data changes. fn mutates a draft; the draft is validated by normPlan before it becomes state.
   * label describes the change in plain words for the log, the notification and undo.
   */
  commit(fn, label, opts) {
    const before = this.plan;
    const prev = this.textOf(before);
    const draft = JSON.parse(prev);
    const itemsBefore = this.plan.items.length;
    fn(draft);
    // normPlan keeps only the first MAX_ITEMS log entries: refuse the change instead of dropping a new entry silently
    if (Array.isArray(draft.items) && draft.items.length > MAX_ITEMS && draft.items.length > itemsBefore) {
      this.onNotify(
        $t('The purchase log is full ({0} entries). Export a backup, then delete old entries.', MAX_ITEMS),
        { kind: 'bad' },
      );
      return false;
    }
    const clean = normPlan(draft);
    clean.id = this.db.active;
    // the dates of every record: set here, on every save (a record like before keeps its dates)
    const { changed, touched } = stampPlan(before, clean, this.now());
    if (!changed) {
      return false;
    }
    TEXT.set(clean, planText(clean));
    const merge = !!this.tag && this.tag === this.lastTag;
    if (!merge) {
      this.pushUndo({ snap: prev, label: label || $t('Change') });
    } else if (label) {
      this.undoS[this.undoS.length - 1].label = label;
    }
    this.lastTag = this.tag;
    this.redoS = [];
    if (label) {
      this.log(label, merge);
    }
    this._set(clean, touched);
    if (label && !merge) {
      this.onNotify(label, opts || {});
    }
    if (itemsBefore < ITEMS_WARN && clean.items.length >= ITEMS_WARN) {
      this.onNotify(
        $t(
          'The purchase log has {0} of {1} entries. Export a backup and delete old ones soon.',
          clean.items.length,
          MAX_ITEMS,
        ),
        { kind: 'bad' },
      );
    }
    return true;
  }
  _set(plan, touched) {
    this.db.plans[this.db.active] = plan;
    this.track(plan, touched);
    this.recalc();
    this.save();
    this.onChange();
  }
  _step(from, to, word) {
    if (!from.length) {
      return;
    }
    const u = from.pop();
    if (from === this.undoS) {
      this.undoChars -= u.snap.length;
    }
    this.lastTag = null;
    const entry = { snap: this.textOf(this.plan), label: u.label };
    if (to === this.undoS) {
      this.pushUndo(entry);
    } else {
      to.push(entry);
    }
    this.log(`${word}: ${u.label}`);
    // undo and redo are saves too: what they bring back or take away gets today's dates
    const restored = normPlan(JSON.parse(u.snap));
    const { touched } = stampPlan(this.plan, restored, this.now());
    this._set(restored, touched);
    this.onNotify(`${word}: ${u.label}`, { kind: 'undo' });
  }
  undo() {
    this._step(this.undoS, this.redoS, $t('Undone'));
  }
  redo() {
    this._step(this.redoS, this.undoS, $t('Redone'));
  }
  addPlan(p, activate = true) {
    if (Object.keys(this.db.plans).length >= APP.maxPlans) {
      return null;
    }
    const c = normPlan(p);
    while (this.db.plans[c.id]) {
      c.id = uid();
    }
    // a plan new in this browser: made now; its records keep the dates they have (an import), or get now
    c.createdAt = null;
    c.updatedAt = null;
    stampPlan(null, c, this.now());
    const names = Object.values(this.db.plans).map(x => x.name);
    let nm = c.name;
    let i = 2;
    while (names.includes(nm)) {
      nm = `${c.name} (${i++})`;
    }
    c.name = nm;
    this.db.plans[c.id] = c;
    delete this.db.deletedPlans[c.id];
    this.later(() => this.reindex()); // all its records go into the record index
    this.log($t('Added plan “{0}”', c.name));
    if (activate) {
      this.switchTo(c.id);
    } else {
      this.save();
    }
    return c;
  }
  reset() {
    this.undoS = [];
    this.undoChars = 0;
    this.redoS = [];
    this.lastTag = null;
    this.recalc();
    this.save();
    this.onChange();
  }
  switchTo(id) {
    if (!this.db.plans[id]) {
      return;
    }
    this.cleanPlans();
    this.db.active = id;
    this.reset();
  }
  /** Give a plan (open or not) a new name. A name another plan already has gets a number, like in addPlan. */
  renamePlan(id, name) {
    this.cleanPlans();
    const plan = this.db.plans[id];
    if (!plan || plan.name === name) {
      return;
    }
    const others = Object.values(this.db.plans)
      .filter(x => x.id !== id)
      .map(x => x.name);
    let unique = name;
    let n = 2;
    while (others.includes(unique)) {
      unique = `${name} (${n++})`;
    }
    this.log($t('Renamed plan “{0}” to “{1}”', plan.name, unique));
    // a new object: plans are never changed in place (TEXT); the plan record is saved with a change
    const now = this.now();
    const renamed = { ...plan, name: unique, updatedAt: now, fieldsUpdatedAt: { ...plan.fieldsUpdatedAt, name: now } };
    this.db.plans[id] = renamed;
    this.track(renamed, []);
    this.save();
    this.onChange();
  }
  removePlan(id) {
    const p = this.db.plans[id];
    if (!p) {
      return;
    }
    this.log($t('Deleted plan “{0}”', p.name));
    delete this.db.plans[id];
    // not forgotten: the plan record stays as deleted (its id and dates; its contents go, as they could be large)
    const now = this.now();
    this.db.deletedPlans[id] = { id, createdAt: p.createdAt ?? now, updatedAt: now, deletedAt: now };
    if (this.adapter.reindex) {
      this.adapter.reindex(id, [recordEntry(id, 'plan', this.db.deletedPlans[id])], now);
    }
    if (this.db.active === id) {
      this.db.active = Object.keys(this.db.plans)[0] || null;
    }
    this.reset();
  }
  /** Changes one browser preference. Only the preferences are cleaned again, not every plan (normPrefs). */
  setPref(k, v) {
    Object.assign(this.db, normPrefs({ ...this.db, [k]: v }));
    this.save();
    this.onChange();
  }
  /**
   * Puts in the plans merged with the data file (another device changed it). entries: [{ plan, text? }] in order;
   * text, when given, is the plan's JSON text. Undo starts again only if the open plan changed, and the projection
   * is recalculated only then. deletedPlans: the deleted plans of a merge (models/recordMerge.js), taken as they are.
   */
  replacePlans(entries, label, deletedPlans = null) {
    this.pending.clear(); // every plan is replaced
    this.seeTimes(
      entries.map(e => e.plan),
      deletedPlans,
    );
    const before = this.plan;
    const plans = {};
    for (const e of entries) {
      plans[e.plan.id] = e.plan;
      if (e.text !== undefined) {
        TEXT.set(e.plan, e.text);
      }
    }
    // records merged from the file keep the dates of the device that changed them; a plan that is gone is deleted
    const now = this.now();
    if (deletedPlans) {
      this.db.deletedPlans = { ...deletedPlans };
    }
    for (const [id, p] of Object.entries(this.db.plans)) {
      if (!plans[id] && !this.db.deletedPlans[id]) {
        this.db.deletedPlans[id] = { id, createdAt: p.createdAt ?? now, updatedAt: now, deletedAt: now };
      }
    }
    for (const id of Object.keys(plans)) {
      delete this.db.deletedPlans[id];
    }
    this.db.plans = plans;
    this.later(() => this.reindex());
    if (!plans[this.db.active]) {
      this.db.active = entries.length ? entries[0].plan.id : null;
    }
    if (this.plan !== before) {
      this.undoS = [];
      this.undoChars = 0;
      this.redoS = [];
      this.lastTag = null;
      this.recalc();
    }
    if (label) {
      this.log(label);
    }
    this.save();
    this.onChange();
  }
  /** A merged plan as normPlan leaves it; the plan here itself when the merge did not change it (undo stays). */
  sameOrClean(plan) {
    const current = this.db.plans[plan.id];
    if (current === plan) {
      return plan;
    }
    const clean = normPlan(plan);
    const text = planText(clean);
    if (current && this.textOf(current) === text) {
      return current;
    }
    TEXT.set(clean, text);
    return clean;
  }
  /** Puts in the result of mergeData (Drive sync, QR transfer, import): its plans, in order, and its deleted plans. */
  adoptMerged(plans, deletedPlans, label) {
    // checked like every plan (normPlan): a merge can join records that no longer fit together (an item paid from an
    // account deleted on the other device); normPlan keeps every date, so nothing is re-dated here
    this.replacePlans(
      plans.map(plan => ({ plan: this.sameOrClean(plan) })),
      label,
      deletedPlans,
    );
  }
  clearLog() {
    this.db.log = [];
    this.save();
    this.onChange();
  }
  /**
   * "Delete everything": a reset of this browser, on purpose not a deletion of records (nothing is kept, for
   * privacy): the database, the record index and the migration backups.
   */
  wipe() {
    this.pending.clear();
    if (this.adapter.clearCopies) {
      this.adapter.clearCopies();
    }
    this.db = normDB(null);
    this.reset();
  }
}
export const Store = new PlanStore(new LocalStorageAdapter(APP.key));
