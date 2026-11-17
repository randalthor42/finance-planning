/**
 * @file Unit tests for the data file kept with the File System Access API (state/fileSync.js). Run with: npm test
 * Each "device" is a store (its own browser storage) with its own FileSync; devices that share a FakeDisk file are
 * like two computers with the file in a synced folder.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP } from '../../src/config.js';
import { decodeDataFile } from '../../src/models/dataFile.js';
import { normPlan } from '../../src/models/plan.js';
import { samplePlan } from '../../src/models/samplePlan.js';
import { FileSync } from '../../src/state/fileSync.js';
import { PlanStore } from '../../src/state/store.js';
import {
  FakeDisk,
  cancelled,
  fakeHandle,
  installPickers,
  memoryAdapter,
  memoryKeep,
  memoryMeta,
  pickerFor,
} from './helpers/fakeFiles.js';

const FILE = 'runway-data.json';

/**
 * One browser: its storage, its remembered file handle, its sync record. Pass them again to "reopen" it. The data
 * file option is turned on, as the person does in Settings (it is off by default), unless `off`.
 */
function device({ plans = [samplePlan()], adapter, keep = memoryKeep(), meta = memoryMeta(), off = false } = {}) {
  const store = new PlanStore(adapter || memoryAdapter());
  store.init();
  if (!adapter && !off) {
    store.setPref('fileSync', true);
  }
  if (!adapter) {
    for (const p of plans) {
      store.addPlan(p, false);
    }
    if (plans.length) {
      store.switchTo(Object.keys(store.db.plans)[0]);
    }
    store.flush();
  }
  const sync = new FileSync(store, { keep, meta, writeDelay: 0, watchEvery: 0 });
  const notes = [];
  sync.onNotify = text => notes.push(text);
  let changes = 0;
  sync.onChange = () => changes++;
  return { store, sync, keep, meta, adapter: store.adapter, notes, changes: () => changes };
}
/** Lets a device finish: the browser storage write, then the file write. */
async function settle(d) {
  d.store.flush();
  await d.sync.idle();
}
const addBill = (d, name, amount = 30) => d.store.commit(p => p.bills.push({ name, amount }), 'Added ' + name);
const billNames = d => d.store.plan.bills.map(b => b.name);
const fileTexts = disk => decodeDataFile(disk.text(FILE)).list.map(p => p.text);
const storeTexts = d => d.store.planList().map(p => p.text);

/** A device with the data file chosen. */
async function linked(disk, options) {
  const d = device(options);
  installPickers({ save: pickerFor(disk, FILE) });
  await d.sync.start();
  assert.equal(await d.sync.linkNew(), true);
  return d;
}
/** A second device that opens the same file. */
async function joined(disk, options = { plans: [] }) {
  const d = device(options);
  installPickers({ open: async () => fakeHandle(disk, FILE) });
  await d.sync.start();
  assert.equal(await d.sync.linkOpen(), true);
  return d;
}

test('without the File System Access API, the app keeps saving in the browser', async () => {
  installPickers();
  delete globalThis.showSaveFilePicker;
  const d = device();
  await d.sync.start();
  assert.equal(d.sync.status, 'unsupported');
  addBill(d, 'Climbing');
  await settle(d);
  assert.ok(d.adapter.text.includes('Climbing'));
});

test('off by default; turned on with no file chosen yet, it waits for one', async () => {
  installPickers();
  const d = device({ off: true });
  assert.equal(d.store.db.fileSync, false);
  await d.sync.start();
  assert.equal(d.sync.status, 'off');
  await d.sync.setEnabled(true);
  assert.equal(d.sync.status, 'unlinked');
});

test('choosing where to save writes every plan to that file and remembers the file', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk, { plans: [samplePlan(), normPlan({ name: 'Second' })] });
  assert.equal(d.sync.status, 'ok');
  assert.equal(d.sync.name, FILE);
  assert.deepEqual(fileTexts(disk), storeTexts(d));
  assert.equal(d.keep.map.get('file').name, FILE);
  const file = disk.json(FILE);
  assert.equal(file.kind, 'data');
  assert.equal(file.by, d.sync.device);
  assert.ok(!Number.isNaN(Date.parse(file.saved)));
});

test('cancelling the file picker changes nothing', async () => {
  const d = device();
  installPickers({ save: cancelled, open: cancelled });
  await d.sync.start();
  assert.equal(await d.sync.linkNew(), false);
  assert.equal(await d.sync.linkOpen(), false);
  assert.equal(d.sync.status, 'unlinked');
  assert.deepEqual(d.notes, []);
});

test('every change reaches the file; preferences are not written to it', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  const handle = d.keep.map.get('file');
  const writes = handle.writes;
  addBill(d, 'Climbing');
  await settle(d);
  assert.equal(handle.writes, writes + 1);
  assert.deepEqual(fileTexts(disk), storeTexts(d));
  d.store.setPref('theme', 'dark');
  await settle(d);
  assert.equal(handle.writes, writes + 1, 'a theme change does not rewrite the file');
  assert.ok(!disk.text(FILE).includes('"theme"'));
});

test('many quick changes are written together', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  const handle = d.keep.map.get('file');
  const writes = handle.writes;
  for (const name of ['A', 'B', 'C', 'D']) {
    addBill(d, name);
    d.store.flush();
  }
  await d.sync.idle();
  assert.equal(handle.writes, writes + 1);
  assert.deepEqual(fileTexts(disk), storeTexts(d));
});

test('routine saves do not redraw the page; a change of status does', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  const before = d.changes();
  addBill(d, 'Climbing');
  await settle(d);
  addBill(d, 'Swimming');
  await settle(d);
  assert.equal(d.changes(), before);
});

test('a change saved by another device appears here, and is not written back', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  assert.deepEqual(storeTexts(b), storeTexts(a), 'the new device got every plan');
  const bHandle = b.keep.map.get('file');
  const writes = bHandle.writes;
  addBill(a, 'Climbing');
  await settle(a);
  await b.sync.check();
  assert.ok(billNames(b).includes('Climbing'));
  assert.deepEqual(storeTexts(b), storeTexts(a));
  assert.equal(bHandle.writes, writes);
  assert.ok(
    b.notes.some(n => n.includes(FILE)),
    'the person is told: ' + b.notes.join(' | '),
  );
});

test('two devices editing in turn always end with the same plans', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  for (let i = 0; i < 4; i++) {
    addBill(a, 'A' + i);
    await settle(a);
    await b.sync.check();
    addBill(b, 'B' + i);
    await settle(b);
    await a.sync.check();
  }
  assert.deepEqual(storeTexts(a), storeTexts(b));
  assert.deepEqual(fileTexts(disk), storeTexts(a));
  assert.ok(['A0', 'B0', 'A3', 'B3'].every(n => billNames(a).includes(n)));
});

test('a change here waits for, and merges with, a change the other device saved first', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk, { plans: [samplePlan(), normPlan({ name: 'Second' })] });
  const b = await joined(disk);
  // a changes the first plan, b (not having looked yet) changes the second one
  addBill(a, 'From A');
  await settle(a);
  const second = Object.keys(b.store.db.plans)[1];
  b.store.switchTo(second);
  addBill(b, 'From B');
  await settle(b);
  await a.sync.check();
  assert.deepEqual(storeTexts(a), storeTexts(b));
  assert.deepEqual(fileTexts(disk), storeTexts(a));
  assert.equal(Object.keys(a.store.db.plans).length, 2, 'no conflict copies');
  assert.ok(a.store.db.plans[second].bills.some(x => x.name === 'From B'));
});

test('the same plan changed on both devices: both changes are kept in it, everywhere', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  addBill(a, 'From A');
  await settle(a);
  addBill(b, 'From B');
  await settle(b);
  await a.sync.check();
  assert.equal(Object.keys(b.store.db.plans).length, 1, 'one plan, no copy');
  for (const d of [a, b]) {
    assert.ok(billNames(d).includes('From A') && billNames(d).includes('From B'), 'both bills');
  }
  assert.deepEqual(storeTexts(a), storeTexts(b));
  assert.deepEqual(fileTexts(disk), storeTexts(a));
});

test('the same bill changed on both devices: the later change wins, everywhere', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  const id = a.store.plan.bills[0].id;
  a.store.commit(p => (p.bills.find(x => x.id === id).amount = 111), 'A');
  a.store.flush();
  await new Promise(resolve => setTimeout(resolve, 3)); // B's edit is later
  b.store.commit(p => (p.bills.find(x => x.id === id).amount = 222), 'B');
  await settle(b);
  await settle(a);
  await b.sync.check();
  await a.sync.check();
  for (const d of [a, b]) {
    assert.equal(d.store.plan.bills.find(x => x.id === id).amount, 222);
  }
});

test('checking an unchanged file reads nothing, and own saves are not taken for another device', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  addBill(d, 'Climbing');
  await settle(d);
  const handle = d.keep.map.get('file');
  const reads = handle.reads;
  const notes = d.notes.length;
  for (let i = 0; i < 5; i++) {
    await d.sync.check();
  }
  assert.equal(handle.reads, reads);
  assert.equal(d.notes.length, notes);
});

test('a browser opened again picks up what other devices saved meanwhile', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  const bAgain = { adapter: b.adapter, keep: b.keep, meta: b.meta };
  addBill(a, 'While b was closed');
  await settle(a);
  const b2 = device(bAgain);
  await b2.sync.start();
  assert.equal(b2.sync.status, 'ok');
  assert.ok(billNames(b2).includes('While b was closed'));
});

test('changes made while the file needed permission are saved to it after reconnecting', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  a.keep.map.get('file').permission = 'prompt'; // a new visit: the browser asks again
  const a2 = device({ adapter: a.adapter, keep: a.keep, meta: a.meta });
  await a2.sync.start();
  assert.equal(a2.sync.status, 'prompt');
  addBill(a2, 'Offline');
  await settle(a2);
  assert.ok(!disk.text(FILE).includes('Offline'), 'nothing is written without permission');
  assert.equal(await a2.sync.reconnect(), true);
  assert.equal(a2.sync.status, 'ok');
  assert.ok(disk.text(FILE).includes('Offline'));
  assert.deepEqual(fileTexts(disk), storeTexts(a2));
});

test('permission refused: it keeps asking, and the data stays in the browser', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const handle = a.keep.map.get('file');
  handle.permission = 'prompt';
  handle.grant = false;
  const a2 = device({ adapter: a.adapter, keep: a.keep, meta: a.meta });
  await a2.sync.start();
  assert.equal(await a2.sync.reconnect(), false);
  assert.equal(a2.sync.status, 'prompt');
  addBill(a2, 'Kept');
  await settle(a2);
  assert.ok(a2.adapter.text.includes('Kept'));
});

test('permission withdrawn while the app is open: it asks to reconnect', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  a.keep.map.get('file').permission = 'prompt';
  addBill(a, 'Climbing');
  await settle(a);
  assert.equal(a.sync.status, 'prompt');
});

test('a new browser with no plans opens the data file and gets everything, without rewriting it', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk, { plans: [samplePlan(), normPlan({ name: 'Second' })] });
  const text = disk.text(FILE);
  const b = await joined(disk);
  assert.equal(disk.text(FILE), text);
  assert.equal(b.store.db.active, Object.keys(b.store.db.plans)[0]);
  assert.deepEqual(storeTexts(b), storeTexts(a));
});

test('choosing a file that already holds Runway data adds to it, never overwrites it', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk, { plans: [normPlan({ name: 'From the file' })] });
  const b = device({ plans: [normPlan({ name: 'From this browser' })] });
  installPickers({ save: pickerFor(disk, FILE) });
  await b.sync.start();
  assert.equal(await b.sync.linkNew(), true);
  const names = decodeDataFile(disk.text(FILE))
    .list.map(p => p.plan.name)
    .sort();
  assert.deepEqual(names, ['From the file', 'From this browser']);
  assert.deepEqual(storeTexts(b), fileTexts(disk));
  assert.ok(a);
});

test('an exported backup can be opened as the data file; it is then saved in the data format', async () => {
  const disk = new FakeDisk();
  const { IO } = await import('../../src/services/backup.js');
  disk.write(FILE, await IO.backup([normPlan({ name: 'Backed up' })], ''));
  const d = await joined(disk);
  assert.equal(d.store.plan.name, 'Backed up');
  assert.equal(disk.json(FILE).kind, 'data');
});

test('opening a file that is not Runway data is refused and changes nothing', async () => {
  const disk = new FakeDisk();
  disk.write(FILE, '{"hello":"world"}');
  const d = device();
  installPickers({ open: async () => fakeHandle(disk, FILE) });
  await d.sync.start();
  assert.equal(await d.sync.linkOpen(), false);
  assert.equal(d.sync.status, 'unlinked');
  assert.equal(d.keep.map.size, 0);
  assert.equal(disk.text(FILE), '{"hello":"world"}');
  assert.equal(d.notes.length, 1);
});

test('a damaged file is never overwritten until the person says so', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  disk.write(FILE, '{"app":"runway","kind":"da');
  addBill(d, 'Climbing');
  await settle(d);
  assert.equal(disk.text(FILE), '{"app":"runway","kind":"da');
  assert.equal(d.sync.status, 'error');
  assert.ok(d.sync.error.length > 5);
  await d.sync.overwrite();
  assert.equal(d.sync.status, 'ok');
  assert.deepEqual(fileTexts(disk), storeTexts(d));
});

test('a file saved by a newer version of the app is left alone', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  const newer = disk.text(FILE).replace(`"v":${APP.schema}`, `"v":${APP.schema + 1}`);
  disk.write(FILE, newer);
  await d.sync.check();
  addBill(d, 'Climbing');
  await settle(d);
  assert.equal(disk.text(FILE), newer);
  assert.equal(d.sync.status, 'error');
});

test('the file moved or deleted: a clear message, and the data stays in the browser', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  disk.remove(FILE);
  addBill(d, 'Climbing');
  await settle(d);
  assert.equal(d.sync.status, 'error');
  assert.ok(d.sync.error.includes(FILE));
  assert.ok(d.adapter.text.includes('Climbing'));
});

test('Stop using this file: it is forgotten and left as it is', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  const text = disk.text(FILE);
  await d.sync.unlink();
  assert.equal(d.sync.status, 'unlinked');
  assert.equal(d.keep.map.size, 0);
  addBill(d, 'Climbing');
  await settle(d);
  d.store.wipe(); // "Delete everything" forgets the file first, so the file is not emptied
  await settle(d);
  assert.equal(disk.text(FILE), text);
});

test('turning the option off stops writing; turning it on again catches up with the same file', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  await d.sync.setEnabled(false);
  assert.equal(d.sync.status, 'off');
  assert.equal(d.store.db.fileSync, false);
  addBill(d, 'While off');
  await settle(d);
  assert.ok(!disk.text(FILE).includes('While off'));
  await d.sync.setEnabled(true);
  await d.sync.idle();
  assert.equal(d.sync.status, 'ok');
  assert.ok(disk.text(FILE).includes('While off'));
});

test('off at start: nothing is read or written', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  d.store.setPref('fileSync', false);
  d.store.flush();
  const handle = d.keep.map.get('file');
  const stats = handle.stats;
  const d2 = device({ adapter: d.adapter, keep: d.keep, meta: d.meta });
  await d2.sync.start();
  assert.equal(d2.sync.status, 'off');
  assert.equal(handle.stats, stats);
});

test('following other devices can be turned off', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  b.store.setPref('fileWatch', false);
  addBill(a, 'Climbing');
  await settle(a);
  await b.sync.check();
  assert.ok(!billNames(b).includes('Climbing'));
  // its own next save still merges first, so nothing from a is lost
  addBill(b, 'Swimming');
  await settle(b);
  assert.ok(billNames(b).includes('Climbing') || Object.keys(b.store.db.plans).length === 2);
  assert.deepEqual(fileTexts(disk), storeTexts(b));
});

test('if the browser cannot remember the file, it still works for this visit', async () => {
  const disk = new FakeDisk();
  const keep = memoryKeep();
  keep.set = async () => {
    throw new Error('DataCloneError');
  };
  const d = await linked(disk, { keep });
  assert.equal(d.sync.status, 'ok');
  addBill(d, 'Climbing');
  await settle(d);
  assert.ok(disk.text(FILE).includes('Climbing'));
});

test('with real timers: a change is written after writeDelay, and the watcher finds changes on its own', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  installPickers({ open: async () => fakeHandle(disk, FILE) });
  const b = device({ plans: [] });
  b.sync = new FileSync(b.store, { keep: b.keep, meta: b.meta, writeDelay: 5, watchEvery: 10 });
  await b.sync.start();
  assert.equal(await b.sync.linkOpen(), true);
  assert.ok(b.sync.watchTimer, 'watching while linked');
  addBill(a, 'Climbing');
  await settle(a);
  const deadline = Date.now() + 2000;
  while (!billNames(b).includes('Climbing') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.ok(billNames(b).includes('Climbing'), 'found by the watcher');
  addBill(b, 'Swimming');
  b.store.flush();
  assert.ok(b.sync.timer, 'the write waits writeDelay');
  await b.sync.idle();
  assert.ok(disk.text(FILE).includes('Swimming'));
  await b.sync.unlink();
  assert.equal(b.sync.watchTimer, 0, 'no timer is left running');
});

test('undo still works on the open plan after another device changed a different plan', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk, { plans: [samplePlan(), normPlan({ name: 'Second' })] });
  const b = await joined(disk);
  addBill(b, 'Mine');
  await settle(b);
  const second = Object.keys(a.store.db.plans)[1];
  a.store.switchTo(second);
  addBill(a, 'Theirs');
  await settle(a);
  b.store.switchTo(Object.keys(b.store.db.plans)[0]);
  await b.sync.check();
  assert.ok(b.store.db.plans[second].bills.some(x => x.name === 'Theirs'));
  assert.equal(b.store.undoS.length, 0, 'switching plans starts undo again');
  addBill(b, 'Undo me');
  await settle(b);
  await a.sync.check();
  a.store.switchTo(second);
  addBill(a, 'Theirs 2');
  await settle(a);
  await b.sync.check();
  assert.equal(b.store.undoS.length, 1, 'the open plan was untouched: its undo step is kept');
  b.store.undo();
  await settle(b);
  assert.ok(!billNames(b).includes('Undo me'));
  await a.sync.check();
  assert.deepEqual(storeTexts(a), storeTexts(b));
});

test('the browser copy always matches the state after changes from the file', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  addBill(a, 'Climbing');
  await settle(a);
  await b.sync.check();
  b.store.flush();
  assert.equal(b.adapter.text, JSON.stringify(b.store.db));
  assert.ok(
    b.store.db.log.some(e => e.text.includes(FILE)),
    'listed in the activity log',
  );
});

test('another tab turning the option off or on is followed here', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  a.store.db.fileSync = false; // what Store.init() reads after the other tab saved
  await a.sync.refresh();
  assert.equal(a.sync.status, 'off');
  addBill(a, 'While off');
  await settle(a);
  assert.ok(!disk.text(FILE).includes('While off'));
  a.store.db.fileSync = true;
  await a.sync.refresh();
  await a.sync.idle();
  assert.equal(a.sync.status, 'ok');
  assert.ok(disk.text(FILE).includes('While off'));
});

test('the sync client replaced this device’s save with a version that never saw it: both changes are kept', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  // each device saves its own change to its own copy of the file…
  const aDisk = new FakeDisk();
  a.keep.map.get('file').getFile = fakeHandle(aDisk, FILE).getFile; // (a writes to its own disk from now on)
  a.keep.map.get('file').createWritable = fakeHandle(aDisk, FILE).createWritable;
  aDisk.write(FILE, disk.text(FILE));
  a.sync.known = await a.sync.io.stat(a.keep.map.get('file'));
  addBill(a, 'Made on A');
  await settle(a);
  addBill(b, 'Made on B');
  await settle(b);
  // …then the sync client brings a's file over b's (last writer wins, as many do)
  disk.write(FILE, aDisk.text(FILE));
  await b.sync.check();
  const all = Object.values(b.store.db.plans).flatMap(p => p.bills.map(x => x.name));
  assert.ok(all.includes('Made on A'), 'a’s change arrived');
  assert.ok(all.includes('Made on B'), 'b’s change was not lost');
  assert.equal(Object.keys(b.store.db.plans).length, 1, 'in the one plan, with no copy');
  assert.deepEqual(fileTexts(disk), storeTexts(b));
});

test('a plan made here survives the sync client bringing a file that never had it', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  const old = disk.text(FILE); // a's copy of the file, before b's new plan reached it
  b.store.addPlan(normPlan({ name: 'Made on B' }), false);
  await settle(b);
  assert.equal(decodeDataFile(disk.text(FILE)).list.length, 2);
  disk.write(FILE, old.replace('"saved":"', '"saved":"2')); // a's older file wins the sync
  await b.sync.check();
  assert.ok(
    Object.values(b.store.db.plans).some(p => p.name === 'Made on B'),
    'not taken for a deletion',
  );
  assert.deepEqual(fileTexts(disk), storeTexts(b));
  assert.ok(a);
});

test('a plan deleted on one device is deleted on the other, even after the file went back and forth', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk, { plans: [samplePlan(), normPlan({ name: 'Old plan' })] });
  const b = await joined(disk);
  const old = Object.values(a.store.db.plans).find(p => p.name === 'Old plan').id;
  a.store.removePlan(old);
  await settle(a);
  await b.sync.check();
  assert.ok(!b.store.db.plans[old], 'deleted on b');
  addBill(b, 'Later change');
  await settle(b);
  await a.sync.check();
  assert.ok(!a.store.db.plans[old], 'and it does not come back');
  assert.deepEqual(storeTexts(a), storeTexts(b));
});

test('a plan deleted on one device but changed on the other at the same time is kept', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk, { plans: [samplePlan(), normPlan({ name: 'Disputed' })] });
  const b = await joined(disk);
  const id = Object.values(a.store.db.plans).find(p => p.name === 'Disputed').id;
  a.store.removePlan(id);
  await settle(a);
  await new Promise(resolve => setTimeout(resolve, 3)); // b's change is later than a's deletion
  b.store.switchTo(id);
  addBill(b, 'Still needed');
  await settle(b); // b's write finds a's deletion in the file first
  await a.sync.check();
  assert.ok(b.store.db.plans[id], 'kept on b');
  assert.ok(a.store.db.plans[id], 'and back on a');
  assert.deepEqual(storeTexts(a), storeTexts(b));
});

test('stopping while a write is under way: the late write does not bring the status back', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  const handle = d.keep.map.get('file');
  const slow = handle.createWritable;
  let release;
  handle.createWritable = async () => {
    await new Promise(resolve => (release = resolve));
    return slow();
  };
  addBill(d, 'Climbing');
  d.store.flush();
  d.sync.flushNow();
  await new Promise(resolve => setTimeout(resolve, 5));
  d.sync.unlink();
  release();
  await d.sync.idle();
  assert.equal(d.sync.status, 'unlinked');
});

test('the sync record kept in the browser is only this browser’s name', async () => {
  const disk = new FakeDisk();
  const d = await linked(disk);
  addBill(d, 'Climbing');
  await settle(d);
  d.sync.flushMeta(); // what pagehide does
  assert.deepEqual(Object.keys(d.meta.load() || {}), ['device']);
  assert.ok(JSON.parse(disk.text(FILE)).deletedPlans, 'the file has the deleted plans');
});

test('after a reload, a plan changed before the first sync is not mistaken for the remembered version', async () => {
  const disk = new FakeDisk();
  const a = await linked(disk);
  const b = await joined(disk);
  a.keep.map.get('file').permission = 'prompt';
  const a2 = device({ adapter: a.adapter, keep: a.keep, meta: a.meta });
  await a2.sync.start(); // waits for permission: the base is the stored fingerprints only
  addBill(a2, 'Changed while waiting');
  await settle(a2);
  addBill(b, 'Changed on b');
  await settle(b);
  await a2.sync.reconnect();
  const all = Object.values(a2.store.db.plans).flatMap(p => p.bills.map(x => x.name));
  assert.ok(all.includes('Changed while waiting') && all.includes('Changed on b'), 'both changes kept');
  await b.sync.check();
  assert.deepEqual(storeTexts(a2), storeTexts(b));
});
