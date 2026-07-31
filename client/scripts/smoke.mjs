/**
 * Browser smoke test.
 *
 * Drives the real app in a real browser: opens the menu, starts an exhibition,
 * lets the simulation run, and screenshots each stage. Also fails loudly on any
 * console error or unhandled rejection, which is the only reliable way to catch
 * three.js and WebGL problems that never appear in a typecheck.
 *
 *   node scripts/smoke.mjs [outputDir]
 */

import { chromium } from 'playwright';
import { mkdirSync, globSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots';
const BASE = process.env.BASE_URL ?? 'http://localhost:5173';

mkdirSync(OUT, { recursive: true });

// PLAYWRIGHT_BROWSERS_PATH points at a shared browser pool whose directory
// names carry a build number, so resolve the binary rather than hard-coding it.
const chromePath =
  process.env.CHROME_PATH ??
  globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0] ??
  undefined;

// Software GL is only needed on headless Linux CI, which has no real GPU;
// forcing it on Windows/macOS breaks screenshot capture.
const args =
  process.platform === 'linux'
    ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
    : [];

const browser = await chromium.launch({ executablePath: chromePath, args });

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png`);
};

console.log(`\n  Smoke test against ${BASE}\n`);

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await shot('01-menu');

// Rules tab — pure UI, no renderer.
await page.getByRole('button', { name: 'rules' }).click();
await page.waitForTimeout(300);
await shot('02-rules');

await page.getByRole('button', { name: 'play' }).click();
await page.waitForTimeout(200);

// Exhibition: two AI players, so the sim drives itself with no input needed.
await page.getByRole('button', { name: /Exhibition/ }).click();
await page.waitForTimeout(500);
await shot('03-player-select');

await page.getByRole('button', { name: 'To the court' }).click();
// Give the renderer time to compile shaders and the match time to get going.
await page.waitForTimeout(9000);
await shot('04-match');

await page.waitForTimeout(12000);
await shot('05-rally');

// Pull the state out of the page to prove the simulation is actually running.
const stats = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return {
    hasCanvas: Boolean(canvas),
    canvasWidth: canvas?.width ?? 0,
    canvasHeight: canvas?.height ?? 0,
    scoreboardText: document.body.innerText.slice(0, 900),
  };
});

// Trigger a replay, which exercises the recorder, the scrubber and Hawk-Eye.
await page.getByRole('button', { name: 'Replay' }).click();
await page.waitForTimeout(1800);
await shot('06-replay');

await browser.close();

console.log('\n  Canvas:', stats.hasCanvas ? `${stats.canvasWidth}×${stats.canvasHeight}` : 'MISSING');
console.log('\n  ── Page text ──');
console.log(
  stats.scoreboardText
    .split('\n')
    .filter(Boolean)
    .map((l) => `  ${l}`)
    .join('\n'),
);

const fatal = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
if (fatal.length) {
  console.error(`\n  ✗ ${fatal.length} console error(s):`);
  for (const error of fatal.slice(0, 12)) console.error(`    ${error}`);
  process.exit(1);
}
if (!stats.hasCanvas) {
  console.error('\n  ✗ no WebGL canvas was mounted');
  process.exit(1);
}
console.log('\n  ✓ no console errors\n');
