import { COURT, PLAYER, RULES, receivingQuarter, serviceBox } from './constants';
import { clamp01, type Vec3 } from './math';
import type {
  BallState,
  MatchState,
  PlayerState,
  RallyOutcome,
  RallyState,
  ServeFaultKind,
  WorldState,
} from './types';

/**
 * Scoring, service and rally law, following the current WSF Rules of Squash
 * (point-a-rally to 11, best of five) as applied on the PSA World Tour.
 *
 * Two things trip people up and both are implemented here:
 *   • there is no second serve in squash — a fault loses the rally outright;
 *   • but if the receiver attempts to return a fault, the serve is deemed good.
 */

export const other = (p: 0 | 1): 0 | 1 => (p === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreResult {
  gameWon: boolean;
  matchWon: boolean;
}

/** Is this player one rally away from taking the game? */
export const isGameBall = (player: PlayerState, opponent: PlayerState): boolean => {
  const p = player.score;
  const o = opponent.score;
  if (p < RULES.pointsToWinGame - 1) return false;
  return p >= o + RULES.winByMargin - 1 && p >= RULES.pointsToWinGame - 1;
};

/** Is this player one rally away from the match? */
export const isMatchBall = (
  player: PlayerState,
  opponent: PlayerState,
  match: MatchState,
): boolean =>
  isGameBall(player, opponent) && match.games[player.index] === RULES.gamesToWinMatch - 1;

/** 10-10 and beyond: the game continues until someone leads by two. */
export const isTiebreak = (a: PlayerState, b: PlayerState): boolean =>
  a.score >= RULES.pointsToWinGame - 1 && b.score >= RULES.pointsToWinGame - 1;

const hasWonGame = (player: PlayerState, opponent: PlayerState): boolean =>
  player.score >= RULES.pointsToWinGame &&
  player.score - opponent.score >= RULES.winByMargin;

/**
 * Award the rally. Returns whether that closed out the game or the match.
 * Under PAR the winner of the rally always scores, whoever served.
 */
export const awardRally = (world: WorldState, winner: 0 | 1): ScoreResult => {
  const player = world.players[winner];
  const opponent = world.players[other(winner)];

  player.score += 1;
  world.match.totalRallies += 1;

  // Hand-out: the server changes only when the receiver wins the rally, and
  // the incoming server chooses their box. Winning on serve alternates boxes.
  if (world.rally.server === winner) {
    world.rally.serveSide = world.rally.serveSide === 1 ? -1 : 1;
  } else {
    world.rally.server = winner;
    world.rally.serveSideChosen = false;
  }

  if (!hasWonGame(player, opponent)) {
    return { gameWon: false, matchWon: false };
  }

  world.match.completedGames.push([world.players[0].score, world.players[1].score]);
  world.match.games[winner] += 1;
  player.gamesWon += 1;
  player.gameScores.push(player.score);
  opponent.gameScores.push(opponent.score);

  const matchWon = world.match.games[winner] >= RULES.gamesToWinMatch;
  if (matchWon) world.match.winner = winner;

  return { gameWon: true, matchWon };
};

/** Reset scores and per-game allowances for the next game. */
export const startNextGame = (world: WorldState): void => {
  world.match.gameIndex += 1;
  for (const p of world.players) {
    p.score = 0;
    p.reviewsRemaining = RULES.reviewsPerGame;
    // Players get a genuine breather between games.
    p.stamina = Math.min(PLAYER.maxStamina, p.stamina + 42);
  }
  // The winner of the previous game serves first in the next one.
  const lastGame = world.match.completedGames[world.match.completedGames.length - 1];
  if (lastGame) world.rally.server = lastGame[0] > lastGame[1] ? 0 : 1;
  world.rally.serveSideChosen = false;
  world.rally.rallyIndex = 0;
};

// ---------------------------------------------------------------------------
// Service law
// ---------------------------------------------------------------------------

export type ServeFault = ServeFaultKind;

export const SERVE_FAULT_TEXT: Record<ServeFault, string> = {
  footFault: 'Foot fault — no part of the foot inside the service box.',
  short: 'Fault — the serve did not reach above the service line.',
  outOnServe: 'Out — the serve struck the front wall on or above the out line.',
  downOnServe: 'Down — the serve found the tin.',
  wrongQuarter: 'Fault — the serve did not land in the correct quarter.',
  notStruck: 'Fault — the server failed to strike the ball.',
};

/**
 * At the moment of striking, at least one foot must be in contact with the
 * floor inside the service box and not touching any of its lines.
 */
export const checkFootPosition = (
  playerPos: Vec3,
  side: -1 | 1,
): boolean => {
  const box = serviceBox(side);
  // The player's stance straddles their centre; we allow the foot to be within
  // a stride of it, which is how a real service stance works.
  const footInset = 0.22;
  return (
    playerPos.x > box.minX + footInset - 0.45 &&
    playerPos.x < box.maxX - footInset + 0.45 &&
    playerPos.z > box.minZ + footInset - 0.3 &&
    playerPos.z < box.maxZ - footInset + 0.3 &&
    // At least part of the stance genuinely inside the box.
    playerPos.x > box.minX - 0.05 &&
    playerPos.x < box.maxX + 0.05 &&
    playerPos.z > box.minZ - 0.05 &&
    playerPos.z < box.maxZ + 0.05
  );
};

/** Did the serve strike the front wall in the legal band? */
export const checkServeFrontWall = (
  contactHeight: number,
  tinHeight: number,
): ServeFault | null => {
  if (contactHeight < tinHeight) return 'downOnServe';
  if (contactHeight <= COURT.serviceLineHeight) return 'short';
  if (contactHeight >= COURT.frontWallOutHeight) return 'outOnServe';
  return null;
};

/** Did the serve land in the quarter diagonally opposite the service box? */
export const checkServeLanding = (landing: Vec3, serveSide: -1 | 1): ServeFault | null => {
  const quarter = receivingQuarter(serveSide);
  const inside =
    landing.x >= quarter.minX &&
    landing.x <= quarter.maxX &&
    landing.z >= quarter.minZ &&
    landing.z <= quarter.maxZ;
  return inside ? null : 'wrongQuarter';
};

// ---------------------------------------------------------------------------
// Rally law
// ---------------------------------------------------------------------------

export interface RallyRuling {
  outcome: RallyOutcome;
  /** Who wins the rally. */
  winner: 0 | 1;
  /** Referee wording, spoken on court. */
  call: string;
  detail: string;
}

/**
 * Adjudicate a ball that has just gone dead.
 *
 * `striker` is whoever last touched it. Every one of these is a loss for the
 * striker except a clean winner, which is a loss for their opponent.
 */
export const ruleOnDeadBall = (
  reason: 'tin' | 'out' | 'doubleBounce' | 'floorBeforeFront',
  ball: BallState,
  rally: RallyState,
): RallyRuling | null => {
  const striker = ball.lastStriker;
  if (striker === null) return null;
  const opponent = other(striker);
  const serving = rally.serveInFlight;

  switch (reason) {
    case 'tin':
      return {
        outcome: 'down',
        winner: opponent,
        call: 'Down',
        detail: serving
          ? SERVE_FAULT_TEXT.downOnServe
          : 'The ball struck the tin.',
      };
    case 'out':
      return {
        outcome: 'out',
        winner: opponent,
        call: 'Out',
        detail: 'The ball struck on or above the out line.',
      };
    case 'floorBeforeFront':
      return {
        outcome: 'notUp',
        winner: opponent,
        call: 'Not up',
        detail: 'The ball failed to reach the front wall.',
      };
    case 'doubleBounce':
      return {
        outcome: 'doubleBounce',
        winner: striker,
        call: 'Not up',
        detail: 'The ball bounced twice before the return.',
      };
  }
};

/**
 * The ball hit a player. Rule 8.9 and 9.5 of the WSF rules:
 *
 *   • struck opponent, ball was going to the front wall and would have been a
 *     good return → stroke to the striker;
 *   • struck opponent but the return would not have been good → striker loses;
 *   • ball had already hit the front wall → let, unless it was going down.
 */
export const ruleOnBodyContact = (
  striker: 0 | 1,
  struck: 0 | 1,
  ball: BallState,
  wouldHaveBeenGood: boolean,
  strikerTurned: boolean,
): RallyRuling => {
  if (striker === struck) {
    return {
      outcome: 'notUp',
      winner: other(striker),
      call: 'Not up',
      detail: 'The striker was hit by their own return.',
    };
  }

  if (ball.hitFrontWall) {
    return {
      outcome: 'let',
      winner: striker,
      call: 'Let',
      detail: 'The ball struck the opponent after reaching the front wall. Let ball.',
    };
  }

  if (!wouldHaveBeenGood) {
    return {
      outcome: 'notUp',
      winner: struck,
      call: 'Not up',
      detail: 'The return would not have been good.',
    };
  }

  if (strikerTurned) {
    return {
      outcome: 'let',
      winner: striker,
      call: 'Let',
      detail: 'The striker had turned. Let ball.',
    };
  }

  return {
    outcome: 'stroke',
    winner: striker,
    call: 'Stroke',
    detail: 'The ball struck the opponent on its way to the front wall. Stroke to the striker.',
  };
};

/**
 * Would the striker's attempted return have been good?
 *
 * A ball taken below tin height on the full stretch in the back corner is not
 * getting to the front wall; a ball in the slot at chest height is.
 */
export const estimateReturnQuality = (
  contact: Vec3,
  strikerPos: Vec3,
  ballSpeed: number,
): number => {
  const heightTerm = clamp01((contact.y - 0.12) / 1.1);
  const distanceTerm = 1 - clamp01(Math.hypot(contact.x - strikerPos.x, contact.z - strikerPos.z) / (PLAYER.reach + PLAYER.lungeReach));
  const paceTerm = 1 - clamp01(ballSpeed / 70) * 0.35;
  return clamp01(heightTerm * 0.42 + distanceTerm * 0.42 + paceTerm * 0.16);
};

// ---------------------------------------------------------------------------
// Match structure helpers
// ---------------------------------------------------------------------------

export const scoreLine = (world: WorldState): string => {
  const [a, b] = world.players;
  const server = world.rally.server;
  const serverScore = world.players[server].score;
  const receiverScore = world.players[other(server)].score;

  if (serverScore === receiverScore) {
    if (serverScore === RULES.pointsToWinGame - 1) return `${serverScore}-all`;
    return `${serverScore}-all`;
  }
  // Squash convention: the server's score is called first.
  void a;
  void b;
  return `${serverScore}-${receiverScore}`;
};

/**
 * The referee's spoken score, which includes the game situation. This is
 * verbatim the phrasing used on the World Tour.
 */
export const spokenScore = (world: WorldState, names: [string, string]): string => {
  const server = world.rally.server;
  const receiver = other(server);
  const s = world.players[server];
  const r = world.players[receiver];

  if (s.score === r.score && s.score === RULES.pointsToWinGame - 1) {
    return `${s.score}-all. A player must win by two points.`;
  }
  if (isMatchBall(s, r, world.match)) return `${s.score}-${r.score}, match ball ${names[server]}`;
  if (isGameBall(s, r)) return `${s.score}-${r.score}, game ball ${names[server]}`;
  if (isMatchBall(r, s, world.match)) return `${s.score}-${r.score}, match ball ${names[receiver]}`;
  if (isGameBall(r, s)) return `${s.score}-${r.score}, game ball ${names[receiver]}`;
  if (s.score === r.score) return `${s.score}-all`;
  return `${s.score}-${r.score}`;
};

export const gameSummary = (match: MatchState): string =>
  match.completedGames.map(([a, b]) => `${a}-${b}`).join(', ');

/** Seconds allowed before the referee starts calling time. */
export const intervalFor = (rally: RallyState): number =>
  rally.phase === 'betweenGames' ? RULES.betweenGamesSeconds : RULES.betweenRalliesSeconds;
