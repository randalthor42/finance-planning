/**
 * @file Plan formats from the browser's language: the currency, number format and date format a new plan starts
 * with, so a first plan in Spain shows "1.234,56 €" and a first plan in the US "$1,234.56". Pure.
 */

/** Currencies by country (region of the language tag). Countries using the euro are in EURO_REGIONS. */
const REGION_CURRENCY = {
  US: 'USD',
  GB: 'GBP',
  CH: 'CHF',
  RO: 'RON',
  RS: 'RSD',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  BG: 'BGN',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  TR: 'TRY',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  JP: 'JPY',
  IN: 'INR',
  BR: 'BRL',
  MX: 'MXN',
  ZA: 'ZAR',
};
const EURO_REGIONS = new Set([
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
]);
/** Languages that write 1,234.56 (the others write 1.234,56). */
const POINT_DECIMAL = new Set(['en', 'ja', 'zh', 'ko', 'he', 'th', 'hi']);

/**
 * The formats a new plan should start with for a browser language such as "es-ES" or "en-US".
 * Unknown or missing parts fall back to euros, 1.234,56 and day-month-year.
 * @param {string} [languageTag] e.g. navigator.language
 * @returns {{currency: string, numFmt: 'eu'|'us', dateFmt: 'dmy'|'mdy'}}
 */
export function formatsForLanguage(languageTag) {
  const [language = '', region = ''] = String(languageTag || '').split(/[-_]/);
  const lang = language.toLowerCase();
  const country = region.toUpperCase();
  let currency = 'EUR';
  if (REGION_CURRENCY[country]) {
    currency = REGION_CURRENCY[country];
  } else if (!EURO_REGIONS.has(country) && lang === 'en' && !country) {
    currency = 'USD';
  }
  return {
    currency,
    numFmt: POINT_DECIMAL.has(lang) ? 'us' : 'eu',
    dateFmt: country === 'US' ? 'mdy' : 'dmy',
  };
}
