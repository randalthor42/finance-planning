/**
 * @file Unit tests for screening a cost against the plan without projecting it again. Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normPlan } from '../../src/models/plan.js';
import { project } from '../../src/logic/projection.js';
import { screenExtraCost } from '../../src/logic/advice.js';
import { wishCalc } from '../../src/logic/wishes.js';
import { D, M } from '../../src/core/dates.js';

const TODAY = D.parse('2026-11-14');

/** The verdict the Wishlist gets by projecting the plan with the wish: what screenExtraCost must agree with. */
function fullVerdict(plan, wish, base) {
  const withWish = project({ ...plan, wishes: [{ ...wish, flex: false, on: true }] }, { today: TODAY });
  const neg = withWish.months.some((m, i) => m.status === 'neg' && base.months[i].status !== 'neg');
  if (neg) {
    return 'bad';
  }
  const tight = withWish.months.some((m, i) => m.status === 'tight' && base.months[i].status === 'ok');
  return tight ? 'warn' : 'good';
}

test('screening a wish gives the same verdict as projecting it, for every month and way of paying', () => {
  const plan = normPlan({
    settings: { startMonth: '2026-11', opening: 300, horizon: 14, cushion: 200 },
    incomes: [{ id: 'salary01', name: 'Salary', amount: 1500 }],
    bills: [
      { id: 'rent0001', name: 'Rent', amount: 900 },
      { id: 'food0001', name: 'Food', amount: 450, budget: true },
    ],
    items: [{ id: 'trip0001', name: 'Trip', amount: 700, month: '2027-02' }],
  });
  const base = project(plan, { today: TODAY });
  const s0 = base.summary.s0;
  let compared = 0;
  for (const how of ['cash', 'save', 'finance']) {
    for (let k = s0; k < s0 + 14; k++) {
      const wish = { id: 'wish0001', name: 'Camera', price: 950, how, month: M.key(k), months: 4, apr: 12 };
      const normalised = normPlan({ ...plan, wishes: [wish] }).wishes[0];
      const rows = wishCalc(normalised, s0, how).rows;
      assert.equal(
        screenExtraCost(base, rows, plan.settings.cushion),
        fullVerdict(plan, normalised, base),
        `${how} ${M.key(k)}`,
      );
      compared++;
    }
  }
  assert.equal(compared, 42);
});
