/**
 * @file Category lists and the labels shared by forms and views.
 */
import { $t } from '../core/i18n.js';

export const CATS = [
  ['housing', $t('Housing')],
  ['utilities', $t('Utilities')],
  ['food', $t('Food & groceries')],
  ['transport', $t('Transport')],
  ['health', $t('Health')],
  ['insurance', $t('Insurance')],
  ['subs', $t('Subscriptions')],
  ['debt', $t('Debt')],
  ['shopping', $t('Shopping')],
  ['fun', $t('Fun & going out')],
  ['travel', $t('Travel')],
  ['gifts', $t('Gifts')],
  ['family', $t('Family')],
  ['education', $t('Education')],
  ['pets', $t('Pets')],
  ['taxes', $t('Taxes & fees')],
  ['other', $t('Other')],
];
export const INCATS = [
  ['salary', $t('Salary')],
  ['side', $t('Side income')],
  ['benefits', $t('Benefits')],
  ['refund', $t('Refunds & sales')],
  ['other', $t('Other')],
];
export const CAT_NAME = Object.fromEntries([...CATS, ...INCATS, ['savings', $t('Savings')]]);
export const EVERY = [
  [1, $t('Every month')],
  [2, $t('Every 2 months')],
  [3, $t('Every 3 months')],
  [6, $t('Every 6 months')],
  [12, $t('Once a year')],
];
export const SHIFTS = [
  ['none', $t('On that day, even on a weekend')],
  ['next', $t('Next working day')],
  ['prev', $t('Working day before')],
];
/** Keys of ledger lines that can be ticked or changed for one month ("appt:<id>:<day>": a counted appointment). */
export const KEY_RE = /^(inc|bill|item|trip|loan|goal|wish|appt)(:[a-z0-9]{1,16}){1,2}$/;
