/**
 * @file App-wide constants.
 */
export const APP = {
  name: 'Runway',
  key: 'runway.db.v1',
  /** The schema of stored data (db.schemaVersion, and `v` in files): models/migrations.js brings older data to it. */
  schema: 8,
  maxPlans: 20,
  maxList: 500,
  maxLog: 300,
  /**
   * Colours of the installed app (build/pwa.js, ui/pwa.js): the bar above the app (status bar, title bar) in the
   * light and dark themes, and the splash screen while it opens. light is --accent and dark is --surface of the dark
   * theme (styles/tokens.css): on iOS the status bar's text is white, so it needs a dark colour behind it.
   */
  colors: { light: '#2457d6', dark: '#161d25', background: '#f5f6f8' },
  /**
   * Google Drive sync (state/driveSync.js, docs/sync.md): the OAuth client ID of the app's Google Cloud project, set
   * when building (VITE_GOOGLE_CLIENT_ID in .env.local). Without one, Settings explains that sync is not set up.
   */
  google: { clientId: (import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID) || '' },
};
/** After how long away the app lock locks, in seconds: immediately, 1, 5, 15 minutes, 1 hour (logic/lock.js). */
export const LOCK_TIMEOUTS = [0, 60, 300, 900, 3600];
/** How many days before a payment a reminder can come (models/db.js normReminders, logic/reminders.js). */
export const REMINDER_DAYS = [0, 1, 2, 3, 7];
/** The plan lists that drafts of My calendar can hold (models/agenda.js, logic/agenda.js). */
export const DRAFT_LISTS = ['items', 'trips'];
