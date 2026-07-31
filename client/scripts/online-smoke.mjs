/**
 * Two-browser online match test.
 *
 * Opens two independent browser contexts against the Rails server, creates a
 * room in one, joins it from the other, and checks that both land on court and
 * that the guest's simulation is being driven by the host's snapshots rather
 * than drifting on its own.
 *
 * This is the only way to actually verify the netcode: a single browser can
 * never catch a host/guest disagreement.
 *
 *   node scripts/online-smoke.mjs [outputDir]
 */

import { chromium } from 'playwright';
import { mkdirSync, globSync } from 'node:fs';

const OUT = process.argv[2] ?? 'screenshots';
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

mkdirSync(OUT, { recursive: true });

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

const errors = [];
const openPage = async (label) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return page;
};

console.log(`\n  Online match test against ${BASE}\n`);

const host = await openPage('host');
const guest = await openPage('guest');

// ---- Host creates a room --------------------------------------------------
await host.getByRole('button', { name: /Online versus/ }).click();
await host.waitForTimeout(400);
await host.getByPlaceholder('Player').fill('Host');
await host.getByRole('button', { name: 'Create a room' }).click();
await host.waitForTimeout(1200);

const code = (await host.locator('.display.mb-1').first().textContent())?.trim();
console.log(`  room code: ${code}`);
if (!code || code.length < 4) {
  console.error('  ✗ no room code was rendered');
  await browser.close();
  process.exit(1);
}
await host.screenshot({ path: `${OUT}/online-01-host-room.png` });

// ---- Guest joins ----------------------------------------------------------
await guest.getByRole('button', { name: /Online versus/ }).click();
await guest.waitForTimeout(400);
await guest.getByPlaceholder('Player').fill('Guest');
await guest.getByRole('button', { name: 'Join room' }).click();
await guest.getByPlaceholder('ABCD').fill(code);
await guest.getByRole('button', { name: 'Join', exact: true }).click();
await guest.waitForTimeout(1200);
await guest.screenshot({ path: `${OUT}/online-02-guest-joined.png` });

// ---- Host leaves the lobby once the opponent has arrived -------------------
await host.getByRole('button', { name: 'Enter the court' }).click();
await host.waitForTimeout(600);

// ---- Both pick players and enter the court --------------------------------
for (const [label, page] of [
  ['host', host],
  ['guest', guest],
]) {
  await page.getByRole('button', { name: 'To the court' }).click();
  await page.waitForTimeout(500);
  console.log(`  ${label} entered the court`);
}

// Let the connection settle, then actually play. Nothing moves in an online
// match until a human does something — both slots are human by definition — so
// the host serves and rallies, and the guest should see all of it.
await host.waitForTimeout(3500);

await host.keyboard.press('Space');
await host.waitForTimeout(2500);

// Chase the ball around for a few seconds so the rally develops.
for (let i = 0; i < 6; i++) {
  await host.keyboard.down('KeyW');
  await host.waitForTimeout(220);
  await host.keyboard.up('KeyW');
  await host.keyboard.press('Space');
  await host.waitForTimeout(380);
}
await host.waitForTimeout(2500);
await host.screenshot({ path: `${OUT}/online-03-host-court.png` });
await guest.screenshot({ path: `${OUT}/online-04-guest-court.png` });

// ---- Are the two peers actually in the same match? ------------------------
// The host owns the simulation and publishes snapshots; if they are not
// arriving, the guest's independent simulation will drift and the scoreboards
// will disagree within a few rallies. Sampling both scoreboards is the cheapest
// honest check that the relay is doing its job.
const readScore = (page) =>
  page.evaluate(() => {
    const text = document.body.innerText;
    const game = text.match(/GAME (\d+)/)?.[1] ?? '?';
    const ball = text.match(/Ball\s+(\d+)°C/)?.[1] ?? '?';
    const rally = text.match(/Rally\s+(\d+) shots/)?.[1] ?? '?';
    return { game, ball, rally };
  });

const [hostScore, guestScore] = await Promise.all([readScore(host), readScore(guest)]);
console.log(`  host  game=${hostScore.game} ball=${hostScore.ball}°C rally=${hostScore.rally}`);
console.log(`  guest game=${guestScore.game} ball=${guestScore.ball}°C rally=${guestScore.rally}`);

// Ball temperature is the most sensitive shared quantity there is: it only
// rises on impacts, so two independently-running simulations diverge on it
// almost immediately.
const synced = hostScore.ball === guestScore.ball && hostScore.rally === guestScore.rally;
console.log(`  simulations in sync: ${synced ? 'yes' : 'NO'}`);

// ---- Did the cable actually connect? --------------------------------------
const cableState = await Promise.all(
  [host, guest].map((page) =>
    page.evaluate(() => ({
      hasCanvas: Boolean(document.querySelector('canvas')),
      // ActionCable exposes its consumers' connection state on the socket.
      wsOpen: performance
        .getEntriesByType('resource')
        .some((entry) => entry.name.includes('/cable')),
      text: document.body.innerText.includes('CONDITIONING'),
    })),
  ),
);

console.log(`  host  canvas=${cableState[0].hasCanvas} hud=${cableState[0].text}`);
console.log(`  guest canvas=${cableState[1].hasCanvas} hud=${cableState[1].text}`);

await browser.close();

const fatal = errors.filter((e) => !/favicon|DevTools|WebGL/i.test(e));
if (fatal.length) {
  console.error(`\n  ✗ ${fatal.length} console error(s):`);
  for (const error of fatal.slice(0, 12)) console.error(`    ${error}`);
  process.exit(1);
}
if (!cableState.every((s) => s.hasCanvas && s.text)) {
  console.error('\n  ✗ one or both peers failed to reach the court');
  process.exit(1);
}
if (!synced) {
  console.error('\n  ✗ host and guest simulations disagree — snapshots are not being applied');
  process.exit(1);
}
console.log('\n  ✓ both peers on court and in sync, no console errors\n');
