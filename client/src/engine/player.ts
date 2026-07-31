import { BALL, COURT, PLAYER } from './constants';
import {
  clamp,
  clamp01,
  damp,
  dampAngle,
  distance,
  distanceXZ,
  length,
  set,
  vec,
  type Vec3,
} from './math';
import type { Character } from '../data/roster';
import type { BallState, PlayerInput, PlayerState, ShotType, SwingState } from './types';

const attr = (c: Character, key: keyof Character['attributes']) => c.attributes[key] / 100;

export const createPlayer = (index: 0 | 1, characterId: string): PlayerState => ({
  index,
  characterId,
  // Players start either side of the T, the incoming server slightly back.
  pos: vec(index === 0 ? -0.6 : 0.6, 0, COURT.shortLine + (index === 0 ? 0.6 : -0.4)),
  vel: vec(),
  facing: 0,
  swing: {
    phase: 'idle',
    elapsed: 0,
    type: 'drive',
    aimX: 0,
    aimY: 0,
    power: 0.5,
    lunging: false,
    side: 'forehand',
  },
  stamina: PLAYER.maxStamina,
  offBalance: 0,
  swingCooldown: 0,
  score: 0,
  gamesWon: 0,
  gameScores: [],
  conductRecord: [],
  reviewsRemaining: 1,
  hasBall: false,
  distanceCovered: 0,
});

/** Maximum distance the racket head can reach from the body right now. */
export const reachOf = (player: PlayerState, character: Character, lunging: boolean): number => {
  const retrieval = attr(character, 'retrieval');
  const base = PLAYER.reach * (0.9 + retrieval * 0.2);
  const lunge = lunging ? PLAYER.lungeReach * (0.75 + retrieval * 0.45) : 0;
  // A tired player does not get down to the ball the same way.
  const fatigue = 0.88 + 0.12 * (player.stamina / PLAYER.maxStamina);
  return (base + lunge) * fatigue;
};

/** How far the ball is beyond comfortable reach, 0 (in the slot) to 1 (desperate). */
export const stretchFactor = (
  player: PlayerState,
  character: Character,
  ballPos: Vec3,
  lunging: boolean,
): number => {
  const comfortable = PLAYER.reach * 0.62;
  const max = reachOf(player, character, lunging);
  const d = distance({ x: player.pos.x, y: 0.75, z: player.pos.z }, ballPos);
  if (d <= comfortable) return 0;
  return clamp01((d - comfortable) / Math.max(0.2, max - comfortable));
};

/** Duration of the backswing — fast hands cut it down, big swings extend it. */
export const backswingDuration = (character: Character, shot: ShotType): number => {
  const hands = (attr(character, 'volley') + attr(character, 'deception')) * 0.5;
  const base = PLAYER.backswingTime * (1.22 - hands * 0.34);
  const shotFactor = shot === 'kill' ? 1.28 : shot === 'drop' || shot === 'nick' ? 0.86 : 1;
  return base * shotFactor;
};

/** Contact timing quality: 1 at the centre of the window, 0 at its edges. */
export const timingQuality = (swing: SwingState, character: Character): number => {
  const window = PLAYER.contactWindow * (0.85 + attr(character, 'volley') * 0.35);
  const offset = Math.abs(swing.elapsed - window);
  return clamp01(1 - offset / window);
};

/**
 * Move the player. Squash movement is not free-roaming: players push off the T,
 * arrive, and recover. Deceleration is deliberately harsher than acceleration
 * so that overcommitting has a cost.
 */
export const movePlayer = (
  player: PlayerState,
  character: Character,
  input: PlayerInput,
  dt: number,
): void => {
  const speedAttr = attr(character, 'speed');
  const staminaRatio = player.stamina / PLAYER.maxStamina;
  // Below 40% stamina the legs start to go, and it shows.
  const staminaPenalty = 0.72 + 0.28 * clamp01(staminaRatio / 0.4);

  const maxSpeed = PLAYER.baseMaxSpeed * (0.82 + speedAttr * 0.34) * staminaPenalty;
  const accel = PLAYER.baseAccel * (0.82 + speedAttr * 0.36) * staminaPenalty;

  let mx = input.moveX;
  let mz = input.moveZ;
  const mag = Math.hypot(mx, mz);
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }

  // Committing to a swing anchors the feet; being off balance does too.
  const anchored =
    player.swing.phase === 'backswing' || player.swing.phase === 'contact' || player.offBalance > 0;
  const control = anchored ? 0.25 : 1;

  const targetVx = mx * maxSpeed * control;
  const targetVz = mz * maxSpeed * control;

  const rate = (v: number, target: number) => {
    const decelerating = Math.abs(target) < Math.abs(v) || Math.sign(target) !== Math.sign(v);
    const a = accel * (decelerating ? PLAYER.decelFactor : 1);
    const delta = target - v;
    const step = clamp(delta, -a * dt, a * dt);
    return v + step;
  };

  player.vel.x = rate(player.vel.x, targetVx);
  player.vel.z = rate(player.vel.z, targetVz);

  const before = { x: player.pos.x, z: player.pos.z };
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;

  // Players stay inside the court, just short of the walls.
  const margin = PLAYER.bodyRadius;
  player.pos.x = clamp(player.pos.x, -COURT.halfWidth + margin, COURT.halfWidth - margin);
  player.pos.z = clamp(player.pos.z, margin + 0.1, COURT.length - margin);

  const travelled = Math.hypot(player.pos.x - before.x, player.pos.z - before.z);
  player.distanceCovered += travelled;

  // Stamina: movement, and the extra bite of hard acceleration.
  const enduranceAttr = attr(character, 'stamina');
  const drainScale = 1.35 - enduranceAttr * 0.6;
  player.stamina -= travelled * PLAYER.staminaPerMetre * drainScale;

  if (player.offBalance > 0) player.offBalance = Math.max(0, player.offBalance - dt);
  if (player.swingCooldown > 0) player.swingCooldown = Math.max(0, player.swingCooldown - dt);

  player.stamina = clamp(player.stamina, 0, PLAYER.maxStamina);
};

/** Turn to face the ball — used for animation and for the interference test. */
export const faceBall = (player: PlayerState, ball: BallState, dt: number): void => {
  const dx = ball.pos.x - player.pos.x;
  const dz = ball.pos.z - player.pos.z;
  if (Math.hypot(dx, dz) < 0.05) return;
  const target = Math.atan2(dx, -dz);
  player.facing = dampAngle(player.facing, target, 9, dt);
};

/** Recovery between rallies. */
export const recoverStamina = (
  player: PlayerState,
  character: Character,
  dt: number,
): void => {
  const rate = PLAYER.staminaRecovery * (0.7 + attr(character, 'stamina') * 0.7);
  player.stamina = clamp(player.stamina + rate * dt, 0, PLAYER.maxStamina);
};

export interface SwingUpdate {
  /** Set on the tick where the racket should meet the ball. */
  contactNow: boolean;
  /** Set when the swing completed without ever reaching the ball. */
  missed: boolean;
}

/**
 * Advance the swing state machine.
 *
 * A swing is committed early — the backswing starts before you know exactly
 * where the ball will be — and contact happens inside a narrow window. Swinging
 * at the wrong moment is punished by timing quality, not by an outright miss,
 * which keeps the game readable while still rewarding good judgement.
 */
export const updateSwing = (
  player: PlayerState,
  character: Character,
  input: PlayerInput,
  ball: BallState,
  dt: number,
  canStrike: boolean,
): SwingUpdate => {
  const swing = player.swing;
  const result: SwingUpdate = { contactNow: false, missed: false };

  switch (swing.phase) {
    case 'idle': {
      if (input.swingPressed && player.swingCooldown <= 0 && canStrike) {
        swing.phase = 'backswing';
        swing.elapsed = 0;
        swing.type = input.shot;
        swing.aimX = input.aimX;
        swing.aimY = input.aimY;
        swing.power = 0.35;
        swing.lunging = input.lunge;
        swing.side = ball.pos.x >= player.pos.x ? 'forehand' : 'backhand';
        player.stamina -= PLAYER.staminaPerSwing;
        if (input.lunge) player.stamina -= PLAYER.staminaPerLunge;
      }
      break;
    }
    case 'backswing': {
      swing.elapsed += dt;
      // Holding the button loads the shot; the aim can still be adjusted, which
      // is what makes holding the ball and wrong-footing possible.
      if (input.swingHeld) swing.power = clamp01(swing.power + dt * 2.1);
      swing.aimX = damp(swing.aimX, input.aimX, 12, dt);
      swing.aimY = damp(swing.aimY, input.aimY, 12, dt);
      // Late shot-shape changes are the essence of deception.
      swing.type = input.shot;

      if (swing.elapsed >= backswingDuration(character, swing.type)) {
        swing.phase = 'contact';
        swing.elapsed = 0;
      }
      break;
    }
    case 'contact': {
      swing.elapsed += dt;
      const window = PLAYER.contactWindow * (0.85 + attr(character, 'volley') * 0.35);
      if (swing.elapsed >= window * 2) {
        swing.phase = 'recovery';
        swing.elapsed = 0;
        result.missed = true;
      } else {
        result.contactNow = true;
      }
      break;
    }
    case 'recovery': {
      swing.elapsed += dt;
      if (swing.elapsed >= PLAYER.recoveryTime) {
        swing.phase = 'idle';
        swing.elapsed = 0;
        player.swingCooldown = 0.04;
      }
      break;
    }
  }

  return result;
};

/** Is the ball inside the racket's strike volume this instant? */
export const canReachBall = (
  player: PlayerState,
  character: Character,
  ball: BallState,
  lunging: boolean,
): boolean => {
  if (ball.pos.y > PLAYER.maxReachHeight) return false;
  if (ball.pos.y < BALL.radius * 0.5) return false;
  const reach = reachOf(player, character, lunging);
  const horizontal = distanceXZ(player.pos, ball.pos);
  if (horizontal > reach) return false;
  // Reaching high costs horizontal range, and vice versa — a rough shoulder
  // sphere rather than a cylinder.
  const heightPenalty = Math.max(0, ball.pos.y - 1.35) * 0.55;
  return horizontal + heightPenalty <= reach;
};

/** Where the racket head actually meets the ball, clamped into the strike volume. */
export const contactPoint = (ball: BallState, out: Vec3): Vec3 =>
  set(
    out,
    ball.pos.x,
    clamp(ball.pos.y, BALL.radius, PLAYER.maxReachHeight),
    ball.pos.z,
  );

/** Commit the player to a stretched position after a hard retrieval. */
export const applyRecoil = (player: PlayerState, stretch: number): void => {
  if (stretch > 0.55) {
    player.offBalance = 0.18 + stretch * 0.5;
    player.vel.x *= 0.35;
    player.vel.z *= 0.35;
  }
};

/**
 * Push two players apart when they occupy the same space.
 *
 * Squash players do not walk through each other, and without this the two
 * bodies happily overlap on the T — which the interference rules then read as
 * permanent, maximal blocking and the referee ends up calling a let every
 * second rally. Separation is soft rather than a hard constraint so that
 * genuine crowding still registers as interference before it is resolved.
 */
export const separatePlayers = (a: PlayerState, b: PlayerState, dt: number): void => {
  const minimum = PLAYER.bodyRadius * 2;
  let dx = b.pos.x - a.pos.x;
  let dz = b.pos.z - a.pos.z;
  let distance = Math.hypot(dx, dz);

  if (distance >= minimum) return;

  // Exactly coincident: pick a deterministic axis to separate along.
  if (distance < 1e-4) {
    dx = 0;
    dz = 1;
    distance = 1;
  } else {
    dx /= distance;
    dz /= distance;
  }

  const overlap = minimum - distance;
  // Resolve over roughly a tenth of a second rather than instantly, so contact
  // reads as a shoulder-to-shoulder shove instead of a teleport.
  const push = Math.min(overlap, overlap * dt * 12) * 0.5;

  a.pos.x -= dx * push;
  a.pos.z -= dz * push;
  b.pos.x += dx * push;
  b.pos.z += dz * push;

  // Kill the closing component of each player's velocity.
  const closing = (b.vel.x - a.vel.x) * dx + (b.vel.z - a.vel.z) * dz;
  if (closing < 0) {
    a.vel.x += dx * closing * 0.5;
    a.vel.z += dz * closing * 0.5;
    b.vel.x -= dx * closing * 0.5;
    b.vel.z -= dz * closing * 0.5;
  }

  for (const p of [a, b]) {
    p.pos.x = clamp(p.pos.x, -COURT.halfWidth + PLAYER.bodyRadius, COURT.halfWidth - PLAYER.bodyRadius);
    p.pos.z = clamp(p.pos.z, PLAYER.bodyRadius + 0.1, COURT.length - PLAYER.bodyRadius);
  }
};

/** Distance from the T, the number every squash coach cares about. */
export const distanceFromT = (player: PlayerState): number =>
  Math.hypot(player.pos.x - PLAYER.tPosition.x, player.pos.z - PLAYER.tPosition.z);

/**
 * A player is "on the T" if they have recovered to the centre. Used by the
 * interference rules and by the stats panel.
 */
export const isOnT = (player: PlayerState): boolean => distanceFromT(player) < 1.1;

export const speedOf = (player: PlayerState): number => length(player.vel);
