/**
 * @file Where Design mode is offered: every page whose cards can be arranged declares itself here when its module
 * loads, so the app knows the full list before any page is drawn (Settings, tests, and designGrid's check use it).
 *
 * To offer Design mode on a page, declare it next to the page's code and use the key it returns:
 *   const DESIGN = designable('accounts', $t('Accounts'));
 *   V.accounts = () => designPage(DESIGN, ...);
 */

/** The pages that offer Design mode, in the order they were declared: key → name shown to people. */
const pages = new Map();

/**
 * Declares that page `key` offers Design mode. Declaring it again only updates its name.
 * @param {string} key the page's Design mode key (also the name of its saved layout)
 * @param {string} name the page's name, for people
 * @returns {string} the key, to pass on to designPage or designGrid
 */
export function designable(key, name) {
  pages.set(key, name);
  return key;
}

/** The name of page `key` for people (the activity log says which page's layout changed). */
export const pageName = key => pages.get(key) || key;

/** True when page `key` has declared that it offers Design mode. */
export const isDesignable = key => pages.has(key);

/** Every page that offers Design mode: [{ key, name }], in the order they were declared. */
export const designPages = () => [...pages].map(([key, name]) => ({ key, name }));
