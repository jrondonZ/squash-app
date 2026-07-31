import { AIR, BALL, COURT, DRAG_K, sideWallOutHeight } from './constants';
import {
  add,
  addScaled,
  clamp,
  clamp01,
  cross,
  length,
  normalize,
  remap,
  scale,
  set,
  sub,
  vec,
  type Rng,
  type Vec3,
} from './math';
import type { Character } from '../data/roster';
import type { BallState, ShotType } from './types';

/**
 * The racket impact model.
 *
 * Rather than simulate a swinging racket, we do what a player actually does:
 * pick a target on a wall and try to hit it. Execution quality then perturbs
 * that target. Errors fall out of the model — a stretched player attempting a
 * drop under pressure finds the tin because their aim point drifted down, not
 * because a die told them to.
 */

export interface ShotProfile {
  /** Where on the front wall (or side wall, for a boast) the player is aiming. */
  targetHeight: [number, number];
  /** Racket-head pace in m/s, before the power attribute is applied. */
  pace: [number, number];
  /** Backspin in rad/s. Negative is topspin. */
  backspin: number;
  /** Sidespin ("cut") in rad/s, signed towards the striking side. */
  sidespin: number;
  /** How much a mistimed contact hurts this shot, 0–1. */
  precision: number;
  /** Which attribute governs execution. */
  governing: keyof Character['attributes'];
  /** Human-readable name used by the commentary team. */
  label: string;
}

export const SHOT_PROFILES: Record<ShotType, ShotProfile> = {
  drive: {
    targetHeight: [0.75, 1.25],
    pace: [34, 46],
    backspin: 24,
    sidespin: 8,
    precision: 0.55,
    governing: 'accuracy',
    label: 'straight drive',
  },
  crossCourt: {
    targetHeight: [0.9, 1.5],
    pace: [34, 47],
    backspin: 18,
    sidespin: -22,
    precision: 0.5,
    governing: 'accuracy',
    label: 'cross-court drive',
  },
  drop: {
    targetHeight: [0.5, 0.72],
    pace: [9.5, 14],
    backspin: 92,
    sidespin: 46,
    precision: 0.95,
    governing: 'touch',
    label: 'drop shot',
  },
  lob: {
    targetHeight: [2.9, 3.9],
    pace: [12, 16.5],
    backspin: 40,
    sidespin: -14,
    precision: 0.6,
    governing: 'touch',
    label: 'lob',
  },
  boast: {
    targetHeight: [0.85, 1.6],
    pace: [24, 34],
    backspin: 10,
    sidespin: 30,
    precision: 0.7,
    governing: 'accuracy',
    label: 'boast',
  },
  volley: {
    targetHeight: [0.7, 1.15],
    pace: [36, 50],
    backspin: 30,
    sidespin: 10,
    precision: 0.75,
    governing: 'volley',
    label: 'volley',
  },
  kill: {
    targetHeight: [0.48, 0.62],
    pace: [50, 66],
    backspin: -18,
    sidespin: 12,
    precision: 1.0,
    governing: 'power',
    label: 'kill',
  },
  nick: {
    targetHeight: [0.52, 0.78],
    pace: [28, 40],
    backspin: 34,
    sidespin: 62,
    precision: 1.0,
    governing: 'touch',
    label: 'nick',
  },
  flick: {
    targetHeight: [1.1, 1.9],
    pace: [30, 42],
    backspin: 8,
    sidespin: -18,
    precision: 0.8,
    governing: 'deception',
    label: 'flicked cross-court',
  },
  serve: {
    targetHeight: [2.1, 3.2],
    pace: [11, 17],
    backspin: 20,
    sidespin: -20,
    precision: 0.45,
    governing: 'accuracy',
    label: 'serve',
  },
};

// ---------------------------------------------------------------------------
// Launch solver
// ---------------------------------------------------------------------------

const _ghostPos = vec();
const _ghostVel = vec();

/**
 * Integrate gravity and drag only — no collisions — so we can measure how far
 * the analytic solution falls short and correct the aim point for it.
 */
const freeFlightEnd = (out: Vec3, from: Vec3, vel: Vec3, time: number): Vec3 => {
  set(_ghostPos, from.x, from.y, from.z);
  set(_ghostVel, vel.x, vel.y, vel.z);
  const steps = Math.max(4, Math.ceil(time * 120));
  const dt = time / steps;
  for (let i = 0; i < steps; i++) {
    const speed = length(_ghostVel);
    const ax = -DRAG_K * speed * _ghostVel.x;
    const ay = -AIR.gravity - DRAG_K * speed * _ghostVel.y;
    const az = -DRAG_K * speed * _ghostVel.z;
    _ghostPos.x += _ghostVel.x * dt + 0.5 * ax * dt * dt;
    _ghostPos.y += _ghostVel.y * dt + 0.5 * ay * dt * dt;
    _ghostPos.z += _ghostVel.z * dt + 0.5 * az * dt * dt;
    _ghostVel.x += ax * dt;
    _ghostVel.y += ay * dt;
    _ghostVel.z += az * dt;
  }
  return set(out, _ghostPos.x, _ghostPos.y, _ghostPos.z);
};

const _aimPoint = vec();
const _landed = vec();
const _error = vec();

/**
 * Ballistic solution at a *fixed launch speed*.
 *
 * This is the right problem to solve: a player swings at a chosen pace and
 * chooses an angle, they do not choose a flight time. Solving for flight time
 * instead — the obvious first approach — silently caps the ball's speed at
 * roughly distance/time and makes every shot in the game slower than it should
 * be, which is exactly what a 108 km/h "maximum" drive was telling us.
 *
 * Eliminating t from the projectile equations gives a quadratic in tan θ:
 *
 *     k·tan²θ − d·tan θ + (h + k) = 0,   where k = g·d² / (2·v²)
 *
 * with d the horizontal range and h the height difference. The two roots are
 * the flat and the lofted trajectory; `preferHigh` picks between them. A
 * negative discriminant means the target is simply out of range at this speed,
 * in which case we return the 45°-style maximum-range launch instead.
 */
const solveAtSpeed = (out: Vec3, from: Vec3, target: Vec3, speed: number, preferHigh: boolean): Vec3 => {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  const h = target.y - from.y;

  if (d < 1e-3) {
    // Straight up or straight down — no horizontal component to solve for.
    return set(out, 0, h >= 0 ? speed : -speed, 0);
  }

  const v2 = speed * speed;
  const k = (AIR.gravity * d * d) / (2 * v2);
  const discriminant = d * d - 4 * k * (h + k);

  let tanTheta: number;
  if (discriminant < 0) {
    // Out of range: launch at the angle that maximises range for this speed.
    tanTheta = Math.tan(Math.PI / 4 + Math.atan2(h, d) / 2);
  } else {
    const root = Math.sqrt(discriminant);
    const low = (d - root) / (2 * k);
    const high = (d + root) / (2 * k);
    tanTheta = preferHigh ? high : low;
  }

  const theta = Math.atan(tanTheta);
  const horizontal = speed * Math.cos(theta);
  const vertical = speed * Math.sin(theta);

  return set(out, (dx / d) * horizontal, vertical, (dz / d) * horizontal);
};

/**
 * Solve for the launch velocity that reaches `target` at the requested pace
 * once drag is accounted for.
 *
 * Drag is handled by aim-point correction: solve without it, fly the solution
 * forward through the real drag model, see where it actually ends up, and move
 * the aim point by the miss. Three rounds converge to well under a centimetre,
 * which is far finer than the execution noise added afterwards.
 */
export const solveLaunch = (
  out: Vec3,
  from: Vec3,
  target: Vec3,
  speed: number,
  preferHigh = false,
): Vec3 => {
  set(_aimPoint, target.x, target.y, target.z);

  for (let i = 0; i < 3; i++) {
    solveAtSpeed(out, from, _aimPoint, speed, preferHigh);

    // Time for this solution to cover the horizontal distance to the target.
    const dx = _aimPoint.x - from.x;
    const dz = _aimPoint.z - from.z;
    const horizontalSpeed = Math.hypot(out.x, out.z);
    if (horizontalSpeed < 1e-3) break;
    const time = clamp(Math.hypot(dx, dz) / horizontalSpeed, 0.02, 3);

    freeFlightEnd(_landed, from, out, time);
    sub(_error, target, _landed);
    add(_aimPoint, _aimPoint, _error);
  }

  return solveAtSpeed(out, from, _aimPoint, speed, preferHigh);
};

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

export interface ShotContext {
  shot: ShotType;
  contact: Vec3;
  /** Incoming ball, for pace transfer and to know how rushed the player is. */
  ball: BallState;
  character: Character;
  /** -1 hard left … +1 hard right. */
  aimX: number;
  /** -1 low … +1 high. */
  aimY: number;
  /** 0–1 commitment from how long the swing was held. */
  power: number;
  /** 0–1: how close to the ideal contact moment the swing landed. */
  timing: number;
  /** 0–1 remaining stamina. */
  stamina: number;
  /** 0–1: how stretched the player is. 1 means a full desperate lunge. */
  stretch: number;
  rng: Rng;
  tinHeight: number;
}

export interface ShotResult {
  vel: Vec3;
  spin: Vec3;
  /** 0–1 execution quality. Drives commentary and the visual effect. */
  quality: number;
  /** The wall point the player was actually aiming at, for the coaching overlay. */
  aimPoint: Vec3;
  /** True when the shot was a deliberate boast off the side wall. */
  viaSideWall: boolean;
}

const attr = (c: Character, key: keyof Character['attributes']) => c.attributes[key] / 100;

/**
 * How hard is this shot to execute from where the player is standing?
 * Returns 0 (routine) to 1 (barely possible).
 */
export const shotDifficulty = (ctx: ShotContext): number => {
  const { shot, contact } = ctx;
  let d = 0;

  // Attacking shots from the back of the court are the classic low-percentage
  // choice — the reason coaches say "you can't hit a winner from the back".
  const depth = clamp01((contact.z - COURT.shortLine) / (COURT.length - COURT.shortLine));
  if (shot === 'drop' || shot === 'nick' || shot === 'kill') d += depth * 0.62;
  if (shot === 'boast') d += (1 - depth) * 0.4;

  // Low contact points force the ball up; high ones are comfortable.
  const contactHeight = clamp01(contact.y / 1.6);
  d += (1 - contactHeight) * 0.28;

  // Ball pace: the faster it arrives, the less time to shape the shot.
  d += clamp01(length(ctx.ball.vel) / 55) * 0.22;

  // Being stretched wrecks everything.
  d += ctx.stretch * 0.55;

  // Tiredness costs precision late in a match.
  d += (1 - ctx.stamina) * 0.3;

  return clamp01(d);
};

/** Pick the point on a wall the player is trying to hit. */
const chooseTarget = (out: Vec3, ctx: ShotContext, profile: ShotProfile): boolean => {
  const { shot, contact, aimX, aimY } = ctx;
  // Which half of the court the striker is in. Straight shots go back down
  // this side; cross-court shots go to the other.
  const side = contact.x >= 0 ? 1 : -1;
  const tight = COURT.halfWidth - 0.34;

  const heightBase =
    profile.targetHeight[0] +
    (profile.targetHeight[1] - profile.targetHeight[0]) * (0.5 + aimY * 0.5);

  switch (shot) {
    case 'boast': {
      // A boast strikes your own side wall first, deep, and angles across to
      // the opposite front corner.
      const wallX = side * (COURT.halfWidth - BALL.radius);
      const depth = clamp(contact.z - remap(ctx.power, 0, 1, 0.4, 1.7), 0.6, COURT.length - 0.4);
      const maxHeight = sideWallOutHeight(depth) - 0.5;
      set(out, wallX, clamp(heightBase + 0.25, 0.4, maxHeight), depth);
      return true;
    }
    case 'nick': {
      // Aim at the join of the far side wall and the floor, a little past the
      // front wall contact point.
      const targetX = -side * (tight + 0.18) + aimX * 0.5;
      set(out, clamp(targetX, -tight - 0.2, tight + 0.2), heightBase, BALL.radius);
      return false;
    }
    case 'crossCourt':
    case 'flick': {
      const targetX = -side * clamp(0.55 + ctx.power * 0.9, 0.3, 2.1) + aimX * 1.2;
      set(out, clamp(targetX, -tight, tight), heightBase, BALL.radius);
      return false;
    }
    case 'lob': {
      // A good lob is played cross-court, high, into the back corner.
      const targetX = -side * clamp(0.8 + ctx.power * 0.7, 0.3, 1.9) + aimX * 1.0;
      set(out, clamp(targetX, -tight, tight), heightBase, BALL.radius);
      return false;
    }
    case 'serve': {
      // Handled by the serve helper, which knows which box is in play.
      set(out, aimX * tight, heightBase, BALL.radius);
      return false;
    }
    default: {
      // Straight: drive, drop, volley, kill all go back down the same wall.
      const targetX = side * tight + aimX * 1.1;
      set(out, clamp(targetX, -tight, tight), heightBase, BALL.radius);
      return false;
    }
  }
};

const _launch = vec();
const _spinAxis = vec();
const _velDir = vec();
const _up = vec(0, 1, 0);
const _lateral = vec();

/**
 * Turn an intent into an actual ball velocity and spin.
 */
export const executeShot = (ctx: ShotContext): ShotResult => {
  const profile = SHOT_PROFILES[ctx.shot];
  const { character, rng } = ctx;

  const skill = attr(character, profile.governing);
  const accuracy = attr(character, 'accuracy');
  const difficulty = shotDifficulty(ctx);

  // Execution quality: skill and timing against the difficulty of the attempt.
  const timingTerm = Math.pow(clamp01(ctx.timing), 0.7);
  const raw = skill * 0.45 + accuracy * 0.2 + timingTerm * 0.35 - difficulty * 0.55;
  const quality = clamp01(raw + rng.gaussian(0, 0.055) + 0.28);

  const aimPoint = vec();
  const viaSideWall = chooseTarget(aimPoint, ctx, profile);

  // Aim error grows as quality falls, scaled by how unforgiving the shot is.
  const errorScale = (1 - quality) * profile.precision;
  aimPoint.x += rng.gaussian(0, 0.62 * errorScale + 0.035);

  // Height error is biased downwards, because a tired, stretched player drops
  // the ball into the tin far more often than they float it out.
  //
  // The pressure term is separate from, and grows faster than, the quality term
  // on purpose. Errors in squash are not uniformly distributed across the match:
  // a professional hitting a comfortable length almost never finds the tin, but
  // the same player scrambling at full stretch in the back corner does it
  // several times a game. A single well-behaved noise term cannot produce both,
  // so difficulty gets its own quadratic contribution to the spread.
  const pressure = difficulty * difficulty;
  aimPoint.y += rng.gaussian(
    -0.3 * errorScale - 0.34 * pressure,
    0.45 * errorScale + 0.035 + 0.44 * pressure,
  );
  aimPoint.y = Math.max(aimPoint.y, 0.02);

  // Pace: profile band, scaled by the power attribute, the player's commitment
  // and how much of the incoming ball's speed can be redirected.
  const powerAttr = attr(character, 'power');
  const paceBand = profile.pace[0] + (profile.pace[1] - profile.pace[0]) * clamp01(ctx.power);
  const incoming = length(ctx.ball.vel);
  const paceTransfer = 1 + clamp01(incoming / 45) * 0.16 * (ctx.shot === 'volley' ? 1.5 : 1);
  const fatigue = 0.82 + 0.18 * ctx.stamina;
  const stretchLoss = 1 - ctx.stretch * 0.34;
  const speed =
    paceBand *
    (0.78 + powerAttr * 0.34) *
    paceTransfer *
    fatigue *
    stretchLoss *
    (0.9 + quality * 0.15);

  solveLaunch(_launch, ctx.contact, aimPoint, speed);

  // Guard against a solution that would send the ball straight up out of court.
  const launchSpeed = length(_launch);
  if (launchSpeed > 82) scale(_launch, _launch, 82 / launchSpeed);

  // Spin. Backspin sits on the axis perpendicular to travel in the horizontal
  // plane; sidespin ("cut") sits on the vertical axis.
  normalize(_velDir, _launch);
  cross(_spinAxis, _up, _velDir);
  normalize(_spinAxis, _spinAxis);

  const spinSkill = 0.7 + attr(character, 'touch') * 0.5;
  const backspin = profile.backspin * spinSkill * (0.6 + quality * 0.6);
  const sidespinSign = ctx.contact.x >= 0 ? 1 : -1;
  const sidespin = profile.sidespin * spinSkill * sidespinSign * (0.5 + quality * 0.7);

  const spin = vec();
  scale(spin, _spinAxis, backspin);
  scale(_lateral, _up, sidespin);
  add(spin, spin, _lateral);

  return {
    vel: { x: _launch.x, y: _launch.y, z: _launch.z },
    spin,
    quality,
    aimPoint,
    viaSideWall,
  };
};

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

export interface ServeContext {
  contact: Vec3;
  character: Character;
  /** Box being served from. */
  side: -1 | 1;
  /** Lob serve floats to the back corner; hard serve attacks the body. */
  style: 'lob' | 'hard' | 'bodyLine';
  aimX: number;
  aimY: number;
  power: number;
  rng: Rng;
}

/**
 * A legal serve must strike the front wall above the service line and below
 * the out line, then land in the opposite back quarter. The solver aims for a
 * point comfortably inside those bounds and lets execution noise do the rest —
 * so faults happen, but not often, and more often when a player is rattled.
 */
export const executeServe = (ctx: ServeContext): ShotResult => {
  const { side, character, rng } = ctx;
  const accuracy = attr(character, 'accuracy');
  const quality = clamp01(0.55 + accuracy * 0.4 + rng.gaussian(0, 0.07));

  // Serve across the court: from the right box, towards the back left.
  const receivingSign = -side;
  const tight = COURT.halfWidth - 0.4;

  let targetX: number;
  let targetY: number;
  let speed: number;

  switch (ctx.style) {
    case 'hard':
      targetX = receivingSign * clamp(1.3 + ctx.power * 0.8, 0.6, tight);
      targetY = 1.95 + ctx.aimY * 0.3;
      speed = 26 + ctx.power * 12;
      break;
    case 'bodyLine':
      targetX = receivingSign * 0.75;
      targetY = 2.3 + ctx.aimY * 0.35;
      speed = 18 + ctx.power * 7;
      break;
    default:
      // The classic high lob serve: hit high, drop it dead in the back corner.
      targetX = receivingSign * clamp(1.0 + ctx.power * 0.9, 0.5, tight);
      targetY = 3.05 + ctx.aimY * 0.5;
      speed = 12.5 + ctx.power * 3.5;
  }

  targetX += ctx.aimX * 1.1 + rng.gaussian(0, 0.24 * (1 - quality) + 0.05);
  targetY += rng.gaussian(0, 0.3 * (1 - quality) + 0.04);

  // Keep the aim point inside the legal band; genuine faults come from the
  // noise above pushing it out, not from clamping it in.
  targetY = clamp(targetY, COURT.serviceLineHeight - 0.35, COURT.frontWallOutHeight + 0.25);

  const aimPoint = vec(clamp(targetX, -tight - 0.3, tight + 0.3), targetY, BALL.radius);
  solveLaunch(_launch, ctx.contact, aimPoint, speed);

  normalize(_velDir, _launch);
  cross(_spinAxis, _up, _velDir);
  normalize(_spinAxis, _spinAxis);
  const spin = vec();
  scale(spin, _spinAxis, 22);
  addScaled(spin, spin, _up, -receivingSign * 26);

  return {
    vel: { x: _launch.x, y: _launch.y, z: _launch.z },
    spin,
    quality,
    aimPoint,
    viaSideWall: false,
  };
};

/**
 * Classify a shot after the fact from the walls it touched and where it
 * finished. The commentary team and the stats panel both want this.
 */
export const classifyShot = (
  intended: ShotType,
  ball: BallState,
  landing: Vec3 | null,
): { name: string; wasWinner: boolean; tight: boolean } => {
  const walls = ball.wallsSinceStrike;
  const frontIndex = walls.indexOf('front');
  const hitSideFirst = frontIndex > 0 && (walls[0] === 'left' || walls[0] === 'right');
  const hitSideAfter = frontIndex >= 0 && walls.slice(frontIndex + 1).some((w) => w === 'left' || w === 'right');

  let name = SHOT_PROFILES[intended].label;
  if (hitSideFirst) name = 'boast';
  else if (intended === 'drive' && hitSideAfter) name = 'drive off the side wall';

  const tight = landing
    ? Math.abs(Math.abs(landing.x) - COURT.halfWidth) < 0.42
    : false;

  const wasWinner = landing ? landing.z < COURT.shortLine * 0.6 : false;

  return { name, wasWinner, tight };
};
