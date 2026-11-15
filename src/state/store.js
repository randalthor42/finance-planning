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

/** Holds the state, is the single place it changes, and keeps undo/redo and the activity log. Knows nothing about the page. */
export class PlanStore {
  constructor(adapter) {
    this.adapter = adapter;
    this.db = null;
    this.proj = null;
    this.undoS = [];
    this.redoS = [];
    this.saveOk = true;
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
    this.day = D.today();
    if (p) {
      setFmt(p.settings);
      this.proj = project(p, { today: this.day });
    } else {
      setFmt({ currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy', cents: false });
      this.proj = null;
    }
  }
  save() {
    this.saveOk = this.adapter.write(this.db);
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
    fn(draft);
    const clean = normPlan(draft);
    clean.id = this.db.active;
    if (JSON.stringify(clean) === prev) {
      return false;
    }
    const merge = !!this.tag && this.tag === this.lastTag;
    if (!merge) {
      this.undoS.push({ snap: prev, label: label || $t('Change') });
      if (this.undoS.length > 60) {
        this.undoS.shift();
      }
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
    this.lastTag = null;
    to.push({ snap: JSON.stringify(this.plan), label: u.label });
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
