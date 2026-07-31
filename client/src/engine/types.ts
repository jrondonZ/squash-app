import type { Vec3 } from './math';
import type { ConductPenalty } from './constants';

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Angular velocity in rad/s. Drives Magnus curve and post-bounce kick. */
  spin: Vec3;
  /** Rubber temperature in °C. Governs the coefficient of restitution. */
  temperature: number;
  /** Floor bounces since the last racket contact. Two means the rally is over. */
  floorBounces: number;
  /** True once the ball has reached the front wall since the last strike. */
  hitFrontWall: boolean;
  /** Walls touched since the last strike, in order — used to name the shot. */
  wallsSinceStrike: WallId[];
  /** Player index of the last person to strike the ball, or null before a serve. */
  lastStriker: 0 | 1 | null;
  /** Set once the ball is dead so the renderer can let it roll out. */
  live: boolean;
}

export type WallId = 'front' | 'back' | 'left' | 'right' | 'floor' | 'ceiling' | 'tin';

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export type ShotType =
  | 'drive'
  | 'crossCourt'
  | 'drop'
  | 'lob'
  | 'boast'
  | 'volley'
  | 'kill'
  | 'nick'
  | 'serve'
  | 'flick';

export type SwingPhase = 'idle' | 'backswing' | 'contact' | 'recovery';

export interface SwingState {
  phase: SwingPhase;
  /** Seconds elapsed inside the current phase. */
  elapsed: number;
  type: ShotType;
  /** Lateral aim, -1 hard left to +1 hard right. */
  aimX: number;
  /** Height aim, -1 low (kill) to +1 high (lob). */
  aimY: number;
  /** 0–1 power commitment, from how long the swing button was held. */
  power: number;
  /** True when the player committed to a lunge with this shot. */
  lunging: boolean;
  /** Forehand or backhand, resolved at swing start from the ball's side. */
  side: 'forehand' | 'backhand';
}

export interface PlayerState {
  index: 0 | 1;
  characterId: string;
  pos: Vec3;
  vel: Vec3;
  /** Facing direction in radians, 0 = looking at the front wall. */
  facing: number;
  swing: SwingState;
  stamina: number;
  /** Counts down while the player is off balance after a stretched retrieval. */
  offBalance: number;
  /** Seconds until the player can swing again. */
  swingCooldown: number;
  score: number;
  gamesWon: number;
  /** Points won in each completed game, for the scoreboard. */
  gameScores: number[];
  /** Conduct penalties accrued this match. */
  conductRecord: ConductPenalty[];
  /** Video reviews left this game. */
  reviewsRemaining: number;
  /** Set while the player is holding the ball to serve. */
  hasBall: boolean;
  /** Distance covered this match, in metres — a real broadcast statistic. */
  distanceCovered: number;
}

// ---------------------------------------------------------------------------
// Rally / match
// ---------------------------------------------------------------------------

export type RallyPhase =
  | 'warmup'
  | 'preServe'
  | 'serving'
  | 'inPlay'
  | 'rallyOver'
  | 'appealing'
  | 'review'
  | 'betweenGames'
  | 'matchOver';

/** Why the last rally ended. Drives the referee call and the commentary. */
export type RallyOutcome =
  | 'winner'
  | 'notUp'
  | 'down'
  | 'out'
  | 'doubleBounce'
  | 'fault'
  | 'footFault'
  | 'let'
  | 'stroke'
  | 'noLet'
  | 'conduct'
  | 'carry'
  | 'hitOpponent';

export interface RallyState {
  phase: RallyPhase;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  /** Player index due to serve. */
  server: 0 | 1;
  /** Which box the server is serving from. */
  serveSide: -1 | 1;
  /** Set on the very first serve of a game, before a side has been chosen. */
  serveSideChosen: boolean;
  /** Shots played in the current rally, both players combined. */
  shotCount: number;
  /** Seconds the current rally has been live. */
  duration: number;
  outcome: RallyOutcome | null;
  /** Player index who won the last rally. */
  winner: 0 | 1 | null;
  /** Rally number within the current game. */
  rallyIndex: number;
  /** Set when a player has appealed and the referee has yet to rule. */
  appeal: AppealState | null;
  /** True while a serve is still the shot in flight (used for fault checks). */
  serveInFlight: boolean;
  /**
   * A fault the referee has spotted but not yet called. Under WSF 6.8 the
   * receiver may attempt to return a fault service, and if they do the service
   * is deemed good — so the call is held until the receiver's chance is gone.
   */
  pendingFault: ServeFaultKind | null;
}

export type ServeFaultKind =
  | 'footFault'
  | 'short'
  | 'outOnServe'
  | 'downOnServe'
  | 'wrongQuarter'
  | 'notStruck';

export interface AppealState {
  /** Who appealed. */
  by: 0 | 1;
  /** What they appealed against. */
  kind: 'interference' | 'ballOut' | 'doubleBounce' | 'notUp';
  /** Referee ruling, null until decided. */
  decision: RallyOutcome | null;
  /** Set once a player escalates to video review. */
  underReview: boolean;
  /** Whether the review overturned the on-court call. */
  reviewOverturned: boolean | null;
}

export interface MatchState {
  gameIndex: number;
  /** Games won, indexed by player. */
  games: [number, number];
  /** Completed game scores, e.g. [[11, 8], [9, 11]]. */
  completedGames: Array<[number, number]>;
  /** Seconds of elapsed match time. */
  elapsed: number;
  winner: 0 | 1 | null;
  /** Tin height in use — the tour tin is lower. */
  tinHeight: number;
  /** Total rallies played this match. */
  totalRallies: number;
}

export interface WorldState {
  tick: number;
  time: number;
  ball: BallState;
  players: [PlayerState, PlayerState];
  rally: RallyState;
  match: MatchState;
  rngState: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface PlayerInput {
  /** Desired movement direction, each axis in [-1, 1]. */
  moveX: number;
  moveZ: number;
  /** True while the swing button is held — hold time becomes power. */
  swingHeld: boolean;
  /** Rising edge of the swing button. */
  swingPressed: boolean;
  /** Selected shot shape. */
  shot: ShotType;
  /** Aim, each axis in [-1, 1]. */
  aimX: number;
  aimY: number;
  lunge: boolean;
  /** "Let please" — raises an appeal to the referee. */
  appeal: boolean;
  /** Escalates a referee decision to video review. */
  review: boolean;
  /** Serve release. */
  serve: boolean;
}

export const emptyInput = (): PlayerInput => ({
  moveX: 0,
  moveZ: 0,
  swingHeld: false,
  swingPressed: false,
  shot: 'drive',
  aimX: 0,
  aimY: 0,
  lunge: false,
  appeal: false,
  review: false,
  serve: false,
});

// ---------------------------------------------------------------------------
// Events — the bus the referee, commentary, audio and UI all listen to
// ---------------------------------------------------------------------------

export type SimEvent =
  | { type: 'ballWall'; wall: WallId; pos: Vec3; speed: number; nick: boolean }
  | { type: 'ballFloor'; pos: Vec3; speed: number; bounceIndex: number }
  | { type: 'ballTin'; pos: Vec3; speed: number }
  | { type: 'ballOut'; wall: WallId; pos: Vec3 }
  | { type: 'racketHit'; player: 0 | 1; shot: ShotType; quality: number; speed: number; pos: Vec3 }
  | { type: 'swingMiss'; player: 0 | 1 }
  | { type: 'hitOpponent'; striker: 0 | 1; struck: 0 | 1; pos: Vec3; wouldHaveBeenGood: boolean }
  | { type: 'interference'; appellant: 0 | 1; severity: number; blockedLine: boolean }
  | { type: 'serve'; player: 0 | 1; side: -1 | 1; legal: boolean; reason?: string }
  | { type: 'rallyStart'; server: 0 | 1 }
  | {
      type: 'rallyEnd';
      winner: 0 | 1;
      outcome: RallyOutcome;
      shotCount: number;
      duration: number;
      shot: ShotType | null;
    }
  | { type: 'point'; player: 0 | 1; scores: [number, number] }
  | { type: 'gameEnd'; winner: 0 | 1; scores: [number, number]; games: [number, number] }
  | { type: 'matchEnd'; winner: 0 | 1; games: [number, number] }
  | { type: 'refereeCall'; call: string; detail: string; decision: RallyOutcome | null }
  | { type: 'appeal'; player: 0 | 1; kind: AppealState['kind'] }
  | { type: 'reviewStart'; player: 0 | 1 }
  | { type: 'reviewEnd'; player: 0 | 1; overturned: boolean }
  | { type: 'conduct'; player: 0 | 1; penalty: ConductPenalty; reason: string }
  | { type: 'gameBallPoint'; player: 0 | 1; kind: 'game' | 'match' }
  | { type: 'stamina'; player: 0 | 1; level: number };

export type SimEventType = SimEvent['type'];
