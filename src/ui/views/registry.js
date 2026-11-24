/**
 * @file The view registry. Each view module adds its render function here.
 */
/* --- 6.9 views --- */
export const V = {};
/**
 * Views that want a word before the page is left, by view name: fn(proceed) returns true when it takes over (it asks
 * something, then calls proceed() to go on, or not), false to let the page change at once. App.go asks it.
 */
export const LEAVE = {};
