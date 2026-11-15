/**
 * @file Unit tests for backup files: plain and password-encrypted round trips. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IO } from '../../src/services/backup.js';
import { normPlan } from '../../src/models/plan.js';

const plan = normPlan({ name: 'Round trip', incomes: [{ id: 'salary01', name: 'Salary', amount: 1000 }] });

test('a plain backup reads back the same plan', async () => {
  const text = await IO.backup([plan], '');
  const result = await IO.read(text, '');
  assert.equal(result.plans[0].name, 'Round trip');
  assert.equal(result.plans[0].incomes[0].amount, 1000);
});

test('an encrypted backup does not contain the plan in clear text', async () => {
  const text = await IO.backup([plan], 'correct horse');
  assert.ok(!text.includes('Round trip'));
});

test('an encrypted backup opens with the right password and only with it', async () => {
  const text = await IO.backup([plan], 'correct horse');
  const result = await IO.read(text, 'correct horse');
  assert.equal(result.plans[0].name, 'Round trip');
  await assert.rejects(() => IO.read(text, 'wrong password'));
});

test('a file that is not a backup is refused with a readable message', async () => {
  await assert.rejects(
    () => IO.read('{"hello":1}', ''),
    error => typeof error.message === 'string' && error.message.length > 0,
  );
  await assert.rejects(() => IO.read('not json at all', ''));
});
