/**
 * @file The screenshots of the installable app (web app manifest "screenshots"): the sample plan's Overview on a wide
 * screen (computers) and a narrow one (phones). Browsers show them in the richer install dialog. Run after a visible
 * change, then build:
 *   npm run build && node scripts/screenshots.mjs        (serves dist itself; writes build/screenshots/*.png)
 * Sizes follow Chrome's rules: each side 320-3840 px, the long side at most 2.3 times the short one.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'screenshots');
/** name, viewport, device scale: 1280x800 and 412x915 pixels. */
export const SHOTS = [
  ['wide', { width: 1280, height: 800 }, 1],
  ['narrow', { width: 412, height: 915 }, 1],
];

const page = fs.readFileSync(path.join(ROOT, 'dist', 'index.html'));
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
fs.mkdirSync(OUT, { recursive: true });
for (const [name, viewport, deviceScaleFactor] of SHOTS) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor,
    colorScheme: 'light',
    serviceWorkers: 'block',
  });
  const tab = await context.newPage();
  await tab.goto(url);
  await tab.getByText('Look around with a sample plan').click();
  await tab.locator('.kpi').first().waitFor();
  await tab.waitForFunction(() => !document.querySelector('.dg-wait'));
  await tab.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await tab.waitForTimeout(300);
  await tab.screenshot({ path: path.join(OUT, `${name}.png`) });
  await context.close();
  console.log(`build/screenshots/${name}.png ${viewport.width}x${viewport.height}`);
}
await browser.close();
server.close();
