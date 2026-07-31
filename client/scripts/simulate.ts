/**
 * Headless match simulation.
 *
 * Runs a full match between two AI opponents with no renderer attached and
 * prints a broadcast-style summary. This is the fastest way to sanity-check
 * that the physics, the rules and the referee are producing squash rather than
 * noise — if rallies are one shot long or nobody can serve legally, it shows up
 * here in a second rather than after a browser reload.
 *
 *   npx tsx scripts/simulate.ts [playerA] [playerB] [difficulty]
 */

import { SIM } from '../src/engine/constants';
import { Simulation } from '../src/engine/world';
import { SquashAI, type Difficulty } from '../src/engine/ai';
import { characterById } from '../src/data/roster';
import { MatchTimeline } from '../src/engine/replay';
import type { SimEvent } from '../src/engine/types';

const [, , aId = 'farag', bId = 'elias', difficulty = 'pro'] = process.argv;

const sim = new Simulation({
  seed: process.env.SEED ?? 'headless-1',
  characters: [aId, bId],
  warmBall: true,
});

const names: [string, string] = [
  characterById(aId).shortName,
  characterById(bId).shortName,
];

const ai = [
  new SquashAI(0, sim.characters[0], difficulty as Difficulty, 11),
  new SquashAI(1, sim.characters[1], difficulty as Difficulty, 22),
];

const timeline = new MatchTimeline();
const outcomes = new Map<string, number>();
const shotCounts: number[] = [];
let maxSpeed = 0;
let peakTemp = 0;
let ticks = 0;
const maxTicks = SIM.tickRate * 60 * 45; // 45 minutes of match time

const log: string[] = [];

while (sim.state.match.winner === null && ticks < maxTicks) {
  const inputs: [ReturnType<SquashAI['think']>, ReturnType<SquashAI['think']>] = [
    ai[0].think(sim, SIM.tickDelta),
    ai[1].think(sim, SIM.tickDelta),
  ];
  const events: SimEvent[] = sim.step(inputs);
  ticks += 1;
  if (sim.state.ball.temperature > peakTemp) peakTemp = sim.state.ball.temperature;

  for (const event of events) {
    switch (event.type) {
      case 'racketHit':
        maxSpeed = Math.max(maxSpeed, event.speed * 3.6);
        break;
      case 'rallyEnd': {
        outcomes.set(event.outcome, (outcomes.get(event.outcome) ?? 0) + 1);
        shotCounts.push(event.shotCount);
        timeline.record(
          sim.state.time,
          sim.state.match.totalRallies,
          [sim.state.players[0].score, sim.state.players[1].score],
          sim.state.match.gameIndex,
          event.winner,
          event.shotCount,
          event.duration,
          event.outcome,
        );
        break;
      }
      case 'refereeCall':
        if (['Stroke', 'Yes let', 'No let', 'Let'].includes(event.call)) {
          log.push(`  REF  ${event.call} — ${event.detail}`);
        }
        break;
      case 'gameEnd':
        log.push(
          `  GAME ${names[event.winner]} takes game ${sim.state.match.gameIndex} ` +
            `${event.scores[0]}-${event.scores[1]} (${event.games[0]}-${event.games[1]})`,
        );
        break;
      case 'matchEnd':
        log.push(`  MATCH ${names[event.winner]} wins ${event.games[0]}-${event.games[1]}`);
        break;
      default:
        break;
    }
  }
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

console.log(`\n  ${names[0]}  vs  ${names[1]}   [${difficulty}]\n`);
console.log(log.slice(-14).join('\n'));
console.log(`
  ── Match report ────────────────────────────────
  Result            ${sim.state.match.winner === null ? 'unfinished' : names[sim.state.match.winner]} ${sim.state.match.games[0]}-${sim.state.match.games[1]}
  Games             ${sim.state.match.completedGames.map(([a, b]) => `${a}-${b}`).join(', ') || '—'}
  Match time        ${(sim.state.time / 60).toFixed(1)} min  (${ticks} ticks)
  Rallies           ${sim.state.match.totalRallies}
  Avg rally         ${avg(shotCounts).toFixed(1)} shots
  Longest rally     ${Math.max(0, ...shotCounts)} shots
  Fastest shot      ${maxSpeed.toFixed(0)} km/h
  Ball temperature  ${sim.state.ball.temperature.toFixed(1)} °C now, ${peakTemp.toFixed(1)} °C peak
  Distance covered  ${sim.state.players[0].distanceCovered.toFixed(0)} m / ${sim.state.players[1].distanceCovered.toFixed(0)} m
  Referee           ${sim.refereeName()}  (lets ${sim.referee.decisions.lets}, strokes ${sim.referee.decisions.strokes}, no lets ${sim.referee.decisions.noLets})

  Rally outcomes    ${[...outcomes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  ')}
  ─────────────────────────────────────────────────
`);

if (sim.state.match.winner === null) {
  console.error('  ⚠ match did not finish inside the tick budget');
  process.exit(1);
}
