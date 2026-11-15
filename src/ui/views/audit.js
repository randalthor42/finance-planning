/**
 * @file Audit page: proof that the numbers add up. Consistency checks, then every line of the plan with the balance
 * after it, sortable and downloadable. Read-only: nothing here changes the plan.
 */
import { D, M } from '../../core/dates.js';
import { money, signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { auditChecks, duplicateLines, ledgerRows } from '../../logic/audit.js';
import { IO } from '../../services/backup.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { dataTable } from '../components/dataTable.js';
import { card, page, segc } from '../components/layout.js';
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { UI, curK } from '../state.js';
import { V } from './registry.js';

/** What each rule means, in words. */
const ruleText = id =>
  ({
    carryOver: $t('Every month starts exactly where the month before ended.'),
    linesAddUp: $t('Every month ends at its start plus the sum of its lines.'),
    nowPlusToCome: $t('“You have now” plus “still to come” is the end of the month.'),
    inAndOut: $t('Money in and money out are the sums of the lines.'),
    netWorth: $t('Net worth is cash plus savings minus debt.'),
    cards: $t('No credit card balance, charge or payment is negative.'),
    paidLines: $t('A paid line has nothing still to come; an unpaid line has all of it.'),
  })[id] || id;

const groupName = group =>
  ({
    inc: $t('Income'),
    bill: $t('Bills'),
    item: $t('Purchases'),
    trip: $t('Trips'),
    loan: $t('Loans'),
    wish: $t('Wishlist'),
    goal: $t('Savings'),
    transfer: $t('Borrowed or from savings'),
    adjust: $t('Balance correction'),
  })[group] || group;

/** One line per rule; when they all pass they sit folded under a single "All checks pass" line. */
function checksList(checks, failed) {
  const notes = h(
    'div',
    { class: 'notes' },
    checks.map(check =>
      h(
        'div',
        { class: 'note ' + (check.ok ? 'good' : 'bad') },
        icon(check.ok ? 'check' : 'alert'),
        h('div', {
          class: 'grow',
          text: check.ok
            ? ruleText(check.id)
            : $t('{0} Fails in: {1}', ruleText(check.id), check.failures.slice(0, 6).join(', ')),
        }),
      ),
    ),
  );
  if (failed.length) {
    return notes;
  }
  return h('details', { class: 'more' }, h('summary', { text: $t('✓ All {0} checks pass', checks.length) }), notes);
}
/** "Bills that look entered twice": same name, amount, day and account (often a row copied by accident). */
function duplicatesNote(plan) {
  const duplicates = duplicateLines(plan);
  if (!duplicates.length) {
    return null;
  }
  return h(
    'div',
    { class: 'notes', style: 'margin-top:10px' },
    duplicates.map(duplicate =>
      h(
        'div',
        { class: 'note warn' },
        icon('alert'),
        h('div', {
          class: 'grow',
          text: $t(
            'Possibly entered twice: {0} ({1} each). Both are counted.',
            duplicate.names.join(' · '),
            money(duplicate.amount),
          ),
        }),
        btn($t('Open income and bills'), () => App.go('recurring'), 'sm'),
      ),
    ),
  );
}
V.audit = () => {
  const plan = Store.plan;
  const projection = Store.proj;
  const checks = auditChecks(plan, projection);
  const failed = checks.filter(check => !check.ok);
  const allRows = ledgerRows(projection);
  const currentMonth = curK();
  // one month is readable on screen; the download always has the whole plan
  const scope = UI.auditScope;
  const rows = scope === 'all' ? allRows : allRows.filter(row => row.monthIndex === currentMonth);

  const download = () => {
    const header = [
      $t('Month'),
      $t('Date'),
      $t('Type'),
      $t('Name'),
      $t('Detail'),
      $t('Amount'),
      $t('Paid'),
      $t('On a card'),
      $t('Balance after'),
    ];
    const lines = allRows.map(row => [
      row.monthKey,
      row.date === null ? '' : D.key(row.date),
      groupName(row.group),
      row.label,
      row.detail,
      row.amount.toFixed(2),
      row.paid ? $t('yes') : $t('no'),
      row.onCard ? row.onCard.toFixed(2) : '',
      row.balance.toFixed(2),
    ]);
    IO.download(`runway-audit-${M.key(currentMonth)}.csv`, IO.csvText([header, ...lines]), 'text/csv');
  };

  return page(
    $t('Audit'),
    $t('Proof that the numbers add up: the rules the planner checks, and every line with the balance after it.'),
    [btn($t('Download the full ledger (CSV)'), download, '', 'download')],
    card(
      failed.length ? $t('{0} of {1} checks failed', failed.length, checks.length) : $t('Checks'),
      failed.length
        ? $t('A failed check means a number somewhere is wrong. Please export a backup and report it.')
        : null,
      null,
      checksList(checks, failed),
      duplicatesNote(plan),
    ),
    card(
      $t('Ledger'),
      $t('Every line in order, with the balance after it. Click a column to sort.'),
      segc(
        [
          ['month', M.label(currentMonth)],
          ['all', $t('Whole plan')],
        ],
        scope,
        value => {
          UI.auditScope = value;
          App.render();
        },
      ),
      dataTable({
        id: 'audit-' + scope,
        rows,
        maxHeight: '70vh',
        pageSize: 200,
        rowProps: row => ({ class: row.paid ? '' : 'dim' }),
        columns: [
          // one month needs no Month column
          scope === 'all'
            ? { label: $t('Month'), value: row => row.monthIndex, cell: row => M.label(row.monthIndex) }
            : null,
          {
            label: $t('Date'),
            value: row => row.date,
            cell: row => (row.date === null ? $t('No fixed day') : D.label(row.date)),
          },
          { label: $t('Type'), align: 'left', value: row => groupName(row.group), cell: row => groupName(row.group) },
          {
            label: $t('Name'),
            align: 'left',
            value: row => row.label,
            cell: row => row.label + (row.detail ? ' · ' + row.detail : ''),
          },
          {
            label: $t('Amount'),
            value: row => row.amount,
            cell: row => (row.onCard ? $t('{0} on a card', money(row.onCard)) : signed(row.amount)),
            cellProps: row => ({ class: row.amount < 0 ? '' : row.amount > 0 ? 'good' : 'muted' }),
          },
          { label: $t('Paid'), value: row => Number(row.paid), cell: row => (row.paid ? $t('yes') : $t('not yet')) },
          {
            label: $t('Balance after'),
            value: row => row.balance,
            cell: row => h('b', { class: row.balance < 0 ? 'bad' : '', text: money(row.balance) }),
          },
        ].filter(Boolean),
      }),
    ),
  );
};
