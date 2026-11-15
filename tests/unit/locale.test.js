/**
 * @file Unit tests for the formats a new plan starts with. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatsForLanguage } from '../../src/core/locale.js';

test('formats follow the browser language and country', () => {
  assert.deepEqual(formatsForLanguage('es-ES'), { currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy' });
  assert.deepEqual(formatsForLanguage('en-US'), { currency: 'USD', numFmt: 'us', dateFmt: 'mdy' });
  assert.deepEqual(formatsForLanguage('en-GB'), { currency: 'GBP', numFmt: 'us', dateFmt: 'dmy' });
  assert.deepEqual(formatsForLanguage('ro-RO'), { currency: 'RON', numFmt: 'eu', dateFmt: 'dmy' });
});

test('unknown or missing languages fall back to euros and 1.234,56', () => {
  assert.deepEqual(formatsForLanguage(''), { currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy' });
  assert.deepEqual(formatsForLanguage('xx'), { currency: 'EUR', numFmt: 'eu', dateFmt: 'dmy' });
});
