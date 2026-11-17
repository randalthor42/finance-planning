// Browser tests for the calendar on phones and tablets (feature: act like Google Calendar): swipe the month, a day in a
// bottom sheet that peeks, opens to every detail when dragged up, swipes to the next day and drags away; hold a day and
// swipe up. Real touches (Chrome's Input.dispatchTouchEvent), so touch-action and the browser's own scrolling take part.
// Run with: npm run test:ui (needs only the sample plan; the clock is fixed on 5 November 2026).
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const PAGE = 'file://' + path.resolve(__dirname, '../../dist-test/index.html');
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const pg = await ctx.newPage();
  pg.setDefaultTimeout(5000);
  const cdp = await ctx.newCDPSession(pg);
  const errs = [];
  let passed = 0;
  pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  pg.on('console', m => {
    if (m.type() === 'error') errs.push('CONSOLE ' + m.text());
  });
  const ok = (c, m) => {
    if (!c) errs.push('FAIL ' + m);
    else {
      passed++;
      console.log('ok', m);
    }
  };
  const wait = ms => pg.waitForTimeout(ms);
  const touch = (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  /** A finger from (x0, y0) to (x1, y1): `hold` ms still first, then `ms` to get there. */
  const swipe = async (x0, y0, x1, y1, { hold = 0, ms = 160, steps = 8 } = {}) => {
    await touch('touchStart', x0, y0);
    if (hold) await wait(hold);
    for (let i = 1; i <= steps; i++) {
      await touch('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await wait(ms / steps);
    }
    await touch('touchEnd');
    await wait(320); // the glide
  };
  const tap = async (x, y) => {
    await touch('touchStart', x, y);
    await touch('touchEnd');
    await wait(320);
  };
  const center = async loc => {
    const r = await loc.boundingBox();
    return [r.x + r.width / 2, r.y + r.height / 2];
  };

  await pg.clock.setFixedTime(new Date('2026-11-05T10:00:00'));
  await pg.goto(PAGE);
  await pg.getByText('Look around with a sample plan').click();
  await pg.evaluate(() => {
    Actions.saveEntry({ id: 'dent0001', title: 'Dentist', date: '2026-11-10', time: '09:30', note: 'Bring the card' });
    App.go('agenda');
    document.getElementById('toasts').replaceChildren();
  });
  const cal = pg.locator('[data-cal="agenda"]');
  await pg.waitForFunction(() => document.querySelector('[data-cal="agenda"]')?.dataset.mode === 'mobile');
  const title = () => cal.locator('.cal-title b').textContent();
  const dayN = s => pg.evaluate(s => D.parse(s), s);
  const cell = async s => cal.locator(`.cal-d[data-day="${await dayN(s)}"]`);
  const sheet = pg.locator('.sheet');
  const sheetState = () => sheet.getAttribute('data-state');
  const gridBox = async () => cal.locator('.cal-gw').boundingBox();

  /* ---------- swipe the month ---------- */
  ok((await title()) === 'November 2026', 'a phone shows the month');
  let g = await gridBox();
  const gy = g.y + g.height * 0.6;
  await swipe(g.x + g.width * 0.85, gy, g.x + g.width * 0.1, gy);
  ok((await title()) === 'December 2026', 'swiping left shows the next month');
  g = await gridBox();
  await swipe(g.x + g.width * 0.15, gy, g.x + g.width * 0.9, gy);
  ok((await title()) === 'November 2026', 'swiping right, the month before');
  await swipe(g.x + g.width * 0.5, gy, g.x + g.width * 0.4, gy, { ms: 600 });
  ok((await title()) === 'November 2026', 'a short slow drag springs back');
  ok(
    await pg.evaluate(() => !document.querySelector('[data-cal="agenda"] .cal-grid').style.transform),
    'and the grid is back in its place',
  );
  const y0 = await pg.evaluate(() => scrollY);
  await swipe(g.x + g.width * 0.5, gy, g.x + g.width * 0.5, gy - 250);
  ok((await pg.evaluate(() => scrollY)) > y0 && (await title()) === 'November 2026', 'a swipe up or down scrolls the page as usual');
  // the page's own scroll keeps gliding: a tap during that glide only stops it (as on any phone), so let it end
  await pg.evaluate(() => scrollTo(0, 0));
  await wait(900);

  /* ---------- a day in a bottom sheet ---------- */
  await tap(...(await center(await cell('2026-11-10'))));
  ok((await sheet.count()) === 1 && (await sheetState()) === 'peek', 'tapping a day opens it in a sheet that peeks up');
  ok((await sheet.locator('.sheet-t').textContent()).includes('10 Nov'), 'with the day as its title');
  ok((await sheet.locator('.row', { hasText: 'Dentist' }).count()) === 1, 'and the lines of the day');
  ok((await (await cell('2026-11-10')).getAttribute('aria-selected')) === 'true', 'the day is chosen in the grid');
  ok((await cal.locator('.cal-agenda').count()) === 1, 'the month list stays under the grid');
  ok((await pg.locator('.sheet-scrim').count()) === 1, 'the page behind is dimmed');
  const box = await sheet.boundingBox();
  ok(box.y > 844 * 0.4 && box.y < 844 * 0.8, 'peeking: under half the screen (' + Math.round(844 - box.y) + ' px)');

  // press and drag it up: every detail
  const [hx, hy] = await center(sheet.locator('.sheet-t'));
  await swipe(hx, hy, hx, hy - 420, { ms: 240 });
  ok((await sheetState()) === 'full', 'dragged up, it opens to every detail');
  ok((await sheet.boundingBox()).y < 844 * 0.2, 'nearly the whole screen');
  const detail = sheet.locator('.sheet-ev', { hasText: 'Dentist' });
  ok((await detail.count()) === 1, 'each line is a card');
  ok((await detail.textContent()).includes('Bring the card') && (await detail.textContent()).includes('09:30'), 'with its notes and time');
  ok((await detail.getByRole('button', { name: 'Edit' }).count()) === 1, 'and its actions as buttons');
  await detail.getByRole('button', { name: 'Edit' }).click();
  ok((await pg.locator('dialog[open] h2').textContent()) === 'Edit appointment', 'an action opens its window over the sheet');
  await pg.locator('dialog[open]').getByRole('textbox', { name: 'What', exact: true }).fill('Dentist, check-up');
  await pg.locator('dialog[open]').getByRole('button', { name: /^(Save|Done)$/ }).click();
  await wait(350);
  ok((await sheetState()) === 'full' && (await sheet.locator('.sheet-ev', { hasText: 'check-up' }).count()) === 1, 'saved: the sheet stays open, with the change');

  // buttons do what the gestures do
  await sheet.getByRole('button', { name: 'Fewer details' }).click();
  await wait(300);
  ok((await sheetState()) === 'peek', '"Fewer details" goes back to the peek');
  await sheet.getByRole('button', { name: 'More details' }).click();
  await wait(300);
  ok((await sheetState()) === 'full', '"More details" opens it');
  await sheet.getByRole('button', { name: 'Fewer details' }).click();
  await wait(300);

  // swipe it sideways: the next day
  const [sx, sy] = await center(sheet.locator('.sheet-grab'));
  await swipe(sx + 120, sy, sx - 140, sy);
  ok((await sheet.locator('.sheet-t').textContent()).includes('11 Nov'), 'swiped to the left: the next day');
  ok((await (await cell('2026-11-11')).getAttribute('aria-selected')) === 'true', 'and the grid follows');
  await swipe(sx - 120, sy, sx + 140, sy);
  ok((await sheet.locator('.sheet-t').textContent()).includes('10 Nov'), 'to the right: the day before');
  await pg.evaluate(() => {
    UI.calendars.agenda.sel = D.parse('2026-11-30');
    App.render();
  });
  await sheet.getByRole('button', { name: 'Next day' }).click();
  await wait(300);
  ok((await title()) === 'December 2026' && (await sheet.locator('.sheet-t').textContent()).includes('1 Dec'), 'the next day of the last day is in the next month');

  // drag it down: it goes, and the day is no longer chosen
  const [dx, dy] = await center(sheet.locator('.sheet-t'));
  await swipe(dx, dy, dx, dy + 380, { ms: 200 });
  ok((await sheet.count()) === 0, 'dragged down from the peek, it goes away');
  ok((await cal.locator('.cal-d.sel').count()) === 0, 'and the day is no longer chosen');
  ok(await pg.evaluate(() => !document.documentElement.classList.contains('sheet-lock')), 'the page scrolls again');
  await pg.evaluate(() => App.go('agenda'));
  await cal.getByRole('button', { name: 'Previous month' }).click();

  // Esc and the dimmed page close it too
  await tap(...(await center(await cell('2026-11-10'))));
  await pg.keyboard.press('Escape');
  await wait(300);
  ok((await sheet.count()) === 0, 'Esc closes it');
  ok(await pg.evaluate(() => document.activeElement?.dataset.day === String(D.parse('2026-11-10'))), 'and gives the focus back to the day');
  await tap(...(await center(await cell('2026-11-10'))));
  await tap(195, 60);
  ok((await sheet.count()) === 0, 'so does a tap on the dimmed page');

  /* ---------- hold a day, then swipe up ---------- */
  const [cx, cy] = await center(await cell('2026-11-12'));
  await swipe(cx, cy, cx, cy - 600, { hold: 400, ms: 260 });
  ok((await sheet.count()) === 1 && (await sheetState()) === 'full', 'a day held then swiped up pulls its details all the way');
  ok((await sheet.locator('.sheet-t').textContent()).includes('12 Nov'), 'for that day');
  ok((await cal.locator('.cal-d.held').count()) === 0, 'and the day is let go');
  await pg.keyboard.press('Escape');
  await wait(300);
  const [ex, ey] = await center(await cell('2026-11-13'));
  await swipe(ex, ey, ex, ey - 120, { hold: 400, ms: 200 });
  ok((await sheetState()) === 'peek', 'swiped up a little: it peeks');
  await pg.keyboard.press('Escape');
  await wait(300);
  const yBefore = await pg.evaluate(() => scrollY);
  await swipe(ex, ey, ex, ey - 200, { ms: 150 });
  ok((await sheet.count()) === 0 && (await pg.evaluate(() => scrollY)) > yBefore, 'without holding, the same swipe scrolls the page');
  await pg.evaluate(() => scrollTo(0, 0));
  await wait(900);

  /* ---------- leaving the page takes the sheet along ---------- */
  await tap(...(await center(await cell('2026-11-10'))));
  await pg.evaluate(() => App.go('trips'));
  await wait(300);
  ok((await sheet.count()) === 0 && (await pg.locator('.sheet-scrim').count()) === 0, 'another page: no sheet left behind');
  ok(await pg.evaluate(() => !document.documentElement.classList.contains('sheet-lock')), 'and the page scrolls');

  /* ---------- the Month planner: the same calendar, its month kept in step ---------- */
  await pg.evaluate(() => {
    UI.mview = 'calendar';
    App.go('months', { month: null });
  });
  const mc = pg.locator('[data-cal="months"]');
  await mc.waitFor();
  const k0 = await pg.evaluate(() => Store.proj.summary.s0);
  // on a phone the planner's grid is under the month's figures: bring it into view
  const gridInView = async () => {
    await mc.locator('.cal-gw').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await wait(100);
    return mc.locator('.cal-gw').boundingBox();
  };
  const mg = await gridInView();
  await swipe(mg.x + mg.width * 0.85, mg.y + mg.height * 0.5, mg.x + mg.width * 0.1, mg.y + mg.height * 0.5);
  ok((await pg.evaluate(() => UI.month)) === k0 + 1, 'a swipe in the planner moves the planner to the next month');
  const mg2 = await gridInView();
  await swipe(mg2.x + mg2.width * 0.15, mg2.y + mg2.height * 0.5, mg2.x + mg2.width * 0.9, mg2.y + mg2.height * 0.5);
  ok((await pg.evaluate(() => UI.month)) === k0, 'and back');
  const mg3 = await gridInView();
  await swipe(mg3.x + mg3.width * 0.15, mg3.y + mg3.height * 0.5, mg3.x + mg3.width * 0.9, mg3.y + mg3.height * 0.5);
  ok((await pg.evaluate(() => UI.month)) === k0, 'not before the plan starts (it gives way a little, then springs back)');
  const rent = await pg.evaluate(() => Store.proj.months[0].entries.find(e => e.label === 'Rent').date);
  // straight after the swipe: a tap right after changing month is not lost
  await tap(...(await center(mc.locator(`.cal-d[data-day="${rent}"]`))));
  await sheet.getByRole('button', { name: 'More details' }).click();
  await wait(300);
  const rentCard = sheet.locator('.sheet-ev', { hasText: 'Rent' });
  ok((await rentCard.getByRole('button', { name: /Mark as (not )?paid/ }).count()) === 1, 'a plan line has its actions: mark as paid…');
  ok((await sheet.locator('.sheet-day').textContent()).includes('End-of-day balance'), 'and the day says its balance');
  await rentCard.getByRole('button', { name: /Mark as (not )?paid/ }).click();
  await wait(300);
  ok((await sheet.count()) === 1 && (await sheet.locator('.sheet-ev.done', { hasText: 'Rent' }).count()) === 1, 'ticked off from the sheet, it stays open and shows it paid');
  await pg.screenshot({ path: path.join(SHOTS, 'touch-sheet-full.png') });

  /* ---------- a wider window: the day under the grid, as before ---------- */
  await pg.setViewportSize({ width: 1280, height: 900 });
  await pg.evaluate(() => App.render());
  await wait(300);
  ok((await sheet.count()) === 0, 'on a wide screen there is no sheet');
  ok((await mc.locator('.cal-panel', { hasText: 'Rent' }).count()) === 1, 'the chosen day is listed under the grid, still chosen');

  /* ---------- a tablet ---------- */
  await pg.setViewportSize({ width: 740, height: 1000 });
  await pg.evaluate(() => App.go('agenda'));
  await pg.waitForFunction(() => document.querySelector('[data-cal="agenda"]')?.dataset.mode === 'tablet');
  // a tablet draws the lines in the days: a tap on a line opens it, a tap on the day (its number) opens the day
  await tap(...(await center((await cell('2026-11-10')).locator('.cal-n'))));
  const tb = await sheet.boundingBox();
  ok((await sheetState()) === 'peek' && tb.width <= 680 && tb.x > 20, 'a tablet has the sheet too, not wider than it needs');
  await pg.screenshot({ path: path.join(SHOTS, 'touch-tablet.png') });
  await pg.keyboard.press('Escape');

  /* ---------- less motion ---------- */
  await pg.emulateMedia({ reducedMotion: 'reduce' });
  await tap(...(await center((await cell('2026-11-10')).locator('.cal-n'))));
  ok((await sheet.evaluate(el => getComputedStyle(el).transitionDuration)) === '0s', 'with less motion asked for, nothing glides');
  await pg.keyboard.press('Escape');

  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.evaluate(() => App.render());
  await pg.waitForFunction(() => document.querySelector('[data-cal="agenda"]')?.dataset.mode === 'mobile');
  await tap(...(await center(await cell('2026-11-10'))));
  ok((await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, 'nothing sticks out sideways');
  await pg.screenshot({ path: path.join(SHOTS, 'touch-sheet-peek.png') });
  const text = await pg.evaluate(() => document.body.innerText);
  ok(!/undefined|NaN|\[object/.test(text), 'no broken text');
  console.log(errs.length ? errs.join('\n') : `CALENDAR TOUCH UI OK (${passed} checks)`);
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
