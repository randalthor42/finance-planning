/**
 * @file Test builds only (vite build --mode test): puts the public API of every module on window so browser tests can call it. The normal build drops this file.
 */
import * as m0 from './config.js';
import * as m1 from './core/dates.js';
import * as m2 from './core/format.js';
import * as m3 from './core/i18n.js';
import * as m4 from './core/util.js';
import * as m5 from './logic/advice.js';
import * as m6 from './logic/loans.js';
import * as m7 from './logic/projection.js';
import * as m8 from './logic/trips.js';
import * as m9 from './logic/wishes.js';
import * as m10 from './models/categories.js';
import * as m11 from './models/db.js';
import * as m12 from './models/plan.js';
import * as m13 from './models/samplePlan.js';
import * as m14 from './services/backup.js';
import * as m15 from './services/storage.js';
import * as m16 from './state/actions.js';
import * as m17 from './state/store.js';
import * as m18 from './ui/app.js';
import * as m19 from './ui/components/button.js';
import * as m20 from './ui/components/charts.js';
import * as m21 from './ui/components/form.js';
import * as m22 from './ui/components/info.js';
import * as m23 from './ui/components/layout.js';
import * as m24 from './ui/components/modal.js';
import * as m25 from './ui/components/moneyInput.js';
import * as m26 from './ui/components/monthNotes.js';
import * as m27 from './ui/components/pickers.js';
import * as m28 from './ui/components/popover.js';
import * as m29 from './ui/components/sortable.js';
import * as m30 from './ui/components/toast.js';
import * as m31 from './ui/dom.js';
import * as m32 from './ui/helpers.js';
import * as m33 from './ui/icons.js';
import * as m34 from './ui/modals/account.js';
import * as m35 from './ui/modals/backup.js';
import * as m36 from './ui/modals/balances.js';
import * as m37 from './ui/modals/change.js';
import * as m38 from './ui/modals/entry.js';
import * as m39 from './ui/modals/goal.js';
import * as m40 from './ui/modals/item.js';
import * as m41 from './ui/modals/loan.js';
import * as m42 from './ui/modals/recurring.js';
import * as m43 from './ui/modals/settings.js';
import * as m44 from './ui/modals/trip.js';
import * as m45 from './ui/modals/wish.js';
import * as m46 from './ui/state.js';
import * as m47 from './ui/views/language.js';
import * as m48 from './ui/views/recurring.js';
import * as m49 from './ui/views/registry.js';
import * as m50 from './ui/views/settings.js';
import * as m51 from './ui/views/tools.js';
import * as m52 from './ui/views/trips.js';
import * as m53 from './ui/components/designPages.js';
import * as m54 from './logic/calendar.js';
import * as m55 from './ui/components/calendar.js';
import * as m56 from './ui/components/calendarData.js';
import * as m57 from './models/calendarPrefs.js';
import * as m58 from './state/fileSync.js';
import * as m59 from './services/fileAccess.js';
import * as m60 from './services/handleStore.js';
import * as m61 from './models/dataFile.js';
import * as m62 from './ui/views/storageSettings.js';
import * as m63 from './core/pwa.js';
import * as m64 from './ui/pwa.js';
import * as m65 from './models/records.js';
import * as m66 from './models/migrations.js';
import * as m67 from './services/storage.js';
import * as m68 from './models/recordMerge.js';
import * as m69 from './logic/qrChunks.js';
import * as m70 from './services/drive.js';
import * as m71 from './services/googleAuth.js';
import * as m72 from './state/driveSync.js';
import * as m73 from './ui/modals/importPreview.js';
import * as m74 from './ui/modals/qrTransfer.js';
import * as m75 from './ui/views/syncSettings.js';
import * as m76 from './ui/qrLoader.js';

export const expose = () =>
  Object.assign(
    window,
    m0,
    m1,
    m2,
    m3,
    m4,
    m5,
    m6,
    m7,
    m8,
    m9,
    m10,
    m11,
    m12,
    m13,
    m14,
    m15,
    m16,
    m17,
    m18,
    m19,
    m20,
    m21,
    m22,
    m23,
    m24,
    m25,
    m26,
    m27,
    m28,
    m29,
    m30,
    m31,
    m32,
    m33,
    m34,
    m35,
    m36,
    m37,
    m38,
    m39,
    m40,
    m41,
    m42,
    m43,
    m44,
    m45,
    m46,
    m47,
    m48,
    m49,
    m50,
    m51,
    m52,
    m53,
    m54,
    m55,
    m56,
    m57,
    m58,
    m59,
    m60,
    m61,
    m62,
    m63,
    m64,
    m65,
    m66,
    m67,
    m68,
    m69,
    m70,
    m71,
    m72,
    m73,
    m74,
    m75,
    m76,
  );
