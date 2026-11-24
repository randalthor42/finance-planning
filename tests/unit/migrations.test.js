/**
 * @file Unit tests for the migration runner and the migration to schema 7 (record metadata). Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP } from '../../src/config.js';
import { ID_RE } from '../../src/core/util.js';
import { MIGRATIONS, SCHEMA_VERSION, migrate, versionOf } from '../../src/models/migrations.js';
import { normPlan } from '../../src/models/plan.js';
import { DELETED_LISTS, RECORD_LISTS } from '../../src/models/records.js';
import { samplePlan } from '../../src/models/samplePlan.js';
import { PlanStore } from '../../src/state/store.js';
import { memoryAdapter } from './helpers/fakeFiles.js';

const NOW = 1_790_000_000_000;
/** A database as version 6 stored it: plans without dates (normalised by the old rules). */
function v6db() {
  const strip = x =>
    JSON.parse(
      JSON.stringify(x, (k, v) => (['createdAt', 'updatedAt', 'deletedAt', 'deleted'].includes(k) ? undefined : v)),
    );
  const a = strip(normPlan({ ...samplePlan(), id: 'plana001' }));
  const b = strip(normPlan({ id: 'planb001', name: 'Second', bills: [{ id: 'bill0001', name: 'Rent', amount: 800 }] }));
  a.bills.push({ name: 'No id yet', amount: 12 }); // a record without an id (hand-edited data, an old import)
  return {
    v: 6,
    active: a.id,
    plans: { [a.id]: a, [b.id]: b },
    theme: 'dark',
    log: [{ t: '2026-01-01T00:00:00.000Z', text: 'x' }],
  };
}
const records = plan => [plan, ...RECORD_LISTS.flatMap(l => plan[l]), ...plan.trips.flatMap(t => t.items)];
/** Everything but the new fields. */
const data = x =>
  JSON.parse(
    JSON.stringify(x, (k, v) =>
      ['createdAt', 'updatedAt', 'deletedAt', 'deleted', 'schemaVersion', 'deletedPlans', 'v'].includes(k)
        ? undefined
        : v,
    ),
  );

test('the current schema is 8, and the database says so', () => {
  assert.equal(SCHEMA_VERSION, 8);
  assert.equal(APP.schema, SCHEMA_VERSION);
  assert.deepEqual(
    MIGRATIONS.map(m => m.to),
    [7, 8],
  );
});

test('migration 7 → 8: each plan gets the time of each of its own fields (its updatedAt), nothing else changes', () => {
  const at7 = migrate(v6db(), { now: NOW, target: 7 }).db;
  const before = JSON.parse(JSON.stringify(at7));
  const { db, from, to } = migrate(at7, { now: NOW + 1000 });
  assert.deepEqual([from, to], [7, 8]);
  for (const plan of Object.values(db.plans)) {
    assert.deepEqual(plan.fieldsUpdatedAt, {
      name: NOW,
      settings: NOW,
      fixes: NOW,
      overrides: NOW,
      reserveOver: NOW,
      paid: NOW,
      notes: NOW,
      agenda: NOW,
      sim: NOW,
    });
  }
  const strip = x =>
    JSON.parse(JSON.stringify(x, (k, v) => (['fieldsUpdatedAt', 'schemaVersion', 'v'].includes(k) ? undefined : v)));
  assert.deepEqual(strip(db), strip(before));
});

test('the version of stored data: schemaVersion, or v before it existed; nothing stored is the current one', () => {
  assert.equal(versionOf({ schemaVersion: 7, v: 6 }), 7);
  assert.equal(versionOf({ v: 6 }), 6);
  assert.equal(versionOf({ plans: {} }), 1);
  assert.equal(versionOf(null), SCHEMA_VERSION);
});

test('migration 6 → 7: every record and plan gets id, createdAt, updatedAt and deletedAt null', () => {
  const { db, from, to, applied } = migrate(v6db(), { now: NOW, target: 7 });
  assert.deepEqual([from, to], [6, 7]);
  assert.equal(applied.length, 1);
  assert.equal(db.schemaVersion, 7);
  assert.equal(db.v, 7);
  for (const plan of Object.values(db.plans)) {
    for (const r of records(plan)) {
      assert.ok(ID_RE.test(r.id), 'id ' + r.id);
      assert.equal(r.createdAt, NOW);
      assert.equal(r.updatedAt, NOW);
      assert.equal(r.deletedAt, null);
    }
    for (const list of DELETED_LISTS) {
      assert.deepEqual(plan.deleted[list], []);
    }
  }
  assert.deepEqual(db.deletedPlans, {});
  const added = db.plans.plana001.bills.find(b => b.name === 'No id yet');
  assert.match(added.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4/, 'a missing id becomes a UUID');
});

test('migration 6 → 7 keeps all existing data: nothing but the new fields differs', () => {
  const before = v6db();
  const { db } = migrate(JSON.parse(JSON.stringify(before)), { now: NOW, target: 7 });
  const withoutNewIds = x => {
    const y = data(x);
    y.plans.plana001.bills = y.plans.plana001.bills.map(({ id, ...rest }) =>
      rest.name === 'No id yet' ? rest : { id, ...rest },
    );
    return y;
  };
  assert.deepEqual(withoutNewIds(db), data(before));
  // and once cleaned by normPlan, each plan is the same plan, the dates aside
  for (const id of Object.keys(before.plans)) {
    assert.deepEqual(data(normPlan(db.plans[id])), data(normPlan(JSON.parse(JSON.stringify(db.plans[id])))));
  }
});

test('running the migration again changes nothing (it only fills what is missing)', () => {
  const once = migrate(v6db(), { now: NOW }).db;
  const again = migrate(JSON.parse(JSON.stringify({ ...once, schemaVersion: 6 })), { now: NOW + 5000 }).db;
  assert.deepEqual(again, once);
});

test('records that already have dates keep them', () => {
  const db = v6db();
  db.plans.planb001.bills[0].createdAt = 1000;
  db.plans.planb001.bills[0].updatedAt = 2000;
  const out = migrate(db, { now: NOW }).db;
  assert.deepEqual([out.plans.planb001.bills[0].createdAt, out.plans.planb001.bills[0].updatedAt], [1000, 2000]);
});

test('the runner: applies the missing migrations in order, and none to current or newer data', () => {
  const seen = [];
  const list = [
    { to: 3, name: 'three', up: db => seen.push(3) },
    { to: 2, name: 'two', up: db => seen.push(2) },
    { to: 4, name: 'four', up: db => seen.push(4) },
  ];
  const r = migrate({ v: 1, plans: {} }, { now: NOW, migrations: list, target: 4 });
  assert.deepEqual(seen, [2, 3, 4]);
  assert.deepEqual(r.applied, ['two', 'three', 'four']);
  assert.equal(r.db.schemaVersion, 4);
  seen.length = 0;
  assert.deepEqual(migrate({ schemaVersion: 4, plans: {} }, { migrations: list, target: 4 }).applied, []);
  assert.deepEqual(
    migrate({ schemaVersion: 9, plans: {} }, { migrations: list, target: 4 }).applied,
    [],
    'newer data is left alone',
  );
  assert.deepEqual(seen, []);
  assert.deepEqual(migrate(null).applied, [], 'a first launch has nothing to migrate');
});

test('the store: a backup of the stored text is made before the migrated data is written', async () => {
  const adapter = memoryAdapter();
  adapter.text = JSON.stringify(v6db());
  const original = adapter.text;
  const order = [];
  let release;
  adapter.backup = (text, info) => {
    order.push(['backup', text === original, info.from, info.to]);
    return new Promise(resolve => (release = resolve));
  };
  const write = adapter.write.bind(adapter);
  adapter.write = (db, text) => {
    order.push(['write']);
    return write(db, text);
  };
  const store = new PlanStore(adapter);
  store.init();
  assert.equal(store.db.schemaVersion, SCHEMA_VERSION, 'migrated in memory');
  assert.equal(store.plan.bills[0].createdAt !== null, true);
  store.commit(p => p.bills.push({ name: 'Made at once', amount: 1 }), 'add');
  store.flush();
  assert.equal(adapter.text, original, 'nothing is written until the backup is kept');
  release(true);
  await store.migrated;
  assert.deepEqual(order[0], ['backup', true, 6, SCHEMA_VERSION]);
  assert.deepEqual(order.slice(1), [['write']]);
  const stored = JSON.parse(adapter.text);
  assert.equal(stored.schemaVersion, SCHEMA_VERSION);
  assert.ok(
    Object.values(stored.plans).some(p => p.bills.some(b => b.name === 'Made at once')),
    'the change waited, and was kept',
  );
  assert.ok(
    store.db.log.some(e => /format 8/.test(e.text)),
    'listed in the activity log',
  );
});

test('the store: if no backup can be kept, the data is still migrated (nothing is lost: the migration only adds)', async () => {
  const adapter = memoryAdapter();
  adapter.text = JSON.stringify(v6db());
  adapter.backup = async () => false;
  const store = new PlanStore(adapter);
  store.init();
  await store.migrated;
  assert.equal(JSON.parse(adapter.text).schemaVersion, SCHEMA_VERSION);
  assert.ok(store.db.log.some(e => /could not/i.test(e.text)));
});

test('the store: current data is not migrated, backed up or rewritten at start', async () => {
  const adapter = memoryAdapter();
  adapter.text = JSON.stringify(migrate(v6db(), { now: NOW }).db);
  let backups = 0;
  adapter.backup = async () => backups++;
  const writes = adapter.writes;
  const store = new PlanStore(adapter);
  store.init();
  await store.migrated;
  assert.equal(backups, 0);
  assert.equal(adapter.writes, writes);
});

test('only services/storage.js touches the browser storage', () => {
  const src = path.resolve(import.meta.dirname, '../../src');
  const walk = dir =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap(e =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : [],
      );
  const offenders = [];
  for (const file of walk(src)) {
    const code = fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    if (
      /\b(localStorage|sessionStorage|indexedDB|IDBKeyRange|document\.cookie)\b/.test(code) &&
      !file.endsWith(path.join('services', 'storage.js'))
    ) {
      offenders.push(path.relative(src, file));
    }
  }
  assert.deepEqual(offenders, []);
});

test('scripts/migrate.mjs runs the same migration on a stored database, a backup or a data file', async () => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runway-migrate-'));
  const script = path.resolve(import.meta.dirname, '../../scripts/migrate.mjs');
  const db = v6db();
  const backup = {
    app: 'runway',
    kind: 'backup',
    v: 6,
    exported: '2026-01-01T00:00:00.000Z',
    plans: Object.values(db.plans),
  };
  for (const [name, input] of [
    ['db.json', db],
    ['backup.json', backup],
  ]) {
    const from = path.join(dir, name);
    const to = path.join(dir, 'out-' + name);
    fs.writeFileSync(from, JSON.stringify(input));
    const said = execFileSync(process.execPath, [script, from, to], { encoding: 'utf8' });
    assert.match(said, /6 → 8/, said);
    const out = JSON.parse(fs.readFileSync(to, 'utf8'));
    const plans = Array.isArray(out.plans) ? out.plans : Object.values(out.plans);
    assert.equal(out.schemaVersion, SCHEMA_VERSION);
    assert.equal(out.v, SCHEMA_VERSION);
    assert.ok(
      plans.every(p => p.createdAt > 0 && p.bills.every(b => b.createdAt > 0 && b.deletedAt === null)),
      name,
    );
    assert.equal(plans.length, 2);
    if (name === 'backup.json') {
      assert.equal(out.kind, 'backup', 'still a backup: Import backup opens it');
    }
  }
  // already current: nothing to do, nothing written over
  const current = path.join(dir, 'out-db.json');
  const said = execFileSync(process.execPath, [script, current, current], { encoding: 'utf8' });
  assert.match(said, /already/i);
});
