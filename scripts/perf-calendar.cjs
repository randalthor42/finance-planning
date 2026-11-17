/**
 * @file Calendar performance probe. Runs on a test build (it exposes the modules on window) with the sample plan, or a
 * heavy one built from it, so it needs no private fixtures.
 *   vite build --mode test --outDir dist-test && node scripts/perf-calendar.cjs [sample|heavy] [cpu slowdown] [page] [--profile]
 *   node scripts/perf-calendar.cjs heavy 4                  a power user's plan on a mid-range phone
 * Prints the measurements as JSON (medians, in ms). With a page without the calendar (an older build), the calendar
 * rows are left out, so the same command compares before and after. --profile (or --profile=mobile, =tablet…) adds
 * where the time goes in a calendar build (self time by function; use an unminified build to read the names). Exit code 1 when an audit budget (50 ms per page render at 4x) is exceeded.
 * CHROMIUM=/path/to/chrome uses another browser than Playwright's own.
 */
const path = require('path');
const { chromium } = require('playwright');

const kind = process.argv[2] || 'sample';
const throttle = +(process.argv[3] || 4);
const pageFile = path.resolve(process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : 'dist-test/index.html');
// --profile or --profile=mobile: where the time goes when building a calendar in that layout (default full)
const profileArg = process.argv.find(a => a.startsWith('--profile'));
const profile = !!profileArg;
const profileMode = (profileArg && profileArg.split('=')[1]) || 'full';

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + pageFile);
  await page.getByText('Look around with a sample plan').click();
  // a power user: 10-year plan, 2 years of daily spending (about 500 lines in a month), 40 bills, trips with dates
  if (kind === 'heavy') {
    await page.evaluate(() => {
      const s = Store.plan.settings.startMonth;
      const k0 = M.parse(s);
      const budgets = Store.plan.bills.filter(b => b.budget).map(b => b.id);
      const p = JSON.parse(JSON.stringify(Store.plan));
      p.id = null;
      p.name = 'Heavy';
      p.settings.horizon = 120;
      for (let i = 0; i < 30; i++) {
        p.bills.push({ name: 'Bill ' + i, amount: 10 + i, cat: 'utilities', day: 1 + (i % 28) });
      }
      for (let i = 0; i < 6; i++) {
        p.bills.push({ name: 'Budget ' + i, amount: 200, cat: 'food', budget: true, id: 'hbud' + i });
      }
      const items = [];
      for (let m = 0; m < 24; m++) {
        for (let d = 0; d < 28; d++) {
          for (let j = 0; j < 18; j++) {
            const date = D.key(D.inMonth(k0 + m, d + 1));
            items.push({ name: 'Spend ' + j, amount: 3 + j, date, budget: j % 3 ? budgets[j % budgets.length] || null : 'hbud' + (j % 6) });
          }
        }
      }
      p.items = p.items.concat(items);
      for (let i = 0; i < 40; i++) {
        const from = D.inMonth(k0 + Math.floor(i / 3), 1 + ((i * 7) % 25));
        p.trips.push({ name: 'Trip ' + i, month: M.key(k0 + Math.floor(i / 3)), from: D.key(from), to: D.key(from + 3 + (i % 6)), items: [{ name: 'Hotel', amount: 300 }] });
      }
      for (let i = 0; i < 8; i++) {
        p.loans.push({ ...p.loans[0], id: null, name: 'Loan ' + i, day: 1 + i * 3 });
      }
      // My calendar: 300 appointments (a tenth repeat daily or weekly), 30 drafts
      const repeats = ['none', 'none', 'none', 'none', 'none', 'none', 'none', 'none', 'week', 'day'];
      p.agenda = {
        entries: Array.from({ length: 300 }, (_, i) => ({
          title: 'Appointment ' + i,
          date: D.key(D.inMonth(k0 + Math.floor(i / 25), 1 + (i % 28))),
          time: i % 2 ? String(8 + (i % 10)).padStart(2, '0') + ':30' : '',
          repeat: repeats[i % 10],
        })),
        drafts: {
          items: Array.from({ length: 25 }, (_, i) => ({ name: 'Draft ' + i, amount: 20 + i, date: D.key(D.inMonth(k0 + (i % 6), 3 + i)) })),
          trips: Array.from({ length: 5 }, (_, i) => ({ name: 'Draft trip ' + i, from: D.key(D.inMonth(k0 + i, 10)), to: D.key(D.inMonth(k0 + i, 13)), items: [{ name: 'Hotel', amount: 250 }] })),
        },
      };
      Store.addPlan(p);
      UI.month = null;
    });
  }
  if (throttle > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  const res = await page.evaluate(() => {
    const hasCal = typeof calendar === 'function';
    const med = a => {
      const s = [...a].sort((x, y) => x - y);
      return +s[Math.floor(s.length / 2)].toFixed(2);
    };
    const time = (fn, n = 15) => {
      fn(); // warm up
      const t = [];
      for (let i = 0; i < n; i++) {
        const a = performance.now();
        fn();
        t.push(performance.now() - a);
      }
      return med(t);
    };
    // work done after the click: drawing plus the layout the browser has to do before it can paint
    const settle = () => document.body.getBoundingClientRect();
    const out = { calendar: hasCal };
    const month = Store.proj.months[0];
    out.plan = {
      items: Store.plan.items.length,
      months: Store.proj.months.length,
      entriesThisMonth: month.entries.length,
      datedThisMonth: month.entries.filter(e => e.date !== null).length,
    };
    out.dbBytes = localStorage.getItem('runway.db.v1').length;
    out.render = {};
    out.nodes = {};
    const view = (name, setup) => {
      setup();
      out.render[name] = time(() => {
        App.render();
        settle();
      }, 10);
      out.nodes[name] = document.querySelectorAll('#main *').length;
    };
    view('overview', () => (UI.view = 'overview'));
    view('months:list', () => Object.assign(UI, { view: 'months', mview: 'list', month: null }));
    view('months:days', () => Object.assign(UI, { view: 'months', mview: 'days' }));
    if (!hasCal) {
      return out;
    }
    view('months:calendar', () => Object.assign(UI, { view: 'months', mview: 'calendar' }));
    view('settings:calendar', () => Object.assign(UI, { view: 'settings', stab: 'calendar' }));
    // My calendar (a build without it leaves these rows out): what it shows at first, then every layer of the plan on
    const hasAgenda = typeof V === 'object' && !!V.agenda;
    if (hasAgenda) {
      const layers = Store.plan.agenda.layers;
      view('agenda', () => (UI.view = 'agenda'));
      Store.plan.agenda.layers = [...AGENDA_LAYERS];
      view('agenda:allLayers', () => (UI.view = 'agenda'));
      Store.plan.agenda.layers = layers;
      // a save that changes only the calendar keeps the projection; a save of a plan record works it out again
      const entry = { ...Store.plan.agenda.entries[0] };
      const item = { ...Store.plan.items[0] };
      let n = 0;
      out.save = {
        appointment: time(() => Actions.saveEntry({ ...entry, title: 'Perf ' + n++ }), 10),
        transaction: time(() => Actions.save('items', { ...item, name: 'Perf ' + n++ }), 10),
      };
      Store.undoS = [];
    }
    // the calendar on its own: building it (detached), then building, placing and laying it out
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;width:1200px';
    document.getElementById('main').append(host);
    out.calendarBuild = {};
    out.calendarBuildAndLayout = {};
    out.calendarNodes = {};
    const prefs = Store.db.calendar;
    for (const mode of ['full', 'compact', 'mini']) {
      const opts = { ...planCalendar(), id: 'perf-' + mode, mode };
      out.calendarBuild[mode] = time(() => calendar(opts), 20);
      out.calendarBuildAndLayout[mode] = time(() => {
        host.replaceChildren(calendar(opts));
        host.getBoundingClientRect();
      }, 20);
      out.calendarNodes[mode] = host.querySelectorAll('*').length;
    }
    const ovOpts = { ...planCalendar({ only: prefs.overviewGroups, figure: null, openPlanner: true, ahead: true }), id: 'perf-ov', mode: 'mini' };
    out.calendarBuild.overviewMini = time(() => calendar(ovOpts), 20);
    out.planCalendarOptions = time(() => planCalendar(), 50);
    host.remove();
    // interactions on the Overview calendar (each redraws the calendar only)
    UI.view = 'overview';
    App.render();
    const cal = () => document.querySelector('[data-cal="overview"]');
    const click = sel => cal().querySelector(sel).click();
    out.interaction = {};
    out.interaction.nextAndBack = time(() => {
      click('[data-focus="next"]');
      click('[data-focus="prev"]');
      settle();
    }, 10);
    const day = Store.proj.months[0].start + 9;
    out.interaction.chooseDay = time(() => {
      cal().querySelector(`[data-day="${day}"]`).click();
      settle();
    }, 10);
    // the Overview's mini month has no legend (legend: false): only timed where there is one
    const legend = () => cal().querySelector('.cal-lg');
    if (legend()) {
      out.interaction.legendOffOn = time(() => {
        legend().click();
        legend().click();
        settle();
      }, 10);
    }
    out.interaction.dayMenu = time(() => {
      cal().querySelector(`[data-day="${day}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }));
      settle();
      closePop();
    }, 10);
    return out;
  });
  // memory: the Overview redrawn 50 times, a frame apart as in use (a removed calendar is let go on the next frame)
  res.heapGrowthAfter50OverviewRendersKB = await page.evaluate(async () => {
    if (!window.gc || !performance.memory) {
      return null;
    }
    const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    UI.view = 'overview';
    App.render();
    for (let i = 0; i < 5; i++) {
      await frame();
    }
    gc();
    const before = performance.memory.usedJSHeapSize;
    for (let i = 0; i < 50; i++) {
      App.render();
      await frame();
    }
    for (let i = 0; i < 5; i++) {
      await frame();
    }
    gc();
    return Math.round((performance.memory.usedJSHeapSize - before) / 1024);
  });
  // startup: reload with the plan stored, until the first page is drawn
  res.startup = [];
  for (let i = 0; i < 3; i++) {
    await page.reload();
    res.startup.push(
      await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        return +nav.loadEventEnd.toFixed(1);
      }),
    );
  }
  res.startup = res.startup.sort((a, b) => a - b)[1];
  if (profile && res.calendar) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
    await cdp.send('Profiler.start');
    await page.evaluate(mode => {
      const opts = { ...planCalendar(), id: 'perf-prof', mode };
      for (let i = 0; i < 30; i++) {
        calendar(opts);
      }
    }, profileMode);
    const { profile: p } = await cdp.send('Profiler.stop');
    const self = new Map();
    const dt = p.timeDeltas;
    const byId = new Map(p.nodes.map(n => [n.id, n]));
    const counts = new Map();
    p.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
    for (const [id, us] of counts) {
      const n = byId.get(id).callFrame;
      const key = `${n.functionName || '(anonymous)'} ${n.url ? 'L' + (n.lineNumber + 1) : n.url === '' ? '(native)' : ''}`.trim();
      self.set(key, (self.get(key) || 0) + us);
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0);
    res.profileTop = [...self.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 14)
      .map(([k, us]) => `${((us / total) * 100).toFixed(1).padStart(5)}%  ${k}`);
  }
  res.errors = errors;
  console.log(JSON.stringify(res, null, 1));
  await browser.close();
  if (throttle >= 4) {
    const over = Object.entries(res.render).filter(([, ms]) => ms > 50);
    for (const [name, ms] of over) {
      console.log(`OVER ${name}: ${ms} ms (budget 50 ms)`);
    }
    process.exitCode = over.length || errors.length ? 1 : 0;
  }
})();
