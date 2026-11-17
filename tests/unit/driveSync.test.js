/**
 * @file Unit tests for Drive sync (state/driveSync.js) with the real Drive client (services/drive.js) against a fake
 * Google Drive (helpers/fakeDrive.js). Each "device" is a store with its own storage; both use one Google account.
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { samplePlan } from '../../src/models/samplePlan.js';
import { driveClient } from '../../src/services/drive.js';
import { DriveSync } from '../../src/state/driveSync.js';
import { PlanStore } from '../../src/state/store.js';
import { FakeDrive, fakeAuth } from './helpers/fakeDrive.js';
import { memoryAdapter, memoryKeep, memoryMeta } from './helpers/fakeFiles.js';

let clock = 1_790_000_000_000;
/** One device: its store (with the sample plan, or none), its Drive sync. */
function device(
  drive,
  { plans = [samplePlan()], auth = fakeAuth(drive), keep = memoryKeep(), meta = memoryMeta(), adapter } = {},
) {
  const store = new PlanStore(adapter || memoryAdapter());
  store.now = () => (clock += 1000);
  store.later = () => {};
  store.onNotify = () => {};
  store.init();
  if (!adapter) {
    for (const p of plans) {
      store.addPlan(p, false);
    }
    if (plans.length) {
      store.switchTo(Object.keys(store.db.plans)[0]);
    }
    store.flush();
  }
  const backups = [];
  const sync = new DriveSync(store, {
    client: token => driveClient({ fetch: drive.fetch, token }),
    auth,
    keep,
    meta,
    online: () => !drive.offline,
    debounce: 5,
    backup: async (text, info) => backups.push({ text, info }),
    now: () => drive.clock,
  });
  return { store, sync, auth, keep, meta, backups, adapter: store.adapter };
}
/** The device saves, then its sync finishes. */
async function settle(d) {
  d.store.flush();
  await d.sync.idle();
}
const addBill = (d, name, amount = 30) => d.store.commit(p => p.bills.push({ name, amount }), 'Added ' + name);
const bills = d => d.store.plan.bills.map(b => b.name);
const cloud = drive => JSON.parse(drive.file().content);

test('Turn on sync: signs in, backs up this device first, then keeps one file in the app data folder', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  addBill(a, 'Deleted before sync');
  a.store.commit(p => (p.bills = p.bills.filter(b => b.name !== 'Deleted before sync')), 'x');
  a.store.flush();
  await a.sync.turnOn();
  assert.equal(a.sync.status, 'synced');
  assert.equal(a.auth.signIns, 1);
  assert.equal(a.backups.length, 1, 'a backup before the first sync');
  assert.equal(a.backups[0].text, a.store.dbText());
  assert.match(a.backups[0].info.reason, /first/i);
  const file = drive.file();
  assert.equal(file.name, 'runway-sync.json');
  const data = cloud(drive);
  assert.equal(data.app, 'runway');
  assert.equal(data.kind, 'backup');
  assert.deepEqual(
    data.plans.map(p => p.id),
    Object.keys(a.store.db.plans),
  );
  assert.ok(
    data.plans[0].deleted.bills.some(b => b.name === 'Deleted before sync'),
    'deleted records are in the file too',
  );
  assert.deepEqual(data.deletedPlans, {});
});

test('a second device with the same account gets the data when it turns sync on: no pairing', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  assert.deepEqual(Object.keys(b.store.db.plans), Object.keys(a.store.db.plans));
  assert.deepEqual(bills(b), bills(a));
  assert.equal(b.backups.length, 1, 'the second device is backed up first too');
});

test('a change made while an upload is on its way is not taken as synced: it goes up next', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const realFetch = drive.fetch;
  let edited = false;
  drive.fetch = async (url, init = {}) => {
    if (init.method === 'PATCH' && !edited) {
      edited = true; // the person adds a bill while the first change is being uploaded
      addBill(a, 'Added during the upload');
      a.store.flush();
    }
    return realFetch(url, init);
  };
  addBill(a, 'Before the upload');
  await settle(a);
  assert.ok(edited, 'the edit happened during an upload');
  const names = cloud(drive).plans[0].bills.map(b => b.name);
  assert.ok(names.includes('Before the upload'));
  assert.ok(names.includes('Added during the upload'), 'the change made during the upload reached Drive');
  assert.equal(a.sync.localChanges(), false);
});

test('a cloud file with no plans (sync turned on before any plan existed) does not break other devices', async () => {
  const drive = new FakeDrive();
  const empty = device(drive, { plans: [] });
  await empty.sync.turnOn();
  assert.equal(empty.sync.status, 'synced');
  assert.deepEqual(cloud(drive).plans, [], 'the file was made with no plans');
  const a = device(drive);
  await a.sync.turnOn();
  assert.equal(a.sync.status, 'synced', 'a device with plans reads the empty file without an error');
  assert.equal(cloud(drive).plans.length, 1, 'and adds its plan');
  await empty.sync.sync('open');
  assert.equal(empty.sync.status, 'synced');
  assert.equal(empty.store.planList().length, 1, 'the first device gets the plan');
});

test('two devices edit the same record: the later edit wins everywhere', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  const id = a.store.plan.bills[0].id;
  a.store.commit(p => (p.bills[0].amount = 111), 'A');
  b.store.commit(p => (p.bills.find(x => x.id === id).amount = 222), 'B'); // later (the clock moves on)
  await settle(a);
  await settle(b);
  await a.sync.sync('open');
  assert.equal(a.store.plan.bills.find(x => x.id === id).amount, 222);
  assert.equal(b.store.plan.bills.find(x => x.id === id).amount, 222);
  assert.equal(cloud(drive).plans[0].bills.find(x => x.id === id).amount, 222);
});

test('a deletion on one device reaches the other (tombstone)', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  const gone = a.store.plan.bills[0];
  a.store.commit(p => (p.bills = p.bills.slice(1)), 'deleted');
  await settle(a);
  await b.sync.sync('foreground');
  assert.ok(!b.store.plan.bills.some(x => x.id === gone.id));
  assert.ok(b.store.plan.deleted.bills.some(x => x.id === gone.id && x.deletedAt > 0));
});

test('changes made offline wait, then sync when the connection returns (the offline queue)', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  drive.offline = true;
  addBill(b, 'Offline 1');
  addBill(b, 'Offline 2');
  await settle(b);
  assert.equal(b.sync.status, 'offline');
  assert.equal(b.sync.pending, true);
  assert.equal(b.meta.load().pending, true, 'remembered, even if the app is closed');
  assert.ok(bills(b).includes('Offline 2'), 'the app works on as usual');
  drive.offline = false;
  b.sync.online();
  await b.sync.idle();
  assert.equal(b.sync.status, 'synced');
  assert.equal(b.sync.pending, false);
  await a.sync.sync('open');
  assert.ok(bills(a).includes('Offline 1') && bills(a).includes('Offline 2'));
});

test('pending changes are pushed when the app is opened again', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  drive.offline = true;
  addBill(a, 'Queued');
  await settle(a);
  drive.offline = false;
  const again = device(drive, { adapter: a.adapter, keep: a.keep, meta: a.meta, auth: a.auth });
  await again.sync.start();
  await again.sync.idle();
  assert.equal(again.sync.status, 'synced');
  assert.ok(cloud(drive).plans[0].bills.some(b => b.name === 'Queued'));
});

test('opened again with nothing new on either side: one listing request, no download, no upload', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  drive.calls.length = 0;
  const again = device(drive, { adapter: a.adapter, keep: a.keep, meta: a.meta, auth: a.auth });
  await again.sync.start();
  await again.sync.idle();
  assert.equal(again.sync.status, 'synced');
  assert.deepEqual(drive.calls, ['GET /drive/v3/files']);
});

test('concurrent pushes: another device writes between our read and our write; we read again and merge', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  addBill(b, 'From B');
  await settle(b);
  addBill(a, 'From A');
  a.store.flush();
  // A's sync reads the file, then B pushes again before A writes: A's write is refused (If-Match), A tries again
  drive.beforeUpdate = () => {
    addBill(b, 'From B, meanwhile');
    b.store.flush();
    return b.sync.sync('change');
  };
  await a.sync.idle();
  assert.equal(drive.refused, 1, "A's first write was refused: the file was no longer the version A read");
  await b.sync.idle();
  await a.sync.sync('open');
  await b.sync.sync('open');
  for (const d of [a, b]) {
    for (const name of ['From A', 'From B', 'From B, meanwhile']) {
      assert.ok(bills(d).includes(name), `${name} on every device`);
    }
  }
  assert.deepEqual(bills(a), bills(b));
});

test('a file changed since it was read (seen before writing) is read again first', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const file = drive.file();
  const other = cloud(drive);
  other.plans[0].notes['2030-01'] = 'Written elsewhere';
  other.plans[0].fieldsUpdatedAt.notes = drive.clock + 10 ** 9;
  addBill(a, 'Local');
  a.store.flush();
  drive.write(file.id, JSON.stringify(other)); // the file moved on since A's last sync
  await a.sync.idle();
  assert.equal(a.store.plan.notes['2030-01'], 'Written elsewhere');
  assert.ok(cloud(drive).plans[0].bills.some(b => b.name === 'Local'));
});

test('an expired token: "Sign in again", changes kept; after signing in they sync', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  drive.tokens.clear(); // Google no longer accepts the token (an hour later)
  addBill(a, 'After expiry');
  await settle(a);
  assert.equal(a.sync.status, 'signin');
  assert.equal(a.sync.pending, true);
  assert.ok(!drive.file().content.includes('After expiry'));
  await a.sync.signInAgain();
  assert.equal(a.sync.status, 'synced');
  assert.ok(drive.file().content.includes('After expiry'));
});

test('a token past its time is not even tried: "Sign in again" at once, no request', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  await a.keep.set('driveToken', { token: 'old', expiresAt: drive.clock - 1 });
  const calls = drive.calls.length;
  const again = device(drive, { adapter: a.adapter, keep: a.keep, meta: a.meta, auth: a.auth });
  await again.sync.start();
  await again.sync.idle();
  assert.equal(again.sync.status, 'signin');
  assert.equal(drive.calls.length, calls);
});

test('nothing changed on Drive: a sync only lists the files, and writes only local changes', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  drive.calls.length = 0;
  await a.sync.sync('foreground');
  assert.deepEqual(drive.calls, ['GET /drive/v3/files'], 'no download, no upload');
  drive.calls.length = 0;
  addBill(a, 'One');
  addBill(a, 'Two');
  await settle(a);
  assert.equal(drive.calls.filter(c => c.startsWith('PATCH')).length, 1, 'changes in a row: one upload');
  assert.ok(!drive.calls.some(c => c.includes('alt=media')), 'nothing downloaded');
});

test('passphrase: the file is encrypted; another device needs it once; a wrong one is refused', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  await a.sync.setPassphrase('correct horse battery');
  const file = cloud(drive);
  assert.equal(file.kind, 'encrypted');
  assert.ok(!drive.file().content.includes(a.store.plan.bills[0].name));
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  assert.equal(b.sync.status, 'locked');
  assert.deepEqual(Object.keys(b.store.db.plans), [], 'nothing merged without it');
  assert.equal(await b.sync.unlock('wrong'), false);
  assert.equal(b.sync.status, 'locked');
  assert.equal(await b.sync.unlock('correct horse battery'), true);
  assert.equal(b.sync.status, 'synced');
  assert.deepEqual(bills(b), bills(a));
  await a.sync.setPassphrase(null);
  assert.equal(cloud(drive).kind, 'backup', 'turned off: plain again');
});

test('passphrase removed on one device: the other follows instead of encrypting the file again', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  await a.sync.setPassphrase('correct horse battery');
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  assert.equal(await b.sync.unlock('correct horse battery'), true);
  await a.sync.setPassphrase(null);
  assert.equal(cloud(drive).kind, 'backup');
  addBill(b, 'After the passphrase was removed');
  await settle(b);
  assert.equal(cloud(drive).kind, 'backup', 'B did not encrypt it again');
  assert.equal(b.sync.encrypted, false, 'B forgot the passphrase');
  await a.sync.sync('open');
  assert.equal(a.sync.status, 'synced', 'A can still read the file');
  assert.ok(bills(a).includes('After the passphrase was removed'));
});

test('a new passphrase replaces the old one in the file, even though the old one still opens it', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  await a.sync.setPassphrase('first passphrase');
  await a.sync.setPassphrase('second passphrase');
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  assert.equal(await b.sync.unlock('first passphrase'), false, 'the old one no longer opens it');
  assert.equal(await b.sync.unlock('second passphrase'), true);
});

test('two devices that made the sync file at the same moment end on one file, with both sides’ data', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  const b = device(drive);
  addBill(b, 'Only on B');
  b.store.flush();
  // both find no file and make one: Drive now holds two
  await Promise.all([a.sync.turnOn(), b.sync.turnOn()]);
  assert.equal(drive.files.size, 2, 'two files were made');
  await a.sync.sync('open');
  await b.sync.sync('open');
  await a.sync.sync('open');
  const files = [...drive.files.values()];
  assert.equal(files.length, 1, 'the extra file was merged and deleted');
  for (const d of [a, b]) {
    const everyBill = d.store.planList().flatMap(p => p.plan.bills.map(x => x.name));
    assert.ok(everyBill.includes('Only on B'), 'every device has B’s bill');
    assert.equal(d.store.planList().length, 2, 'and both plans');
    assert.equal(d.sync.state.fileId, files[0].id, 'every device syncs to the same file');
  }
});

test('Delete my cloud data while a sync is waiting: the file is not made again', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  addBill(a, 'Waiting to sync');
  a.store.flush(); // a sync is now waiting for its short delay
  const deleting = a.sync.deleteCloudData();
  await deleting;
  await new Promise(resolve => setTimeout(resolve, 20)); // past the delay
  assert.equal(drive.files.size, 0, 'nothing in Drive');
  assert.equal(a.sync.status, 'off');
});

test('if Drive does not check If-Match, a write that replaced another device’s is repaired by that device', async () => {
  const drive = new FakeDrive();
  drive.ignoreIfMatch = true;
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  addBill(a, 'From A');
  a.store.flush();
  // B writes between A's last check and A's write: A's write replaces it (the last write wins)
  drive.beforeUpdate = () => {
    addBill(b, 'From B');
    b.store.flush();
    return b.sync.sync('change');
  };
  await a.sync.idle();
  await b.sync.idle();
  await b.sync.sync('open'); // B sees A's version, which lacks its bill: merges and writes it back
  await a.sync.sync('open');
  for (const d of [a, b]) {
    assert.ok(bills(d).includes('From A') && bills(d).includes('From B'), 'both bills on every device');
  }
  const names = cloud(drive).plans[0].bills.map(x => x.name);
  assert.ok(names.includes('From A') && names.includes('From B'), 'and in Drive');
});

test('Turn off sync: no more requests; data stays here and in the cloud', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  await a.sync.turnOff();
  assert.equal(a.sync.status, 'off');
  const calls = drive.calls.length;
  addBill(a, 'After turning off');
  await settle(a);
  assert.equal(drive.calls.length, calls);
  assert.ok(drive.file(), 'the cloud copy stays');
  assert.ok(bills(a).includes('After turning off'));
});

test('Delete my cloud data: the file is gone and sync is off; the data here stays', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const before = bills(a);
  await a.sync.deleteCloudData();
  assert.equal(drive.file(), null);
  assert.equal(a.sync.status, 'off');
  assert.deepEqual(bills(a), before);
});

test('declining Google’s window leaves sync off, with nothing changed', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  a.auth.refuse = true;
  assert.equal(await a.sync.turnOn(), false);
  assert.equal(a.sync.status, 'off');
  assert.equal(drive.file(), null);
  assert.equal(a.backups.length, 0);
});

test('a local change never waits for the network', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  let release;
  const slow = drive.fetch;
  drive.fetch = (...args) => new Promise(r => (release = () => r(slow(...args))));
  a.sync.client = token => driveClient({ fetch: drive.fetch, token });
  addBill(a, 'Instant');
  assert.ok(bills(a).includes('Instant'), 'saved and shown at once');
  a.store.flush();
  assert.ok(a.adapter.text.includes('Instant'), 'and stored on the device');
  if (release) {
    release();
  }
  drive.fetch = slow;
});

test('plans deleted on one device are deleted on the other', async () => {
  const drive = new FakeDrive();
  const a = device(drive, { plans: [samplePlan(), normPlan({ name: 'Second' })] });
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  const second = Object.values(a.store.db.plans).find(p => p.name === 'Second');
  a.store.removePlan(second.id);
  await settle(a);
  await b.sync.sync('open');
  assert.ok(!b.store.db.plans[second.id]);
  assert.ok(b.store.db.deletedPlans[second.id]);
});

test('a plan renamed on one device has the new name on the other (its own fields merge by time)', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  a.store.renamePlan(a.store.db.active, 'Renamed on A');
  await settle(a);
  await b.sync.sync('foreground');
  assert.equal(b.store.plan.name, 'Renamed on A');
});

test('cloud data deleted from another device: this one stops syncing and says so, instead of uploading it again', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  const notes = [];
  a.sync.onNotify = text => notes.push(text);
  await b.sync.deleteCloudData();
  addBill(a, 'After the deletion');
  await settle(a);
  assert.equal(drive.file(), null, 'not made again');
  assert.equal(a.sync.status, 'off');
  assert.equal(notes.length, 1);
  assert.ok(bills(a).includes('After the deletion'), 'the data here stays');
});

test('a preference change (theme) is not a change to sync: no upload', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  drive.calls.length = 0;
  a.store.setPref('theme', 'dark');
  await settle(a);
  assert.ok(!drive.calls.some(c => c.startsWith('PATCH')), 'nothing uploaded');
  assert.equal(a.sync.pending, false);
});

test('back in the foreground: changes from the other device are looked for, not again within a few seconds', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  addBill(a, 'While B was away');
  await settle(a);
  drive.calls.length = 0;
  b.sync.visible();
  await b.sync.idle();
  assert.ok(bills(b).includes('While B was away'));
  const calls = drive.calls.length;
  b.sync.visible();
  await b.sync.idle();
  assert.equal(drive.calls.length, calls, 'a second focus right after: no request');
});

test('turned off in another tab: this tab stops too', async () => {
  const drive = new FakeDrive();
  const meta = memoryMeta();
  const a = device(drive, { meta });
  await a.sync.turnOn();
  meta.save({}); // the other tab's Turn off sync
  a.sync.reload();
  assert.equal(a.sync.status, 'off');
  const calls = drive.calls.length;
  addBill(a, 'After');
  await settle(a);
  assert.equal(drive.calls.length, calls);
});

test('turned off in the middle of a sync (Delete everything): nothing is brought back, no error', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  const b = device(drive, { plans: [] });
  await b.sync.turnOn();
  addBill(a, 'Later');
  await settle(a);
  b.sync.client = token =>
    driveClient({
      fetch: async (url, init) => {
        if (url.includes('alt=media')) {
          await b.sync.turnOff();
          b.store.wipe();
        }
        return drive.fetch(url, init);
      },
      token,
    });
  await b.sync.sync('open');
  assert.deepEqual(Object.keys(b.store.db.plans), []);
  assert.equal(b.sync.status, 'off');
});

test('Drive sync and the data file both follow saves (the data file sets store.onSaved after)', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  let fileSaves = 0;
  a.store.onSaved = () => fileSaves++; // what state/fileSync.js does when it starts
  addBill(a, 'Both');
  await settle(a);
  assert.equal(fileSaves, 1);
  assert.ok(cloud(drive).plans[0].bills.some(b => b.name === 'Both'));
});

test('a routine look that finds nothing new does not redraw anything (no Syncing… flicker)', async () => {
  const drive = new FakeDrive();
  const a = device(drive);
  await a.sync.turnOn();
  let redraws = 0;
  a.sync.onChange = () => redraws++;
  await a.sync.sync('poll');
  assert.equal(redraws, 0);
  addBill(a, 'Moves data');
  await settle(a);
  assert.equal(redraws, 2, 'Syncing… then Synced when data moves');
});

test('Google’s window blocked, or Drive access unticked: sync stays off and the person is told what to do', async () => {
  const drive = new FakeDrive();
  for (const type of ['popup_failed_to_open', 'scope']) {
    const a = device(drive);
    const notes = [];
    a.sync.onNotify = text => notes.push(text);
    a.auth.signIn = async () => {
      throw Object.assign(new Error(type), { type });
    };
    assert.equal(await a.sync.turnOn(), false);
    assert.equal(a.sync.status, 'off');
    assert.equal(notes.length, 1, type);
  }
  assert.equal(drive.file(), null);
});
