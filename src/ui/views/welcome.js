/**
 * @file First screen when there is no plan yet.
 */
import { $t } from '../../core/i18n.js';
import { samplePlan } from '../../models/samplePlan.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { btn } from '../components/button.js';
import { h } from '../dom.js';
import { importFlow } from '../modals/backup.js';
import { newPlanModal } from '../modals/settings.js';
import { V } from './registry.js';

V.welcome = () =>
  h(
    'div',
    { class: 'welcome' },
    h('h1', { text: $t('Plan your money, month by month.') }),
    h('p', {
      class: 'muted',
      style: 'margin-bottom:18px',
      text: $t(
        'Bills, budgets, one-offs, trips, loans and savings in one plan, so you can see what every decision does to your cash in the months ahead. Everything is stored in this browser only. Nothing is sent anywhere.',
      ),
    }),
    h(
      'div',
      { class: 'card' },
      h('h2', { text: $t('Start your own plan') }),
      h('p', {
        class: 'muted',
        style: 'margin:6px 0 12px',
        text: $t(
          'Name it, choose the first month and how many months to plan, say how much money you start with, and set your payday, currency and formats. You can add your income and bills right away, or later.',
        ),
      }),
      btn($t('Create my plan'), newPlanModal, 'primary', 'plus'),
    ),
    h(
      'div',
      { class: 'acts', style: 'margin-top:14px' },
      btn(
        $t('Look around with a sample plan'),
        () => {
          Store.addPlan(samplePlan());
          App.go('overview');
        },
        'ghost',
      ),
      btn($t('Import a backup'), importFlow, 'ghost', 'upload'),
    ),
  );
