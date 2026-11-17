/**
 * @file Unit tests for the data file: the one JSON file, chosen by the person, that holds their plans. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP } from '../../src/config.js';
import { decodeDataFile, encodeDataFile } from '../../src/models/dataFile.js';
import { normPlan } from '../../src/models/plan.js';
import { samplePlan } from '../../src/models/samplePlan.js';
import { planText } from '../../src/models/records.js';
import { IO } from '../../src/services/backup.js';

const plan = normPlan({ id: 'plan0001', name: 'Home', incomes: [{ id: 'salary01', name: 'Salary', amount: 1000 }] });
const text = planText(plan);

test('the file says what it is, when it was saved and by which browser, then lists the plans', () => {
  const file = JSON.parse(encodeDataFile([text], { saved: '2026-11-16T10:00:00.000Z', by: 'dev12345' }));
  assert.equal(file.app, 'runway');
  assert.equal(file.kind, 'data');
  assert.equal(file.v, APP.schema);
  assert.equal(file.saved, '2026-11-16T10:00:00.000Z');
  assert.equal(file.by, 'dev12345');
  assert.deepEqual(file.plans, [JSON.parse(planText(plan))], 'each plan as the app stores it (planText)');
});

test('the file carries the deleted plans and reads them back', () => {
  const deletedPlans = { gone0001: { id: 'gone0001', createdAt: 1, updatedAt: 5, deletedAt: 5 } };
  const text = encodeDataFile([JSON.stringify(plan)], { deletedPlans });
  assert.deepEqual(decodeDataFile(text).deletedPlans, deletedPlans);
  assert.deepEqual(JSON.parse(text).deletedPlans, deletedPlans);
});

test('damaged deleted plans are dropped, not trusted', () => {
  const file = decodeDataFile(
    JSON.stringify({
      app: 'runway',
      kind: 'data',
      v: APP.schema,
      deletedPlans: {
        gone0001: { id: 'gone0001', createdAt: 1, updatedAt: 2, deletedAt: 'soon' },
        gone0002: { id: 'gone0002', createdAt: 1, updatedAt: 2, deletedAt: 2 },
        'bad id!': { id: 'bad id!', createdAt: 1, updatedAt: 2, deletedAt: 2 },
      },
      plans: [plan],
    }),
  );
  assert.deepEqual(Object.keys(file.deletedPlans), ['gone0002']);
});

test('a backup has no deleted plans', () => {
  const file = decodeDataFile(JSON.stringify({ app: 'runway', kind: 'backup', v: 1, plans: [plan] }));
  assert.deepEqual(file.deletedPlans, {});
});

test('a file with no plans is still a valid file', () => {
  const file = JSON.parse(encodeDataFile([], { saved: '2026-11-16T10:00:00.000Z', by: 'd' }));
  assert.deepEqual(file.plans, []);
  assert.deepEqual(decodeDataFile(encodeDataFile([])).list, []);
});

test('reading the file back gives the same plans, as the same text', () => {
  const sample = normPlan(samplePlan());
  const texts = [text, planText(sample)];
  const file = decodeDataFile(encodeDataFile(texts, { by: 'dev1' }));
  assert.deepEqual(
    file.list.map(p => p.id),
    [plan.id, sample.id],
  );
  assert.deepEqual(
    file.list.map(p => p.text),
    texts,
  );
  assert.deepEqual(file.list[1].plan, sample);
  assert.equal(file.kind, 'data');
  assert.equal(file.by, 'dev1');
});

test('a stored plan passes through normPlan unchanged, so another device sees no false change', () => {
  const sample = normPlan(samplePlan());
  const once = JSON.stringify(sample);
  assert.equal(JSON.stringify(normPlan(JSON.parse(once))), once);
});

test('what comes in from the file is cleaned by normPlan, like every other way in', () => {
  const file = decodeDataFile(
    JSON.stringify({
      app: 'runway',
      kind: 'data',
      v: APP.schema,
      plans: [
        { id: 'dup00001', name: 'A' },
        { id: 'dup00001', name: 'B' },
        { name: '<b>x</b>', settings: { horizon: 1e9 } },
        5,
      ],
    }),
  );
  assert.equal(file.list.length, 3);
  assert.equal(new Set(file.list.map(p => p.id)).size, 3, 'ids are unique');
  assert.ok(file.list[2].plan.settings.horizon <= 120);
  for (const p of file.list) {
    assert.equal(p.text, planText(p.plan));
    assert.equal(p.id, p.plan.id);
  }
});

test('an exported backup can be used as the data file', async () => {
  const file = decodeDataFile(await IO.backup([plan], ''));
  assert.equal(file.kind, 'backup');
  assert.equal(file.list[0].plan.name, 'Home');
});

test('the data file can be opened with "Import backup" too', async () => {
  const result = await IO.read(encodeDataFile([text]));
  assert.equal(result.plans[0].name, 'Home');
});

test('files that are not Runway data are refused with a readable message', () => {
  const readable = error => typeof error.message === 'string' && error.message.length > 5;
  assert.throws(() => decodeDataFile('not json'), readable);
  assert.throws(() => decodeDataFile('{"hello":1}'), readable);
  assert.throws(() => decodeDataFile('[]'), readable);
  assert.throws(() => decodeDataFile(JSON.stringify({ app: 'runway', kind: 'data', v: APP.schema })), readable);
  assert.throws(
    () => decodeDataFile(JSON.stringify({ app: 'runway', kind: 'data', v: APP.schema + 1, plans: [] })),
    readable,
  );
  assert.throws(
    () => decodeDataFile(JSON.stringify({ app: 'runway', kind: 'encrypted', v: 1, data: 'x' })),
    error => readable(error) && /encrypted/i.test(error.message),
  );
});

test('a file with more plans than the limit keeps the first ones', () => {
  const many = Array.from({ length: APP.maxPlans + 3 }, (_, i) => JSON.stringify(normPlan({ name: 'P' + i })));
  assert.equal(decodeDataFile(encodeDataFile(many)).list.length, APP.maxPlans);
});
