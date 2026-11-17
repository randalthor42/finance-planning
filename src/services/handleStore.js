/**
 * @file Where the data file's handle is kept between visits: IndexedDB (localStorage holds text only), through the
 * data access module (services/storage.js). The handle gives access to that one file, and only after the browser's
 * permission.
 */
import { kv } from './storage.js';

export const HandleStore = kv;
