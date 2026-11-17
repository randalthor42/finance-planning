/**
 * @file Lighthouse on the built app, with a heavy plan in it (scripts/heavy-data.mjs), several runs, medians.
 *
 *   npm run build && npm run preview            (another terminal: serves dist on http://localhost:4173)
 *   node scripts/lighthouse.mjs before [runs=3] [url]
 *   node scripts/lighthouse.mjs after
 *   node scripts/lighthouse.mjs compare          the table of both
 *   node scripts/lighthouse.mjs pair [runs=3] <before url> <after url> [before data] [after data]
 *                                                data: the schema of the heavy data each side gets (6: before
 *                                                record dates, 7, 8…; default the current one), each build its own
 *                                                before and after in turns (b1 a1 b2 a2 …): a machine that gets
 *                                                slower or faster during the runs affects both sides alike
 *
 * Each run starts Chrome with a new profile and puts the heavy database in the site's localStorage first. That is
 * done from sw.js, a plain file of the same site, so the app has not run and nothing is registered or cached before
 * Lighthouse loads the page. Lighthouse then runs with its default mobile settings (simulated slow 4G, CPU 4x
 * slower) and --disable-storage-reset, so that the data stays. Reports go to lighthouse/: every run, and
 * lh-<label>.json, the run with the median performance score.
 * Chrome: CHROME_PATH, or Playwright's Chromium (`npx playwright install chromium`), on Windows, macOS or Linux.
 * Lighthouse itself is not a dependency: the first run downloads lighthouse@13.5.0 through npx (network needed once,
 * then npx's cache).
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { APP } from '../src/config.js';
import { heavyDb } from './heavy-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'lighthouse');
const LIGHTHOUSE = 'lighthouse@13.5.0';
const [label = 'run', runsArg = '3', url = 'http://localhost:4173/'] = process.argv.slice(2);

/** The Chrome to run: CHROME_PATH, or the Chromium Playwright installed for this system. */
function chromePath() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  const file = chromium.executablePath();
  if (fs.existsSync(file)) {
    return file;
  }
  throw new Error('No Chrome found: run `npx playwright install chromium`, or set CHROME_PATH');
}

/** A tiny DevTools protocol client over the page's WebSocket. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let next = 0;
  const waiting = new Map();
  const events = [];
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    } else if (msg.method) {
      events.push(msg.method);
    }
  };
  const send = (method, params = {}) =>
    new Promise(resolve => {
      const id = ++next;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return { send, events, close: () => ws.close() };
}

async function waitFor(fn, ms = 15000) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const value = await fn();
      if (value) {
        return value;
      }
    } catch (e) {}
    if (Date.now() > until) {
      throw new Error('timed out');
    }
    await new Promise(r => setTimeout(r, 150));
  }
}

/** Chrome with a new profile and the heavy database in the site's storage. */
async function seededChrome(port, data, target = url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lh-profile-'));
  const chrome = spawn(
    chromePath(),
    ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: 'ignore' },
  );
  const targets = await waitFor(() => fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()));
  const page = targets.find(t => t.type === 'page');
  const c = await cdp(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Page.navigate', { url: new URL('sw.js', target).href });
  await waitFor(
    async () =>
      (await c.send('Runtime.evaluate', { expression: 'document.readyState' })).result.result.value === 'complete',
  );
  const r = await c.send('Runtime.evaluate', {
    expression: `localStorage.clear(); localStorage.setItem('runway.db.v1', ${JSON.stringify(data)}); localStorage.getItem('runway.db.v1').length`,
  });
  if (r.result.result.value !== data.length) {
    throw new Error('seeding failed: ' + JSON.stringify(r.result));
  }
  await c.send('Page.navigate', { url: 'about:blank' });
  c.close();
  return { chrome, profile };
}

/**
 * Runs Lighthouse (through npx, which downloads it on first use) against a Chrome already open on `port`.
 * On Windows npx is npx.cmd, which runs only through a shell: there every argument is quoted (paths may have spaces).
 */
function lighthouse(port, file, target = url) {
  const windows = process.platform === 'win32';
  const args = [
    '-y',
    LIGHTHOUSE,
    target,
    `--port=${port}`,
    '--disable-storage-reset',
    '--output=json',
    `--output-path=${file}`,
    '--quiet',
  ];
  return new Promise((resolve, reject) =>
    execFile(
      'npx',
      windows ? args.map(arg => `"${arg}"`) : args,
      { maxBuffer: 1 << 26, shell: windows },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()),
    ),
  );
}

/** The numbers compared: category scores and the three Core Web Vitals Lighthouse measures. */
function summary(lhr) {
  const a = lhr.audits;
  const score = id => Math.round(lhr.categories[id].score * 100);
  return {
    performance: score('performance'),
    accessibility: score('accessibility'),
    'best-practices': score('best-practices'),
    seo: score('seo'),
    'agentic-browsing': lhr.categories['agentic-browsing'] ? score('agentic-browsing') : NaN,
    LCP: a['largest-contentful-paint'].numericValue,
    TBT: a['total-blocking-time'].numericValue,
    CLS: a['cumulative-layout-shift'].numericValue,
    FCP: a['first-contentful-paint'].numericValue,
    'Speed Index': a['speed-index'].numericValue,
    'Page weight (KB)': a['total-byte-weight'].numericValue / 1024,
    // what the simulation starts from: the paint really seen in the trace, and all main-thread work
    'LCP observed (unthrottled)': a.metrics.details.items[0].observedLargestContentfulPaint,
    'Main-thread work': a['mainthread-work-breakdown'].numericValue,
  };
}
const median = values => {
  const s = [...values].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Failing audits, by the points of its category they cost (weight × what is missing); opportunities by savings. */
function failing(lhr) {
  const rows = [];
  for (const cat of Object.values(lhr.categories)) {
    const total = cat.auditRefs.reduce((s, r) => s + r.weight, 0);
    for (const ref of cat.auditRefs) {
      const audit = lhr.audits[ref.id];
      const failingScore = audit.score !== null && audit.score < 0.9;
      if (!failingScore || audit.scoreDisplayMode === 'informative' || audit.scoreDisplayMode === 'manual') {
        continue;
      }
      const lost = total ? (ref.weight / total) * (1 - audit.score) * 100 : 0;
      const savings = audit.metricSavings
        ? Object.entries(audit.metricSavings)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k} ${k === 'CLS' ? v.toFixed(3) : Math.round(v) + ' ms'}`)
            .join(', ')
        : '';
      rows.push({
        category: cat.id,
        id: ref.id,
        title: audit.title,
        score: audit.score,
        lost,
        savings,
        value: audit.displayValue || '',
      });
    }
  }
  return rows.sort((x, y) => y.lost - x.lost || (y.savings ? 1 : 0) - (x.savings ? 1 : 0));
}

function printFailing(lhr) {
  console.log('\nFailing audits of the median run, by impact (points of the category lost):');
  for (const r of failing(lhr)) {
    console.log(
      `  ${r.lost.toFixed(1).padStart(5)}  ${r.category.padEnd(15)} ${r.id.padEnd(34)} score ${String(r.score).padEnd(5)} ${r.value}${r.savings ? '  [saves ' + r.savings + ']' : ''}`,
    );
  }
}

function table(labels) {
  const data = labels.map(l => JSON.parse(fs.readFileSync(path.join(OUT, `median-${l}.json`), 'utf8')));
  const keys = Object.keys(data[0].medians);
  const fmt = (k, v) =>
    k === 'CLS' ? v.toFixed(3) : /^[a-z]|KB|Index/.test(k) ? String(Math.round(v)) : `${Math.round(v)} ms`;
  console.log(`\n| Median of ${data[0].runs} runs | ${labels.join(' | ')} |`);
  console.log(`|---|${labels.map(() => '---:').join('|')}|`);
  for (const k of keys) {
    console.log(`| ${k} | ${data.map(d => fmt(k, d.medians[k])).join(' | ')} |`);
  }
}

/** One run: a fresh Chrome with the data, Lighthouse, the report; returns its numbers. */
async function measure(name, target, i, data) {
  const port = 9300 + i;
  const { chrome, profile } = await seededChrome(port, data, target);
  const file = path.join(OUT, `${name}-${i}.json`);
  try {
    await lighthouse(port, file, target);
  } finally {
    await new Promise(resolve => {
      chrome.once('exit', resolve);
      chrome.kill();
    });
    try {
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (e) {} // Chrome's helpers may still be closing files: a leftover temporary folder, not a failed run
  }
  const lhr = JSON.parse(fs.readFileSync(file, 'utf8'));
  const s = summary(lhr);
  console.log(
    `${name} run ${i}: ` +
      Object.entries(s)
        .map(([k, v]) => `${k} ${k === 'CLS' ? v.toFixed(3) : Math.round(v)}`)
        .join(' · '),
  );
  return { file, s, lhr };
}
/** Medians of the runs, and the run with the median performance score as lh-<name>.json. */
function finish(name, all) {
  const medians = Object.fromEntries(Object.keys(all[0].s).map(k => [k, median(all.map(r => r.s[k]))]));
  const pick = [...all].sort((x, y) => x.s.performance - y.s.performance)[Math.floor(all.length / 2)];
  fs.copyFileSync(pick.file, path.join(OUT, `lh-${name}.json`));
  fs.writeFileSync(path.join(OUT, `median-${name}.json`), JSON.stringify({ runs: all.length, medians }, null, 1));
  console.log(`\n${name}: medians of ${all.length} runs: ` + JSON.stringify(medians));
  console.log(`median run: ${path.relative(ROOT, pick.file)} → lighthouse/lh-${name}.json`);
  return pick;
}

if (label === 'compare') {
  table(['before', 'after']);
} else if (label === 'pair') {
  const [, runs = '3', beforeUrl, afterUrl, beforeData = String(APP.schema), afterData = String(APP.schema)] =
    process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  const dataBefore = JSON.stringify(heavyDb({ version: +beforeData }));
  const dataAfter = JSON.stringify(heavyDb({ version: +afterData }));
  const before = [];
  const after = [];
  for (let i = 1; i <= +runs; i++) {
    before.push(await measure('before', beforeUrl, i, dataBefore));
    after.push(await measure('after', afterUrl, i, dataAfter));
  }
  finish('before', before);
  const pick = finish('after', after);
  table(['before', 'after']);
  printFailing(pick.lhr);
} else {
  fs.mkdirSync(OUT, { recursive: true });
  const data = JSON.stringify(heavyDb());
  const all = [];
  for (let i = 1; i <= +runsArg; i++) {
    all.push(await measure(label, url, i, data));
  }
  printFailing(finish(label, all).lhr);
}
