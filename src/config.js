/**
 * @file App-wide constants.
 */
export const APP = { name: 'Runway', key: 'runway.db.v1', schema: 6, maxPlans: 20, maxList: 500, maxLog: 300 };
/** After how long away the app lock locks, in seconds: immediately, 1, 5, 15 minutes, 1 hour (logic/lock.js). */
export const LOCK_TIMEOUTS = [0, 60, 300, 900, 3600];
/** The plan lists that drafts of My calendar can hold (models/agenda.js, logic/agenda.js). */
export const DRAFT_LISTS = ['items', 'trips'];
