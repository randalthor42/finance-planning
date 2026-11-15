/**
 * @file Application state: the active plan, its projection, undo and redo, the activity log.
 */
import { APP } from '../config.js';
import { D } from '../core/dates.js';
import { setFmt } from '../core/format.js';
import { $t } from '../core/i18n.js';
import { uid } from '../core/util.js';
import { project } from '../logic/projection.js';
import { normDB } from '../models/db.js';
import { normPlan } from '../models/plan.js';
import { LocalStorageAdapter } from '../services/storage.js';

/** Undo keeps at most this many steps… */
const UNDO_STEPS = 60;
/** …and at most this many characters of plan snapshots (about 2 MB in memory: JS strings are UTF-16). */
const UNDO_CHARS = 1e6;
/** The purchase log keeps at most MAX_ITEMS entries per plan (normPlan); a warning comes ITEMS_WARN entries before. */
const MAX_ITEMS = 5000;
const ITEMS_WARN = 4500;

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
  }
  get plan() {
    return this.db.active ? this.db.plans[this.db.active] : null;
  }
  init() {
    this.db = normDB(this.adapter.read());
    this.recalc();
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
    if (!this.savePending) {
      return;
    }
    this.savePending = false;
    const wasOk = this.saveOk;
    this.saveOk = this.adapter.write(this.db);
    if (wasOk !== this.saveOk) {
      this.onChange();
    }
  }
  /** Size of the stored database, in characters, and its share of a typical 5 MB browser quota (UTF-16: 2 bytes each). */
  storageUse() {
    const chars = JSON.stringify(this.db).length + this.adapter.key.length;
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
    const prev = JSON.stringify(this.plan);
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
    if (JSON.stringify(clean) === prev) {
      return false;
    }
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
    this._set(clean);
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
  _set(plan) {
    this.db.plans[this.db.active] = plan;
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
    const entry = { snap: JSON.stringify(this.plan), label: u.label };
    if (to === this.undoS) {
      this.pushUndo(entry);
    } else {
      to.push(entry);
    }
    this.log(`${word}: ${u.label}`);
    this._set(normPlan(JSON.parse(u.snap)));
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
    const names = Object.values(this.db.plans).map(x => x.name);
    let nm = c.name;
    let i = 2;
    while (names.includes(nm)) {
      nm = `${c.name} (${i++})`;
    }
    c.name = nm;
    this.db.plans[c.id] = c;
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
    this.db.active = id;
    this.reset();
  }
  /** Give a plan (open or not) a new name. A name another plan already has gets a number, like in addPlan. */
  renamePlan(id, name) {
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
    plan.name = unique;
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
    if (this.db.active === id) {
      this.db.active = Object.keys(this.db.plans)[0] || null;
    }
    this.reset();
  }
  setPref(k, v) {
    this.db[k] = v;
    this.db = normDB(this.db);
    this.save();
    this.onChange();
  }
  clearLog() {
    this.db.log = [];
    this.save();
    this.onChange();
  }
  wipe() {
    this.db = normDB(null);
    this.reset();
  }
}
export const Store = new PlanStore(new LocalStorageAdapter(APP.key));
