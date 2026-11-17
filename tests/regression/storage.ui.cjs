/**
 * @file Browser test of the storage: migration with backup, record metadata, the IndexedDB record index, the device
 * id. Run with: npm run test:storage (builds dist-test first). Real localStorage and IndexedDB, in Chromium.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST = path.resolve(__dirname, '../../dist-test');
let failed = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  console.log((cond ? 'ok   ' : 'FAIL ') + msg);
  if (!cond) failed++;
};

(async () => {
  const { heavyDb } = await import('../../scripts/heavy-data.mjs');
  const v6 = JSON.stringify(heavyDb({ version: 6 })); // as version 6 stored it: no dates
  const server = http.createServer((req, res) => {
    const file = path.join(DIST, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    fs.readFile(file, (err, body) => {
      res.writeHead(err ? 404 : 200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html' });
      res.end(body);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const outside = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  const requested = [];
  page.on('request', r => requested.push(r.url()));
  page.on('request', r => !r.url().startsWith(base) && !/^(data|blob):/.test(r.url()) && outside.push(r.url()));
  try {
    await page.goto(base + 'sw.js');
    await page.evaluate(d => localStorage.setItem('runway.db.v1', d), v6);
    await page.goto(base);
    await page.locator('.kpi').first().waitFor();
    await page.evaluate(() => Store.migrated);
    ok(await page.evaluate(() => I18N.all === null && !I18N.loading), 'start: the texts to translate are not loaded (not part of the page’s code)');

    // ------------------------------------------------------------------------------------------- migration
    const m = await page.evaluate(async () => {
      const stored = JSON.parse(localStorage.getItem('runway.db.v1'));
      const list = await backups();
      return { target: APP.schema, schema: stored.schemaVersion, v: stored.v, backups: list.map(b => [b.from, b.to, b.text.length]), backupText: list[0] && list[0].text };
    });
    ok(m.target >= 7 && m.schema === m.target && m.v === m.target, `migration: the stored data is schema ${m.target} (the current one)`);
    ok(m.backups.length === 1 && m.backups[0][0] === 6 && m.backups[0][1] === m.target, `migration: one backup, from 6 to ${m.target}`);
    ok(m.backupText === v6, 'migration: the backup is the stored text exactly as it was');
    const meta = await page.evaluate(() => {
      Store.cleanPlans();
      let all = 0;
      let bad = 0;
      for (const plan of Object.values(Store.db.plans)) {
        const records = [plan, ...RECORD_LISTS.flatMap(l => plan[l]), ...plan.trips.flatMap(t => t.items)];
        for (const r of records) {
          all++;
          if (!ID_RE.test(r.id) || !(r.createdAt > 0) || !(r.updatedAt > 0) || r.deletedAt !== null) bad++;
        }
      }
      return { all, bad };
    });
    ok(meta.all > 9000 && meta.bad === 0, `migration: all ${meta.all} records have id, createdAt, updatedAt, deletedAt null`);
    const same = await page.evaluate(original => {
      const strip = x => JSON.parse(JSON.stringify(x, (k, v) => (['createdAt', 'updatedAt', 'deletedAt', 'deleted', 'fieldsUpdatedAt'].includes(k) ? undefined : v)));
      const before = JSON.parse(original);
      return Object.keys(before.plans).every(id => JSON.stringify(strip(normPlan(before.plans[id]))) === JSON.stringify(strip(Store.db.plans[id])));
    }, v6);
    ok(same, 'migration: every plan keeps all its data');
    ok((await page.locator('.kpi').count()) === 4, 'the app shows the plan as before');

    // ------------------------------------------------------------------------------------------- device id
    const device = await page.evaluate(async () => [await kv.get('deviceId'), localStorage.getItem('runway.device'), Store.deviceId]);
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(device[0]), 'device id: a random UUID in IndexedDB');
    ok(device[0] === device[1] && device[0] === device[2], 'device id: the same in localStorage and in the store');

    // ------------------------------------------------------------------------------------------- record index
    await page.evaluate(() => Store.reindex());
    const index = await page.evaluate(async () => {
      const expected = Object.values(Store.db.plans).reduce((n, p) => n + planEntries(p).length, 0);
      return { count: await records.count(), expected, deleted: (await records.deleted()).length };
    });
    ok(index.count === index.expected, `index: every record of every plan is in IndexedDB (${index.count})`);
    ok(index.deleted === 0, 'index: nothing deleted yet (deletedAt null is not in the deletedAt index)');
    const changes = await page.evaluate(async () => {
      const since = Date.now() - 1;
      await new Promise(r => setTimeout(r, 5));
      const bill = Store.plan.bills[0];
      Actions.patch('bills', bill.id, { amount: bill.amount + 1 }, 'x');
      const gone = Store.plan.items[0];
      Actions.remove('items', gone.id);
      await new Promise(r => setTimeout(r, 50));
      const changed = await records.changedSince(since);
      const deleted = await records.deleted();
      return {
        changed: changed.map(e => e.type + ':' + e.id).sort(),
        expected: ['bill:' + bill.id, 'item:' + gone.id, 'plan:' + Store.plan.id].sort(),
        deleted: deleted.map(e => [e.type, e.id, e.deletedAt === Store.plan.deleted.items.find(i => i.id === gone.id).deletedAt]),
        gone: gone.id,
        updated: changed.find(e => e.id === bill.id).data.amount === bill.amount + 1,
      };
    });
    ok(JSON.stringify(changes.changed) === JSON.stringify(changes.expected), 'index: "changed since" gives exactly the records saved: ' + changes.changed.join(', '));
    ok(changes.updated, 'index: with their new data');
    ok(changes.deleted.length === 1 && changes.deleted[0][0] === 'item' && changes.deleted[0][1] === changes.gone && changes.deleted[0][2], 'index: the deleted record is in the deletedAt index, with its date');

    // a reload: the same device, nothing migrated or backed up again, the index already current
    await page.reload();
    await page.locator('.kpi').first().waitFor();
    const again = await page.evaluate(async () => {
      await Store.migrated;
      const current = await Promise.all(Object.values(Store.db.plans).map(p => records.current(p.id, p.updatedAt)));
      return { device: await kv.get('deviceId'), backups: (await backups()).length, current };
    });
    ok(again.device === device[0], 'reload: the same device id');
    ok(again.backups === 1, 'reload: no second migration or backup');
    ok(again.current.every(Boolean), 'reload: the record index is current, nothing to rebuild');

    // ------------------------------------------------------------------------------------------- texts to translate
    const requestsBefore = requested.length;
    await page.evaluate(() => App.go('settings', { stab: 'language' }));
    await page.waitForFunction(() => !!I18N.all);
    const texts = await page.evaluate(() => {
      const pack = JSON.parse(I18N.exportPack('en'));
      return { keys: I18N.KEYS.length, words: I18N.WORDS.length, strings: Object.keys(pack.strings).length, save: pack.strings.Save };
    });
    const loaded = requested.slice(requestsBefore).filter(u => u.endsWith('/i18n-texts.json'));
    ok(loaded.length === 1, 'Settings › Language: the texts to translate are loaded then, from next to the page, once');
    ok(texts.keys > 1000 && texts.words > 5 && texts.strings > texts.keys && texts.save === 'Save', `Export language: every text is there (${texts.keys} texts, ${texts.words} words)`);
    const chooser = page.waitForEvent('download');
    await page.locator('.lang-card').first().getByRole('button', { name: 'Export' }).click();
    const file = JSON.parse(fs.readFileSync(await (await chooser).path(), 'utf8'));
    ok(file.kind === 'language' && Object.keys(file.strings).length === texts.strings, 'Export language: the file has every text');

    // ------------------------------------------------------------------------------------------- delete everything
    await page.evaluate(() => App.go('settings', { stab: 'backup' }));
    await page.getByRole('button', { name: 'Delete everything' }).click();
    await page.locator('dialog').getByRole('button', { name: 'Delete everything' }).click();
    await page.waitForTimeout(300);
    const wiped = await page.evaluate(async () => ({ records: await records.count(), backups: (await backups()).length, device: await kv.get('deviceId') }));
    ok(wiped.records === 0 && wiped.backups === 0, 'Delete everything: the record index and the backups are gone too');
    ok(wiped.device === device[0], 'Delete everything: the device id stays (it names this browser, nothing else)');

    ok(outside.length === 0, 'no request leaves the page’s folder' + (outside.length ? ': ' + outside.join(', ') : ''));
  } catch (e) {
    ok(false, 'stopped: ' + (e && e.message ? e.message.split('\n')[0] : e));
  }
  ok(errors.length === 0, 'no errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  server.close();
  console.log(failed ? `\n${failed} FAILED` : `\nSTORAGE OK (${checks} checks)`);
  process.exit(failed ? 1 : 0);
})();
