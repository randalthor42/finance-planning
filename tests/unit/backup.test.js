/**
 * @file Unit tests for backup files: plain and password-encrypted round trips. Run with: npm test
 */
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { IO } from '../../src/services/backup.js';
import { normPlan } from '../../src/models/plan.js';

// a new password on every run: no password is written in the code
const PASSWORD = randomUUID();
const WRONG = randomUUID();
const plan = normPlan({ name: 'Round trip', incomes: [{ id: 'salary01', name: 'Salary', amount: 1000 }] });

test('a plain backup reads back the same plan', async () => {
  const text = await IO.backup([plan], '');
  const result = await IO.read(text, '');
  assert.equal(result.plans[0].name, 'Round trip');
  assert.equal(result.plans[0].incomes[0].amount, 1000);
});

test('an encrypted backup does not contain the plan in clear text', async () => {
  const text = await IO.backup([plan], PASSWORD);
  assert.ok(!text.includes('Round trip'));
});

test('an encrypted backup opens with the right password and only with it', async () => {
  const text = await IO.backup([plan], PASSWORD);
  const result = await IO.read(text, PASSWORD);
  assert.equal(result.plans[0].name, 'Round trip');
  await assert.rejects(() => IO.read(text, WRONG));
});

test('a file that is not a backup is refused with a readable message', async () => {
  await assert.rejects(
    () => IO.read('{"hello":1}', ''),
    error => typeof error.message === 'string' && error.message.length > 0,
  );
  await assert.rejects(() => IO.read('not json at all', ''));
});

test('CSV uses ";" and decimal commas with the European number format, and starts with a BOM', async () => {
  const { setFmt } = await import('../../src/core/format.js');
  setFmt({ currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy', cents: true });
  assert.equal(
    IO.csvText([
      ['Rent', '-250.50'],
      ['a;b', '=1+1'],
    ]),
    '﻿Rent;-250,50\n"a;b";\'=1+1',
  );
  setFmt({ currency: 'USD', numFmt: 'us', dateFmt: 'mdy', cents: true });
  assert.equal(IO.csvText([['Rent', '-250.50']]), '﻿Rent,-250.50');
});

test('a backup can carry deleted plans (sync): they are read back', async () => {
  const deletedPlans = { gone0001: { id: 'gone0001', createdAt: 1, updatedAt: 2, deletedAt: 2 } };
  const result = await IO.read(await IO.backup([plan], '', { deletedPlans }), '');
  assert.deepEqual(result.deletedPlans, deletedPlans);
  assert.deepEqual((await IO.read(await IO.backup([plan], ''), '')).deletedPlans, {}, 'none: an empty set');
});

test('a Drive or QR payload is compressed before it is encrypted (envelope v2), and opens as before', async () => {
  const big = normPlan({
    name: 'Big',
    items: Array.from({ length: 400 }, (_, i) => ({ name: 'Groceries ' + i, amount: 12.5, month: '2027-01' })),
  });
  const text = await IO.backup([big], PASSWORD, {}, { zip: true });
  const envelope = JSON.parse(text);
  assert.equal(envelope.kind, 'encrypted');
  assert.equal(envelope.zip, 'gzip');
  assert.equal(envelope.v, 2, 'told apart from the format older versions read');
  const plain = await IO.backup([big], '');
  assert.ok(text.length < plain.length / 3, `much smaller: ${text.length} vs ${plain.length}`);
  assert.equal((await IO.read(text, PASSWORD)).plans[0].items.length, 400);
});

test('an exported backup is not compressed (v1): an older version reads it and says it is from a newer version', async () => {
  const envelope = JSON.parse(await IO.backup([plan], PASSWORD));
  assert.equal(envelope.v, 1);
  assert.equal(envelope.zip, undefined);
});

test('an encrypted backup made before compression still opens', async () => {
  const old = await IO.encrypt(JSON.stringify({ app: 'runway', kind: 'backup', v: 6, plans: [plan] }), PASSWORD, {
    zip: false,
  });
  assert.equal(old.zip, undefined);
  assert.equal((await IO.read(JSON.stringify(old), PASSWORD)).plans[0].name, 'Round trip');
});

test('encrypting again with the same passphrase reuses its key, with a new IV each time', async () => {
  const a = await IO.encrypt('same text', PASSWORD);
  const b = await IO.encrypt('same text', PASSWORD);
  assert.equal(a.salt, b.salt, 'one key per passphrase in this visit');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  assert.equal(await IO.decrypt(b, PASSWORD), 'same text');
});

test('backupText joins plan texts already made into the same backup', async () => {
  const deletedPlans = { gone0001: { id: 'gone0001', createdAt: 1, updatedAt: 2, deletedAt: 2 } };
  const text = IO.backupText([JSON.stringify(plan), JSON.stringify({ ...plan, id: 'second01' })], {
    by: 'dev1',
    deletedPlans,
  });
  const parsed = JSON.parse(text);
  assert.equal(parsed.kind, 'backup');
  assert.equal(parsed.by, 'dev1');
  assert.deepEqual(
    parsed.plans.map(p => p.id),
    [plan.id, 'second01'],
  );
  const result = await IO.read(text, '');
  assert.deepEqual(result.plans[0], JSON.parse(JSON.stringify(plan)));
  assert.deepEqual(result.deletedPlans, deletedPlans);
});
