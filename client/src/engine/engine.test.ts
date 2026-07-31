import { describe, expect, it } from 'vitest';

import { BALL, COURT, RULES, receivingQuarter, serviceBox, sideWallOutHeight } from './constants';
import { corForTemperature, createBall, markStruck, predictInterception, stepBall } from './ball';
import { decideInterference, emptyObservation, severityOf } from './interference';
import { applyConduct, createRefereeState, requestReview, ruleOnAppeal } from './referee';
import {
  awardRally,
  checkFootPosition,
  checkServeFrontWall,
  checkServeLanding,
  isGameBall,
  other,
} from './rules';
import { Rng, hashString } from './math';
import { Simulation } from './world';
import { SquashAI } from './ai';
import { emptyInput, type SimEvent, type WorldState } from './types';
import { MatchTimeline, ReplayRecorder, sampleClip } from './replay';
import { SIM } from './constants';

// ---------------------------------------------------------------------------
// Court geometry
// ---------------------------------------------------------------------------

describe('court geometry', () => {
  it('matches the WSF singles specification', () => {
    expect(COURT.length).toBe(9.75);
    expect(COURT.width).toBe(6.4);
    expect(COURT.frontWallOutHeight).toBe(4.57);
    expect(COURT.backWallOutHeight).toBe(2.13);
    expect(COURT.serviceLineHeight).toBe(1.78);
    expect(COURT.shortLine).toBe(5.485);
    // The World Tour tin is lower than the recreational standard.
    expect(COURT.tinHeightTour).toBeLessThan(COURT.tinHeightStandard);
  });

  it('slopes the side wall out line from the front line to the back line', () => {
    expect(sideWallOutHeight(0)).toBeCloseTo(COURT.frontWallOutHeight, 5);
    expect(sideWallOutHeight(COURT.length)).toBeCloseTo(COURT.backWallOutHeight, 5);
    // Monotonically decreasing towards the back.
    expect(sideWallOutHeight(3)).toBeGreaterThan(sideWallOutHeight(7));
  });

  it('places the service boxes in the front court against the side walls', () => {
    const right = serviceBox(1);
    expect(right.maxX).toBeCloseTo(COURT.halfWidth, 5);
    expect(right.maxX - right.minX).toBeCloseTo(COURT.serviceBoxSize, 5);
    expect(right.minZ).toBeCloseTo(COURT.shortLine, 5);

    const left = serviceBox(-1);
    expect(left.minX).toBeCloseTo(-COURT.halfWidth, 5);
  });

  it('requires a serve to land diagonally opposite the box it came from', () => {
    // Serving from the right box means the ball must land in the back-left.
    const quarter = receivingQuarter(1);
    expect(quarter.minX).toBeCloseTo(-COURT.halfWidth, 5);
    expect(quarter.maxX).toBeCloseTo(0, 5);
    expect(quarter.minZ).toBeCloseTo(COURT.shortLine, 5);
  });
});

// ---------------------------------------------------------------------------
// Ball physics
// ---------------------------------------------------------------------------

describe('ball physics', () => {
  it('gets livelier as the rubber warms up', () => {
    const cold = corForTemperature(BALL.tempCold);
    const hot = corForTemperature(BALL.tempHot);
    expect(cold).toBeCloseTo(BALL.corCold, 3);
    expect(hot).toBeCloseTo(BALL.corHot, 3);
    expect(hot).toBeGreaterThan(cold * 1.4);
  });

  it('keeps the ball inside the court even at extreme speed', () => {
    const ball = createBall();
    ball.pos = { x: 0, y: 1.2, z: 8 };
    // 90 m/s is faster than any shot in the game; nothing may tunnel.
    ball.vel = { x: -55, y: -30, z: -70 };
    ball.live = true;
    markStruck(ball, 0);

    const events: SimEvent[] = [];
    for (let i = 0; i < 600; i++) {
      stepBall(ball, SIM.tickDelta, COURT.tinHeightTour, events);
      expect(ball.pos.y).toBeGreaterThanOrEqual(BALL.radius - 1e-6);
      expect(ball.pos.z).toBeGreaterThanOrEqual(BALL.radius - 1e-6);
      expect(ball.pos.z).toBeLessThanOrEqual(COURT.length - BALL.radius + 1e-6);
      expect(Math.abs(ball.pos.x)).toBeLessThanOrEqual(COURT.halfWidth - BALL.radius + 1e-6);
    }
  });

  it('never leaves the ball below the floor after a bounce', () => {
    const ball = createBall();
    ball.pos = { x: 0, y: 0.03, z: 5 };
    ball.vel = { x: 2, y: -0.15, z: 1 };
    ball.live = true;
    markStruck(ball, 0);
    const events: SimEvent[] = [];
    for (let i = 0; i < 400; i++) {
      stepBall(ball, SIM.tickDelta, COURT.tinHeightTour, events);
      expect(ball.pos.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('reports a ball struck above the front wall out line as out', () => {
    const ball = createBall();
    ball.pos = { x: 0, y: 4.3, z: 2 };
    ball.vel = { x: 0, y: 6, z: -25 };
    ball.live = true;
    markStruck(ball, 0);

    const events: SimEvent[] = [];
    let outcome: string | null = null;
    for (let i = 0; i < 120 && !outcome; i++) {
      outcome = stepBall(ball, SIM.tickDelta, COURT.tinHeightTour, events);
    }
    expect(outcome).toBe('out');
    expect(events.some((e) => e.type === 'ballOut')).toBe(true);
  });

  it('reports a ball into the board as down', () => {
    const ball = createBall();
    ball.pos = { x: 0, y: 0.35, z: 2 };
    ball.vel = { x: 0, y: -0.5, z: -28 };
    ball.live = true;
    markStruck(ball, 0);

    const events: SimEvent[] = [];
    let outcome: string | null = null;
    for (let i = 0; i < 120 && !outcome; i++) {
      outcome = stepBall(ball, SIM.tickDelta, COURT.tinHeightTour, events);
    }
    expect(outcome).toBe('tin');
  });

  it('finds a playable contact point even for a ball that never bounces high', () => {
    // A dying drop: after the bounce it barely leaves the floor, so an
    // interception search for a fixed knee height would find nothing at all.
    const ball = createBall();
    ball.pos = { x: 2.4, y: 0.55, z: 0.9 };
    ball.vel = { x: 0.4, y: -1.2, z: 1.6 };
    ball.live = true;
    ball.hitFrontWall = true;
    markStruck(ball, 0);

    const interception = predictInterception(ball, 0.92, COURT.tinHeightTour, 2.4);
    expect(interception.reachable).toBe(true);
    expect(interception.bounce).not.toBeNull();
    expect(interception.time).toBeGreaterThan(0);
    expect(interception.deadline).toBeGreaterThan(interception.time);
  });
});

// ---------------------------------------------------------------------------
// Service law
// ---------------------------------------------------------------------------

describe('service law', () => {
  it('faults a serve that does not reach above the cut line', () => {
    expect(checkServeFrontWall(COURT.serviceLineHeight - 0.1, COURT.tinHeightTour)).toBe('short');
    expect(checkServeFrontWall(COURT.serviceLineHeight + 0.5, COURT.tinHeightTour)).toBeNull();
  });

  it('calls a serve above the out line out, and one below the tin down', () => {
    expect(checkServeFrontWall(COURT.frontWallOutHeight + 0.1, COURT.tinHeightTour)).toBe('outOnServe');
    expect(checkServeFrontWall(0.2, COURT.tinHeightTour)).toBe('downOnServe');
  });

  it('requires the serve to land in the opposite quarter', () => {
    // Serving from the right box: the back-left quarter is good.
    expect(checkServeLanding({ x: -1.5, y: 0, z: 7 }, 1)).toBeNull();
    // Same side is a fault.
    expect(checkServeLanding({ x: 1.5, y: 0, z: 7 }, 1)).toBe('wrongQuarter');
    // In front of the short line is a fault.
    expect(checkServeLanding({ x: -1.5, y: 0, z: 3 }, 1)).toBe('wrongQuarter');
  });

  it('requires a foot in the service box', () => {
    const box = serviceBox(1);
    const inside = { x: (box.minX + box.maxX) / 2, y: 0, z: (box.minZ + box.maxZ) / 2 };
    expect(checkFootPosition(inside, 1)).toBe(true);
    // Standing in the other box is a foot fault.
    expect(checkFootPosition({ x: -2.4, y: 0, z: 6.2 }, 1)).toBe(false);
    // Standing behind the back of the box is a foot fault.
    expect(checkFootPosition({ x: 2.4, y: 0, z: 8.6 }, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const makeWorld = (): Simulation =>
  new Simulation({ seed: 'scoring', characters: ['farag', 'elias'], warmBall: true });

describe('point-a-rally scoring', () => {
  it('awards a point to the winner of the rally whoever served', () => {
    const sim = makeWorld();
    sim.state.rally.server = 0;
    // The receiver wins: under PAR they score, and they take over the serve.
    awardRally(sim.state, 1);
    expect(sim.state.players[1].score).toBe(1);
    expect(sim.state.rally.server).toBe(1);
  });

  it('alternates the service box when the server wins', () => {
    const sim = makeWorld();
    sim.state.rally.server = 0;
    sim.state.rally.serveSide = 1;
    awardRally(sim.state, 0);
    expect(sim.state.rally.serveSide).toBe(-1);
    awardRally(sim.state, 0);
    expect(sim.state.rally.serveSide).toBe(1);
  });

  it('needs 11 points to take a game', () => {
    const sim = makeWorld();
    for (let i = 0; i < 10; i++) awardRally(sim.state, 0);
    expect(sim.state.match.games[0]).toBe(0);
    const result = awardRally(sim.state, 0);
    expect(result.gameWon).toBe(true);
    expect(sim.state.match.games[0]).toBe(1);
  });

  it('requires a two-point margin from 10-all', () => {
    const sim = makeWorld();
    for (let i = 0; i < 10; i++) {
      awardRally(sim.state, 0);
      awardRally(sim.state, 1);
    }
    expect(sim.state.players[0].score).toBe(10);
    expect(sim.state.players[1].score).toBe(10);

    // 11-10 does not win it.
    expect(awardRally(sim.state, 0).gameWon).toBe(false);
    // 12-10 does.
    expect(awardRally(sim.state, 0).gameWon).toBe(true);
    expect(sim.state.match.completedGames[0]).toEqual([12, 10]);
  });

  it('takes three games to win the match', () => {
    const sim = makeWorld();
    const winGame = (player: 0 | 1) => {
      let result = { gameWon: false, matchWon: false };
      while (!result.gameWon) result = awardRally(sim.state, player);
      return result;
    };
    expect(winGame(0).matchWon).toBe(false);
    expect(winGame(0).matchWon).toBe(false);
    expect(winGame(0).matchWon).toBe(true);
    expect(sim.state.match.winner).toBe(0);
    expect(sim.state.match.games).toEqual([3, 0]);
  });

  it('recognises game ball', () => {
    const sim = makeWorld();
    for (let i = 0; i < 10; i++) awardRally(sim.state, 0);
    expect(isGameBall(sim.state.players[0], sim.state.players[1])).toBe(true);
    expect(isGameBall(sim.state.players[1], sim.state.players[0])).toBe(false);
  });

  it('flips player indices correctly', () => {
    expect(other(0)).toBe(1);
    expect(other(1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Interference
// ---------------------------------------------------------------------------

describe('interference decisions', () => {
  it('gives no let when the return would not have been good', () => {
    const o = emptyObservation();
    o.accessBlocked = 1;
    o.returnQuality = 0.05;
    const decision = decideInterference(o);
    expect(decision.decision).toBe('noLet');
    expect(decision.rule).toBe('WSF 8.6.1');
  });

  it('gives no let when the striker made no effort', () => {
    const o = emptyObservation();
    o.accessBlocked = 1;
    o.returnQuality = 0.8;
    o.strikerEffort = 0.05;
    expect(decideInterference(o).rule).toBe('WSF 8.6.3');
  });

  it('gives no let for minimal interference', () => {
    const o = emptyObservation();
    o.accessBlocked = 0.05;
    o.returnQuality = 0.8;
    const decision = decideInterference(o);
    expect(decision.decision).toBe('noLet');
    expect(decision.rule).toBe('WSF 8.6.2');
  });

  it('gives a stroke when the line to the front wall is blocked', () => {
    const o = emptyObservation();
    o.returnQuality = 0.8;
    o.lineBlocked = 0.9;
    const decision = decideInterference(o);
    expect(decision.decision).toBe('stroke');
    expect(decision.rule).toBe('WSF 8.8.3');
  });

  it('gives a stroke when the opponent did not make every effort to clear', () => {
    const o = emptyObservation();
    o.returnQuality = 0.8;
    o.accessBlocked = 0.85;
    o.opponentClearing = 0.05;
    const decision = decideInterference(o);
    expect(decision.decision).toBe('stroke');
    expect(decision.rule).toBe('WSF 8.8.1');
  });

  it('gives a let for genuine interference when both players did their part', () => {
    const o = emptyObservation();
    o.returnQuality = 0.7;
    o.accessBlocked = 0.75;
    o.opponentClearing = 0.9;
    o.strikerEffort = 0.9;
    o.winningOpportunity = 0.2;
    const decision = decideInterference(o);
    expect(decision.decision).toBe('let');
    expect(decision.rule).toBe('WSF 8.7');
  });

  it('is stricter about strokes when the referee is strict', () => {
    const o = emptyObservation();
    o.returnQuality = 0.8;
    o.accessBlocked = 0.3;
    o.opponentClearing = 0.9;
    o.strikerEffort = 0.9;
    const lenient = decideInterference(o, 0.0);
    const strict = decideInterference(o, 1.0);
    // The same marginal incident is a let for one referee and no let for the other.
    expect(lenient.decision).toBe('let');
    expect(strict.decision).toBe('noLet');
  });

  it('rates severity higher when more entitlements are denied', () => {
    const mild = emptyObservation();
    mild.accessBlocked = 0.2;
    const severe = emptyObservation();
    severe.accessBlocked = 0.9;
    severe.swingImpeded = 0.8;
    expect(severityOf(severe)).toBeGreaterThan(severityOf(mild));
  });
});

// ---------------------------------------------------------------------------
// Referee and video review
// ---------------------------------------------------------------------------

describe('referee', () => {
  it('overturns a call on review when the referee misread it', () => {
    const state = createRefereeState('central');
    const rng = new Rng(7);
    const o = emptyObservation();
    o.returnQuality = 0.8;
    o.accessBlocked = 0.7;
    o.opponentClearing = 0.85;
    o.strikerEffort = 0.9;

    const ruling = ruleOnAppeal(state, o, 0, rng);
    // Force the mismatch so we exercise the review path deterministically.
    const forced = { ...ruling, wouldBeOverturned: true };
    const result = requestReview(state, forced, 0);
    expect(result.granted).toBe(true);
    expect(result.overturned).toBe(true);
    // A successful review is retained.
    expect(result.reviewsRemaining).toBe(RULES.reviewsPerGame);
  });

  it('spends the review when the call stands', () => {
    const state = createRefereeState('central');
    const rng = new Rng(11);
    const o = emptyObservation();
    o.returnQuality = 0.8;
    const ruling = ruleOnAppeal(state, o, 1, rng);
    const forced = { ...ruling, wouldBeOverturned: false };
    const result = requestReview(state, forced, 1);
    expect(result.overturned).toBe(false);
    expect(result.reviewsRemaining).toBe(RULES.reviewsPerGame - 1);

    // And a second review in the same game is refused.
    const second = requestReview(state, forced, 1);
    expect(second.granted).toBe(false);
  });

  it('escalates the conduct ladder on repeat offences', () => {
    const state = createRefereeState('central');
    expect(applyConduct(state, 0, 'dissent', 'Farag').penalty).toBe('warning');
    expect(applyConduct(state, 0, 'dissent', 'Farag').penalty).toBe('stroke');
    expect(applyConduct(state, 0, 'dissent', 'Farag').penalty).toBe('game');
    expect(applyConduct(state, 0, 'dissent', 'Farag').penalty).toBe('match');
  });

  it('skips the warning for dangerous play', () => {
    const state = createRefereeState('central');
    const ruling = applyConduct(state, 1, 'dangerousPlay', 'Elias');
    expect(ruling.penalty).toBe('stroke');
    expect(ruling.awardsRally).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  const playMatch = (seed: string, ticks: number): WorldState => {
    const sim = new Simulation({ seed, characters: ['asal', 'coll'], warmBall: true });
    const ai = [
      new SquashAI(0, sim.characters[0], 'pro', hashString(`${seed}-a`)),
      new SquashAI(1, sim.characters[1], 'pro', hashString(`${seed}-b`)),
    ];
    for (let i = 0; i < ticks; i++) {
      sim.step([ai[0].think(sim, SIM.tickDelta), ai[1].think(sim, SIM.tickDelta)]);
    }
    return sim.snapshot();
  };

  it('produces identical states from an identical seed', () => {
    const a = playMatch('same-seed', 4000);
    const b = playMatch('same-seed', 4000);
    expect(a.ball.pos).toEqual(b.ball.pos);
    expect(a.players[0].pos).toEqual(b.players[0].pos);
    expect([a.players[0].score, a.players[1].score]).toEqual([
      b.players[0].score,
      b.players[1].score,
    ]);
    expect(a.rngState).toBe(b.rngState);
  });

  it('produces different matches from different seeds', () => {
    const a = playMatch('seed-one', 4000);
    const b = playMatch('seed-two', 4000);
    expect(a.ball.pos).not.toEqual(b.ball.pos);
  });

  it('hashes seed strings stably', () => {
    expect(hashString('psa')).toBe(hashString('psa'));
    expect(hashString('psa')).not.toBe(hashString('wsf'));
  });
});

// ---------------------------------------------------------------------------
// Whole-match behaviour
// ---------------------------------------------------------------------------

describe('a full simulated match', () => {
  it('plays out to a legal result with squash-shaped statistics', () => {
    const sim = new Simulation({ seed: 'stats', characters: ['sherbini', 'gohar'], warmBall: true });
    const ai = [
      new SquashAI(0, sim.characters[0], 'pro', 5),
      new SquashAI(1, sim.characters[1], 'pro', 6),
    ];

    const shotCounts: number[] = [];
    const outcomes: string[] = [];
    let peakSpeedKmh = 0;
    let ticks = 0;

    while (sim.state.match.winner === null && ticks < SIM.tickRate * 60 * 60) {
      const events = sim.step([
        ai[0].think(sim, SIM.tickDelta),
        ai[1].think(sim, SIM.tickDelta),
      ]);
      ticks += 1;
      for (const e of events) {
        if (e.type === 'racketHit') peakSpeedKmh = Math.max(peakSpeedKmh, e.speed * 3.6);
        if (e.type === 'rallyEnd') {
          shotCounts.push(e.shotCount);
          outcomes.push(e.outcome);
        }
      }
    }

    // The match finished, and by a legal margin.
    expect(sim.state.match.winner).not.toBeNull();
    const winner = sim.state.match.winner as 0 | 1;
    expect(sim.state.match.games[winner]).toBe(RULES.gamesToWinMatch);
    expect(sim.state.match.completedGames.length).toBeLessThanOrEqual(RULES.maxGames);

    for (const [a, b] of sim.state.match.completedGames) {
      const high = Math.max(a, b);
      const low = Math.min(a, b);
      expect(high).toBeGreaterThanOrEqual(RULES.pointsToWinGame);
      expect(high - low).toBeGreaterThanOrEqual(RULES.winByMargin);
    }

    // Rallies are actual rallies, not one-shot exchanges.
    const avgShots = shotCounts.reduce((s, n) => s + n, 0) / shotCounts.length;
    expect(avgShots).toBeGreaterThan(3);
    expect(Math.max(...shotCounts)).toBeGreaterThan(10);

    // Professionals hit hard, and the ball warms up in play.
    expect(peakSpeedKmh).toBeGreaterThan(140);
    expect(peakSpeedKmh).toBeLessThan(300);

    // Both winners and errors occur — a match of pure winners is not squash.
    expect(outcomes.filter((o) => o === 'doubleBounce').length).toBeGreaterThan(0);
    expect(outcomes.filter((o) => o === 'down' || o === 'out').length).toBeGreaterThan(0);
  }, 60_000);

  it('warms the ball up in play and lets it cool afterwards', () => {
    const sim = new Simulation({ seed: 'temp', characters: ['momen', 'makin'] });
    const ai = [
      new SquashAI(0, sim.characters[0], 'pro', 3),
      new SquashAI(1, sim.characters[1], 'pro', 4),
    ];
    const start = sim.state.ball.temperature;
    let peak = start;
    for (let i = 0; i < SIM.tickRate * 240; i++) {
      sim.step([ai[0].think(sim, SIM.tickDelta), ai[1].think(sim, SIM.tickDelta)]);
      peak = Math.max(peak, sim.state.ball.temperature);
    }
    expect(peak).toBeGreaterThan(start + 8);
    expect(peak).toBeLessThanOrEqual(BALL.tempMax);
  }, 40_000);
});

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

describe('replay recorder', () => {
  it('records a rally and samples it smoothly between frames', () => {
    const sim = new Simulation({ seed: 'replay', characters: ['ashour', 'david'], warmBall: true });
    const ai = [
      new SquashAI(0, sim.characters[0], 'pro', 8),
      new SquashAI(1, sim.characters[1], 'pro', 9),
    ];
    const recorder = new ReplayRecorder(10);

    for (let i = 0; i < SIM.tickRate * 30; i++) {
      const events = sim.step([
        ai[0].think(sim, SIM.tickDelta),
        ai[1].think(sim, SIM.tickDelta),
      ]);
      recorder.record(sim.snapshot(), events);
    }

    const clip = recorder.lastRally();
    expect(clip).not.toBeNull();
    if (!clip) return;
    expect(clip.frames.length).toBeGreaterThan(1);
    expect(clip.duration).toBeGreaterThan(0);

    // Sampling halfway lands strictly inside the clip.
    const mid = sampleClip(clip, clip.startTime + clip.duration / 2);
    expect(mid.t).toBeGreaterThan(0);
    expect(mid.t).toBeLessThan(1);

    // Clamps rather than throwing outside the range.
    expect(sampleClip(clip, clip.startTime - 5).t).toBe(0);
    expect(sampleClip(clip, clip.endTime + 5).t).toBe(1);
  }, 30_000);

  it('never keeps more frames than its capacity', () => {
    const recorder = new ReplayRecorder(1); // 60 frames
    const sim = new Simulation({ seed: 'cap', characters: ['farag', 'elias'] });
    for (let i = 0; i < 500; i++) recorder.record(sim.snapshot(), []);
    expect(recorder.length).toBeLessThanOrEqual(SIM.tickRate + 1);
  });
});

describe('match timeline', () => {
  it('swings momentum towards whoever is winning rallies', () => {
    const timeline = new MatchTimeline();
    for (let i = 0; i < 6; i++) {
      timeline.record(i * 30, i, [i + 1, 0], 0, 0, 20, 30, 'doubleBounce');
    }
    expect(timeline.current()).toBeGreaterThan(0.3);

    for (let i = 0; i < 8; i++) {
      timeline.record(200 + i * 30, 6 + i, [6, i + 1], 0, 1, 20, 30, 'doubleBounce');
    }
    expect(timeline.current()).toBeLessThan(0);
  });

  it('tracks streaks and the longest rally', () => {
    const timeline = new MatchTimeline();
    timeline.record(0, 0, [1, 0], 0, 0, 5, 8, 'down');
    timeline.record(30, 1, [1, 1], 0, 1, 42, 70, 'doubleBounce');
    timeline.record(60, 2, [1, 2], 0, 1, 9, 12, 'out');

    expect(timeline.longestRally()?.shots).toBe(42);
    expect(timeline.currentStreak()).toEqual({ player: 1, count: 2 });
    expect(timeline.averageRallyLength()).toBeCloseTo((5 + 42 + 9) / 3, 5);
  });
});

// ---------------------------------------------------------------------------
// Input plumbing
// ---------------------------------------------------------------------------

describe('inputs', () => {
  it('starts neutral', () => {
    const input = emptyInput();
    expect(input.moveX).toBe(0);
    expect(input.swingPressed).toBe(false);
    expect(input.appeal).toBe(false);
  });
});
