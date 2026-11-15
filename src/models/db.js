/**
 * @file The stored database: all plans plus the browser preferences.
 */
import { APP } from '../config.js';
import { isObj, uid } from '../core/util.js';
import { normPlan } from './plan.js';

export function normDB(raw) {
  raw = isObj(raw) ? raw : {};
  const plans = {};
  if (isObj(raw.plans)) {
    for (const p of Object.values(raw.plans).slice(0, APP.maxPlans)) {
      const c = normPlan(p);
      while (plans[c.id]) {
        c.id = uid();
      }
      plans[c.id] = c;
    }
  }
  const idsL = Object.keys(plans);
  const txt = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n) : '');
  return {
    v: APP.schema,
    active: plans[raw.active] ? raw.active : idsL[0] || null,
    plans,
    theme: ['auto', 'light', 'dark'].includes(raw.theme) ? raw.theme : 'auto',
    autosave: !!raw.autosave,
    toastPos: ['tr', 'br', 'tl', 'bl'].includes(raw.toastPos) ? raw.toastPos : 'tr',
    tripView: raw.tripView === 'list' ? 'list' : 'grid',
    log: Array.isArray(raw.log)
      ? raw.log
          .filter(isObj)
          .slice(-APP.maxLog)
          .map(e => ({ t: txt(e.t, 30), text: txt(e.text, 200) }))
          .filter(e => e.text)
      : [],
  };
}
