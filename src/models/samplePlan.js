/**
 * @file The demo plan shown by "Look around with a sample plan".
 */
import { D, M } from '../core/dates.js';
import { $t } from '../core/i18n.js';

export function samplePlan() {
  const n = M.now();
  const k = d => M.key(n + d);
  const t = D.today();
  const day = d => D.key(Math.max(D.of(Math.floor(n / 12), n % 12, 1), t - d));
  return {
    name: $t('Sample plan'),
    settings: { currency: 'EUR', startMonth: k(0), horizon: 24, opening: 1450, cushion: 500 },
    accounts: [
      { name: $t('Main account'), type: 'debit', balance: 1450 },
      { name: $t('Wallet'), type: 'cash', balance: 40 },
      { name: $t('Credit card'), type: 'credit', balance: 800, owed: 0 },
    ],
    incomes: [
      { name: $t('Salary'), amount: 2400, cat: 'salary', day: 1 },
      { name: $t('Freelance work'), amount: 350, cat: 'side', every: 3, from: k(1), day: 15 },
    ],
    bills: [
      [$t('Rent'), 820, 'housing', 2],
      [$t('Electricity and gas'), 85, 'utilities', 10],
      [$t('Internet'), 35, 'utilities', 12],
      [$t('Phone'), 18, 'utilities', 12],
      [$t('Groceries'), 360, 'food', 0, 'groc'],
      [$t('Going out'), 120, 'fun', 0, 'gout'],
      [$t('Transport pass'), 45, 'transport', 1],
      [$t('Streaming'), 17, 'subs', 20],
      [$t('Gym'), 32, 'health', 5],
    ]
      .map(b => ({
        name: b[0],
        amount: b[1],
        cat: b[2],
        day: b[3],
        budget: !!b[4],
        id: b[4] ? b[4] + '01' : undefined,
      }))
      .concat([
        { name: $t('Home insurance'), amount: 190, cat: 'insurance', every: 12, from: k(4), day: 15 },
        { name: $t('Sofa financing'), amount: 60, cat: 'debt', to: k(7), day: 5 },
      ]),
    items: [
      { name: $t('Supermarket'), amount: 64, budget: 'groc01', date: day(6) },
      { name: $t('Market'), amount: 23, budget: 'groc01', date: day(2) },
      { name: $t('Dinner with friends'), amount: 38, budget: 'gout01', date: day(3) },
      { name: $t('Birthday gift'), amount: 60, cat: 'gifts', month: k(1) },
      { name: $t('Concert tickets'), amount: 95, cat: 'fun', month: k(2) },
      { name: $t('Tax refund'), amount: 280, kind: 'in', cat: 'refund', month: k(3) },
      { name: $t('New laptop'), amount: 900, cat: 'shopping', month: k(5) },
    ],
    trips: [
      {
        name: $t('Lisbon long weekend'),
        month: k(4),
        budget: 850,
        items: [
          { name: $t('Flights'), amount: 190, pay: k(1) },
          { name: $t('Hotel, 3 nights'), amount: 330, pay: k(3) },
          { name: $t('Food and drinks'), amount: 180 },
          { name: $t('Getting around'), amount: 40 },
          { name: $t('Gifts'), amount: 40 },
        ],
      },
      {
        name: $t('Iceland'),
        kind: 'idea',
        items: [
          { name: $t('Flights'), amount: 380 },
          { name: $t('Car and places to stay'), amount: 900 },
        ],
      },
    ],
    loans: [
      {
        name: $t('Car loan'),
        amount: 9000,
        rate: 6.5,
        term: 48,
        first: k(-10),
        payout: 'direct',
        early1: 1,
        early2: 0.5,
        day: 3,
      },
    ],
    wishes: [
      { name: $t('Camera'), price: 800, how: 'save', month: k(8), months: 6, on: false },
      { name: $t('Watch'), price: 300, flex: true, months: 6, note: $t('Not sure which model yet.') },
    ],
    goals: [
      { name: $t('Emergency fund'), target: 6000, saved: 1200, monthly: 150, rate: 2 },
      { name: $t('Laptop fund'), target: 900, saved: 300, monthly: 120, release: k(5) },
    ],
  };
}
