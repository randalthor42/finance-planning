/**
 * @file SVG charts: cash and debt over time, net bars, sparkline. No chart library.
 */
import { M } from '../../core/dates.js';
import { compact, money, signed } from '../../core/format.js';
import { $t } from '../../core/i18n.js';
import { clamp } from '../../core/util.js';
import { Store } from '../../state/store.js';
import { App } from '../app.js';
import { h, sv } from '../dom.js';
import { UI, curK } from '../state.js';

/**
 * Axis range and ticks. The range is at least `minRange` wide and steps are whole amounts, so an empty plan
 * reads "0 · 25 · 50 · 75 · 100" instead of "1 1 1 0 0".
 */
function niceScale(lo, hi, minRange = 100) {
  if (hi - lo < minRange) {
    hi = lo + minRange;
  }
  const raw = (hi - lo) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nrm = raw / mag;
  const step = Math.max(1, (nrm <= 1 ? 1 : nrm <= 2 ? 2 : nrm <= 2.5 ? 2.5 : nrm <= 5 ? 5 : 10) * mag);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const t = [];
  for (let v = a; v <= b + step / 2; v += step) {
    t.push(v);
  }
  return [a, b, t];
}
/** Cash, savings and debt over the plan. One axis (all three are money), crosshair tooltip, click to open a month. */
export function cashChart() {
  const projection = Store.proj;
  const months = projection.months;
  const n = months.length;
  const settings = Store.plan.settings;
  const W = 760;
  const H = 250;
  const pl = 56;
  const pr = 14;
  const pt = 12;
  const pb = 26;
  const has2 = { save: months.some(m => m.savings > 0), debt: months.some(m => m.debt > 0) };
  const show = { save: has2.save && UI.series.save, debt: has2.debt && UI.series.debt };
  const vals = [0];
  months.forEach(m => {
    vals.push(m.close);
    if (show.save) {
      vals.push(m.savings);
    }
    if (show.debt) {
      vals.push(m.debt);
    }
  });
  const [lo, hi, ticks] = niceScale(Math.min(...vals), Math.max(...vals, 1), Math.max(100, settings.cushion));
  const x = i => pl + (W - pl - pr) * (n > 1 ? i / (n - 1) : 0.5);
  const y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const pts = f => months.map((m, i) => x(i).toFixed(1) + ',' + y(f(m)).toFixed(1)).join(' ');
  const line = (f, c) =>
    sv('polyline', {
      points: pts(f),
      fill: 'none',
      stroke: `var(${c})`,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    });
  const svg = sv('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': $t('Cash, savings and debt by month. The Forecast page has the same numbers as a table.'),
  });
  for (const t of ticks) {
    svg.append(
      sv('line', {
        x1: pl,
        x2: W - pr,
        y1: y(t),
        y2: y(t),
        stroke: t === 0 ? 'var(--line-2)' : 'var(--line)',
        'stroke-width': 1,
      }),
      sv('text', { x: pl - 8, y: y(t) + 4, 'text-anchor': 'end' }, compact(t)),
    );
  }
  if (settings.cushion > 0 && settings.cushion < hi) {
    svg.append(
      sv('line', {
        x1: pl,
        x2: W - pr,
        y1: y(settings.cushion),
        y2: y(settings.cushion),
        stroke: 'var(--warn)',
        'stroke-dasharray': '4 4',
        'stroke-width': 1,
      }),
      sv(
        'text',
        { x: W - pr, y: y(settings.cushion) - 5, 'text-anchor': 'end' },
        $t('Cushion {0}', compact(settings.cushion)),
      ),
    );
  }
  const step = Math.ceil(n / 7);
  months.forEach((m, i) => {
    if ((i % step === 0 && i <= n - 1 - step * 0.8) || i === n - 1) {
      svg.append(
        sv(
          'text',
          { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' },
          M.label(m.k),
        ),
      );
    }
  });
  svg.append(
    sv('polygon', {
      points: `${x(0)},${y(0)} ${pts(m => m.close)} ${x(n - 1)},${y(0)}`,
      fill: 'var(--s-cash)',
      opacity: 0.1,
    }),
  );
  if (show.debt) {
    svg.append(line(m => m.debt, '--s-debt'));
  }
  if (show.save) {
    svg.append(line(m => m.savings, '--s-save'));
  }
  svg.append(line(m => m.close, '--s-cash'));
  const guide = sv('line', { y1: pt, y2: H - pb, stroke: 'var(--faint)', 'stroke-width': 1, visibility: 'hidden' });
  const dot = c =>
    sv('circle', { r: 4.5, fill: `var(${c})`, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' });
  const dots = { cash: dot('--s-cash'), save: dot('--s-save'), debt: dot('--s-debt') };
  svg.append(guide, dots.debt, dots.save, dots.cash);
  const tip = h('div', { class: 'tip', hidden: true });
  const wrap = h('div', { class: 'chart' }, svg, tip);
  const key = (c, l, v) =>
    h(
      'div',
      null,
      h('span', { class: 'key' }, h('i', { style: `background:var(${c})` }), l),
      h('span', { text: money(v) }),
    );
  const at = e => {
    const r = svg.getBoundingClientRect();
    return clamp(Math.round(((((e.clientX - r.left) / r.width) * W - pl) / (W - pl - pr)) * (n - 1)), 0, n - 1);
  };
  svg.addEventListener('pointermove', e => {
    const i = at(e);
    const m = months[i];
    const r = svg.getBoundingClientRect();
    const px = (x(i) / W) * r.width;
    guide.setAttribute('x1', x(i));
    guide.setAttribute('x2', x(i));
    guide.setAttribute('visibility', 'visible');
    const put = (d, v, on) => {
      d.setAttribute('cx', x(i));
      d.setAttribute('cy', y(v));
      d.setAttribute('visibility', on ? 'visible' : 'hidden');
    };
    put(dots.cash, m.close, true);
    put(dots.save, m.savings, show.save);
    put(dots.debt, m.debt, show.debt);
    tip.replaceChildren(
      h('b', { text: M.label(m.k, true) }),
      key('--s-cash', $t('Cash'), m.close),
      show.save ? key('--s-save', $t('Savings'), m.savings) : null,
      show.debt ? key('--s-debt', $t('Debt'), m.debt) : null,
    );
    tip.hidden = false;
    tip.style.left = px > r.width / 2 ? '' : px + 14 + 'px';
    tip.style.right = px > r.width / 2 ? r.width - px + 14 + 'px' : '';
  });
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    guide.setAttribute('visibility', 'hidden');
    Object.values(dots).forEach(d => d.setAttribute('visibility', 'hidden'));
  });
  svg.addEventListener('click', e => App.go('months', { month: months[at(e)].k }));
  svg.style.cursor = 'pointer';
  const lg = (k, c, l) =>
    has2[k] === false
      ? null
      : h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(k === 'cash' || UI.series[k]),
            disabled: k === 'cash',
            style: k === 'cash' ? 'opacity:1;cursor:default' : '',
            onclick: () => {
              UI.series[k] = !UI.series[k];
              App.render();
            },
          },
          h('i', { style: `background:var(${c})` }),
          l,
        );
  return [
    wrap,
    h(
      'div',
      { class: 'legend', style: 'margin-top:8px' },
      lg('cash', '--s-cash', $t('Cash')),
      lg('save', '--s-save', $t('Savings')),
      lg('debt', '--s-debt', $t('Debt')),
    ),
  ];
}
/** What is left over each month (money in minus money out). Bars below zero are months you spend more than comes in. */
export function netBars() {
  const ms = Store.proj.months.filter(m => m.k >= curK()).slice(0, 12);
  const n = ms.length;
  const W = 470;
  const H = 220;
  const pl = 56;
  const pr = 8;
  const pt = 10;
  const pb = 24;
  const [lo, hi, ticks] = niceScale(Math.min(0, ...ms.map(m => m.net)), Math.max(1, ...ms.map(m => m.net)));
  const y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  const slot = (W - pl - pr) / n;
  const bw = Math.min(28, slot - 4);
  const svg = sv('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'bars',
    role: 'img',
    'aria-label': $t('Money left over each month'),
  });
  const tip = h('div', { class: 'tip', hidden: true });
  for (const t of ticks) {
    svg.append(
      sv('line', { x1: pl, x2: W - pr, y1: y(t), y2: y(t), stroke: t === 0 ? 'var(--line-2)' : 'var(--line)' }),
      sv('text', { x: pl - 8, y: y(t) + 4, 'text-anchor': 'end' }, compact(t)),
    );
  }
  const step = Math.ceil(n / 5);
  ms.forEach((m, i) => {
    const cx = pl + slot * (i + 0.5);
    const top = Math.min(y(m.net), y(0));
    const ht = Math.max(2, Math.abs(y(m.net) - y(0)));
    const r = sv('rect', {
      x: cx - bw / 2,
      y: top,
      width: bw,
      height: ht,
      rx: 3,
      fill: m.net < 0 ? 'var(--bad)' : 'var(--s-cash)',
    });
    r.addEventListener('pointerenter', () => {
      const b = svg.getBoundingClientRect();
      const px = (cx / W) * b.width;
      tip.replaceChildren(
        h('b', { text: M.label(m.k, true) }),
        h('div', null, h('span', { text: $t('In') }), h('span', { text: money(m.inc) })),
        h('div', null, h('span', { text: $t('Out') }), h('span', { text: money(m.out) })),
        h('div', null, h('span', { text: $t('Left over') }), h('span', { text: signed(m.net) })),
      );
      tip.hidden = false;
      tip.style.left = px > b.width / 2 ? '' : px + 16 + 'px';
      tip.style.right = px > b.width / 2 ? b.width - px + 16 + 'px' : '';
    });
    r.addEventListener('pointerleave', () => {
      tip.hidden = true;
    });
    r.addEventListener('click', () => App.go('months', { month: m.k }));
    svg.append(r);
    if (i % step === 0) {
      svg.append(sv('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }, M.label(m.k)));
    }
  });
  return h('div', { class: 'chart' }, svg, tip);
}
export function sparkline(series, target) {
  const n = series.length;
  const hi = Math.max(target || 0, ...series, 1);
  const W = 300;
  const H = 46;
  const x = i => 2 + (W - 4) * (n > 1 ? i / (n - 1) : 0);
  const y = v => H - 3 - ((H - 8) * v) / hi;
  return sv(
    'svg',
    {
      class: 'spark',
      viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'none',
      role: 'img',
      'aria-label': $t('Savings over the plan'),
    },
    target
      ? sv('line', {
          x1: 0,
          x2: W,
          y1: y(target),
          y2: y(target),
          stroke: 'var(--line-2)',
          'stroke-dasharray': '3 3',
          'vector-effect': 'non-scaling-stroke',
        })
      : null,
    sv('polygon', {
      points: `${x(0)},${H} ` + series.map((v, i) => x(i) + ',' + y(v)).join(' ') + ` ${x(n - 1)},${H}`,
      fill: 'var(--s-save)',
      opacity: 0.14,
    }),
    sv('polyline', {
      points: series.map((v, i) => x(i) + ',' + y(v)).join(' '),
      fill: 'none',
      stroke: 'var(--s-save)',
      'stroke-width': 2,
      'vector-effect': 'non-scaling-stroke',
    }),
  );
}
