import {
  AIR,
  BALL,
  COURT,
  DRAG_K,
  MAGNUS_K,
  sideWallOutHeight,
} from './constants';
import {
  add,
  addScaled,
  clamp,
  copy,
  cross,
  dot,
  length,
  lengthSq,
  remap,
  scale,
  set,
  vec,
  type Vec3,
} from './math';
import type { BallState, SimEvent, WallId } from './types';

export const createBall = (): BallState => ({
  pos: vec(0, 1, 5),
  vel: vec(0, 0, 0),
  spin: vec(0, 0, 0),
  temperature: BALL.tempCold,
  floorBounces: 0,
  hitFrontWall: false,
  wallsSinceStrike: [],
  lastStriker: null,
  live: false,
});

/**
 * Coefficient of restitution as a function of rubber temperature.
 *
 * This single curve is why a cold ball dies in the back corner and a hot ball
 * comes off the back wall — the difference between a 5-shot rally and a
 * 40-shot rally in the same court.
 */
export const corForTemperature = (temperature: number): number =>
  remap(temperature, BALL.tempCold, BALL.tempHot, BALL.corCold, BALL.corHot);

/** Reset the per-shot bookkeeping. Called every time a racket meets the ball. */
export const markStruck = (ball: BallState, striker: 0 | 1): void => {
  ball.lastStriker = striker;
  ball.floorBounces = 0;
  ball.hitFrontWall = false;
  ball.wallsSinceStrike = [];
  ball.live = true;
};

// Scratch vectors — the integrator runs 480 times a second and should not
// allocate on any of those passes.
const _acc = vec();
const _drag = vec();
const _magnus = vec();
const _spinDir = vec();
const _velDir = vec();
const _lift = vec();
const _vNormal = vec();
const _vTangent = vec();
const _surfaceVel = vec();
const _slip = vec();
const _slipDir = vec();
const _impulse = vec();
const _spinDelta = vec();
const _normal = vec();

/** Aerodynamic + gravitational acceleration for the ball's current state. */
const accelerationAt = (ball: BallState, out: Vec3): Vec3 => {
  set(out, 0, -AIR.gravity, 0);

  const speed = length(ball.vel);
  if (speed < 1e-4) return out;

  // Quadratic drag, opposing the velocity vector.
  scale(_drag, ball.vel, -DRAG_K * speed);
  add(out, out, _drag);

  // Magnus force: lift perpendicular to both the spin axis and the velocity.
  const spinRate = length(ball.spin);
  if (spinRate > 1e-3) {
    scale(_spinDir, ball.spin, 1 / spinRate);
    scale(_velDir, ball.vel, 1 / speed);
    // Spin parameter S = rω/v; lift rises with it and then saturates.
    const spinParameter = (BALL.radius * spinRate) / speed;
    const liftCoefficient = Math.min(AIR.maxLiftCoefficient, 0.62 * spinParameter);
    cross(_lift, _spinDir, _velDir);
    scale(_magnus, _lift, MAGNUS_K * liftCoefficient * speed * speed);
    add(out, out, _magnus);
  }

  return out;
};

interface SurfaceHit {
  time: number;
  wall: WallId;
  normal: Vec3;
}

/**
 * Swept-sphere test against the six court planes.
 *
 * At 70 m/s the ball covers 15 cm per physics substep, so testing the end
 * position alone would let it pass straight through the tin. We solve for the
 * earliest plane crossing inside the step instead.
 */
const sweep = (pos: Vec3, vel: Vec3, dt: number): SurfaceHit | null => {
  const r = BALL.radius;
  let best: SurfaceHit | null = null;

  /**
   * `gap` is the clearance to the surface and `closing` the speed at which it
   * is shrinking. Expressing it this way — rather than solving for a plane
   * crossing — means a ball that is *already* fractionally past a surface is
   * caught and resolved immediately instead of producing a negative time that
   * gets discarded. Without that, gravity's quadratic term can push the ball a
   * hair below the floor mid-step and it falls out of the court for ever.
   */
  const consider = (
    gap: number,
    closing: number,
    wall: WallId,
    nx: number,
    ny: number,
    nz: number,
  ) => {
    if (closing <= 1e-9) return;
    const time = gap <= 0 ? 0 : gap / closing;
    if (time > dt) return;
    if (best && time >= best.time) return;
    best = { time, wall, normal: vec(nx, ny, nz) };
  };

  consider(pos.y - r, -vel.y, 'floor', 0, 1, 0);
  consider(pos.z - r, -vel.z, 'front', 0, 0, 1);
  consider(COURT.length - r - pos.z, vel.z, 'back', 0, 0, -1);
  consider(pos.x + COURT.halfWidth - r, -vel.x, 'left', 1, 0, 0);
  consider(COURT.halfWidth - r - pos.x, vel.x, 'right', -1, 0, 0);

  return best;
};

/** Is this impact point above the out line for the wall that was struck? */
const isOut = (wall: WallId, point: Vec3): boolean => {
  switch (wall) {
    case 'front':
      return point.y >= COURT.frontWallOutHeight;
    case 'back':
      return point.y >= COURT.backWallOutHeight;
    case 'left':
    case 'right':
      return point.y >= sideWallOutHeight(point.z);
    default:
      return false;
  }
};

/**
 * A nick is the ball burying itself in the join between a side wall and the
 * floor. It is the most prized shot in squash because the ball simply stops.
 */
const isNick = (wall: WallId, point: Vec3): boolean =>
  (wall === 'left' || wall === 'right') && point.y < 0.055;

/**
 * Resolve a surface impact: restitution along the normal, Coulomb friction and
 * spin exchange along the tangent.
 */
const resolveImpact = (
  ball: BallState,
  normal: Vec3,
  wall: WallId,
  tinHeight: number,
  contact: Vec3,
): { speedBefore: number; nick: boolean } => {
  const speedBefore = length(ball.vel);
  const nick = isNick(wall, contact);

  let cor = corForTemperature(ball.temperature);
  if (wall === 'floor') cor *= BALL.floorCorFactor;
  else if (wall === 'back') cor *= BALL.glassCorFactor;
  else if (wall === 'front' && contact.y < tinHeight) cor *= BALL.tinCorFactor;
  else cor *= BALL.wallCorFactor;

  // A ball buried in the nick loses almost everything — that is the whole point.
  if (nick) cor *= 0.18;

  const vn = dot(ball.vel, normal);
  scale(_vNormal, normal, vn);
  // vTangent = vel - normal * vn
  set(
    _vTangent,
    ball.vel.x - _vNormal.x,
    ball.vel.y - _vNormal.y,
    ball.vel.z - _vNormal.z,
  );

  // Velocity of the ball's surface at the contact patch: ω × (-r·n̂).
  scale(_normal, normal, -BALL.radius);
  cross(_surfaceVel, ball.spin, _normal);
  add(_slip, _vTangent, _surfaceVel);

  const slipSpeed = length(_slip);
  if (slipSpeed > 1e-5) {
    scale(_slipDir, _slip, 1 / slipSpeed);

    // A hollow sphere (I = ⅔mr²) needs an impulse of 0.4·m·v_slip to reach
    // rolling contact; Coulomb friction may cap it below that.
    const stickImpulse = 0.4 * slipSpeed;
    const frictionCap = BALL.surfaceFriction * (1 + cor) * Math.abs(vn);
    const jt = Math.min(stickImpulse, frictionCap);

    scale(_impulse, _slipDir, -jt);
    add(_vTangent, _vTangent, _impulse);

    // Δω = -(3 / 2r)·(n̂ × J_t) for a hollow sphere of unit mass.
    cross(_spinDelta, normal, _impulse);
    scale(_spinDelta, _spinDelta, (-1.5 / BALL.radius) * BALL.spinCoupling);
    add(ball.spin, ball.spin, _spinDelta);
  }

  // Recombine: tangential component survives, normal component reflects.
  set(
    ball.vel,
    _vTangent.x - normal.x * vn * cor,
    _vTangent.y - normal.y * vn * cor,
    _vTangent.z - normal.z * vn * cor,
  );

  // Impact energy warms the rubber, which is what a knock-up is for. Only a
  // fraction of the lost kinetic energy ends up as heat in the ball itself —
  // the rest goes into the wall, the air and sound.
  const speedAfter = length(ball.vel);
  const energyLost =
    0.5 * BALL.mass * Math.max(0, speedBefore * speedBefore - speedAfter * speedAfter);
  ball.temperature = Math.min(
    BALL.tempMax,
    ball.temperature + energyLost * BALL.heatPerImpact,
  );

  return { speedBefore, nick };
};

export interface BallStepResult {
  events: SimEvent[];
  /** Set when the ball has gone out of court or hit the tin. */
  fatal: 'out' | 'tin' | null;
}

/**
 * Advance the ball by `dt` seconds, resolving every surface it meets along the
 * way. Returns the events generated so the rules engine can rule on them.
 */
export const stepBall = (
  ball: BallState,
  dt: number,
  tinHeight: number,
  events: SimEvent[],
): 'out' | 'tin' | null => {
  if (!ball.live) return null;

  let remaining = dt;
  let fatal: 'out' | 'tin' | null = null;
  let guard = 0;

  while (remaining > 1e-7 && guard++ < 8) {
    accelerationAt(ball, _acc);

    const hit = sweep(ball.pos, ball.vel, remaining);
    const step = hit ? hit.time : remaining;

    // Semi-implicit Euler over the sub-interval.
    addScaled(ball.pos, ball.pos, ball.vel, step);
    addScaled(ball.pos, ball.pos, _acc, 0.5 * step * step);
    addScaled(ball.vel, ball.vel, _acc, step);

    // Spin bleeds off to air resistance.
    const decay = Math.exp(-BALL.spinDecay * step);
    scale(ball.spin, ball.spin, decay);

    remaining -= step;
    if (!hit) break;

    const contact = vec(ball.pos.x, ball.pos.y, ball.pos.z);

    // Out lines: struck at or above the line, the rally is over.
    if (isOut(hit.wall, contact)) {
      events.push({ type: 'ballOut', wall: hit.wall, pos: contact });
      ball.live = false;
      return 'out';
    }

    // The tin. Any contact with the board, or below it, is down.
    if (hit.wall === 'front' && contact.y < tinHeight) {
      resolveImpact(ball, hit.normal, hit.wall, tinHeight, contact);
      events.push({ type: 'ballTin', pos: contact, speed: length(ball.vel) });
      ball.wallsSinceStrike.push('tin');
      return 'tin';
    }

    const { speedBefore, nick } = resolveImpact(ball, hit.normal, hit.wall, tinHeight, contact);

    if (hit.wall === 'floor') {
      ball.floorBounces += 1;
      events.push({
        type: 'ballFloor',
        pos: contact,
        speed: speedBefore,
        bounceIndex: ball.floorBounces,
      });
    } else {
      if (hit.wall === 'front') ball.hitFrontWall = true;
      ball.wallsSinceStrike.push(hit.wall);
      events.push({
        type: 'ballWall',
        wall: hit.wall,
        pos: contact,
        speed: speedBefore,
        nick,
      });
    }

    // Nudge clear of the surface so the next sweep cannot re-detect it.
    addScaled(ball.pos, ball.pos, hit.normal, 1e-4);
  }

  // The integrator's quadratic term can leave the ball a fraction of a
  // millimetre inside a surface. Project it back out so the invariant "the ball
  // is inside the court" holds exactly at the end of every step.
  const r = BALL.radius;
  if (ball.pos.y < r) ball.pos.y = r;
  if (ball.pos.z < r) ball.pos.z = r;
  if (ball.pos.z > COURT.length - r) ball.pos.z = COURT.length - r;
  if (ball.pos.x < -COURT.halfWidth + r) ball.pos.x = -COURT.halfWidth + r;
  if (ball.pos.x > COURT.halfWidth - r) ball.pos.x = COURT.halfWidth - r;

  // Settle a ball that is trickling along the floor rather than letting it
  // jitter through hundreds of micro-bounces.
  if (ball.pos.y <= BALL.radius + 1e-3 && Math.abs(ball.vel.y) < 0.4) {
    ball.pos.y = BALL.radius;
    ball.vel.y = 0;
    const rolling = Math.exp(-COURT.floorFriction * 2.4 * dt);
    ball.vel.x *= rolling;
    ball.vel.z *= rolling;
    if (lengthSq(ball.vel) < BALL.restSpeed * BALL.restSpeed) {
      set(ball.vel, 0, 0, 0);
      scale(ball.spin, ball.spin, 0.8);
    }
  }

  return fatal;
};

/** Newton cooling back towards court ambient between rallies. */
export const coolBall = (ball: BallState, dt: number, ambient = 21): void => {
  ball.temperature += (ambient - ball.temperature) * BALL.coolRate * dt;
};

/**
 * Forward-integrate a copy of the ball for prediction: used by the AI to work
 * out where to move, and by the Hawk-Eye review overlay to draw the flight path.
 */
export const predictTrajectory = (
  ball: BallState,
  seconds: number,
  tinHeight: number,
  sampleRate = 60,
): Vec3[] => {
  const ghost: BallState = {
    ...ball,
    pos: { ...ball.pos },
    vel: { ...ball.vel },
    spin: { ...ball.spin },
    wallsSinceStrike: [...ball.wallsSinceStrike],
    live: true,
  };
  const dt = 1 / sampleRate;
  const steps = Math.ceil(seconds * sampleRate);
  const path: Vec3[] = [{ ...ghost.pos }];
  const scratch: SimEvent[] = [];

  for (let i = 0; i < steps; i++) {
    const fatal = stepBall(ghost, dt, tinHeight, scratch);
    path.push({ ...ghost.pos });
    if (fatal || ghost.floorBounces >= 2) break;
    scratch.length = 0;
  }
  return path;
};

export interface InterceptionPoint {
  pos: Vec3;
  time: number;
}

export interface Interception {
  /** The point the engine recommends playing the ball at. */
  pos: Vec3;
  time: number;
  /** False when the ball is already dead, or dies before it can be reached. */
  reachable: boolean;
  /** Playable out of the air, before the first bounce. */
  volley: InterceptionPoint | null;
  /** The first bounce itself. */
  bounce: InterceptionPoint | null;
  /** Comfortable contact point after the first bounce. */
  afterBounce: InterceptionPoint | null;
  /** Time of the second bounce — the moment the rally is lost. */
  deadline: number;
}

/**
 * Work out where and when the ball can actually be struck.
 *
 * Chasing a fixed height does not work: a good drop shot never rises to knee
 * height again, and a lob never comes below head height until it is in the back
 * corner. So instead we simulate the ball forward and pull out the three
 * moments a player genuinely chooses between — take it early out of the air,
 * take it after the bounce, or scramble it up off the floor — along with the
 * hard deadline of the second bounce.
 */
export const predictInterception = (
  ball: BallState,
  comfortableHeight: number,
  tinHeight: number,
  maxSeconds = 2.5,
): Interception => {
  const result: Interception = {
    pos: { ...ball.pos },
    time: maxSeconds,
    reachable: false,
    volley: null,
    bounce: null,
    afterBounce: null,
    deadline: maxSeconds,
  };
  if (!ball.live) return result;

  const ghost: BallState = {
    ...ball,
    pos: { ...ball.pos },
    vel: { ...ball.vel },
    spin: { ...ball.spin },
    wallsSinceStrike: [...ball.wallsSinceStrike],
    live: true,
  };

  const dt = 1 / 120;
  const steps = Math.ceil(maxSeconds * dt === 0 ? 0 : maxSeconds * 120);
  const scratch: SimEvent[] = [];
  const startBounces = ghost.floorBounces;

  // Samples taken after the first bounce, used to pick a contact point.
  const postBounce: Array<{ pos: Vec3; time: number }> = [];
  let apexIndex = -1;
  let apexY = -Infinity;

  for (let i = 0; i < steps; i++) {
    const prevY = ghost.pos.y;
    const fatal = stepBall(ghost, dt, tinHeight, scratch);
    scratch.length = 0;
    const time = (i + 1) * dt;

    // A ball that goes out or finds the tin is dead; there is nothing to chase.
    if (fatal) {
      result.deadline = time;
      break;
    }

    const hasBounced = ghost.floorBounces > startBounces;

    // Second bounce: the rally is over at this instant.
    if (ghost.floorBounces >= startBounces + 2) {
      result.deadline = time;
      break;
    }

    if (!hasBounced) {
      // Volley candidate: descending through a comfortable height, after the
      // ball has come off the front wall so it is genuinely on its way back.
      if (
        !result.volley &&
        (ghost.hitFrontWall || ball.hitFrontWall) &&
        ghost.pos.y < prevY &&
        prevY >= comfortableHeight &&
        ghost.pos.y <= comfortableHeight
      ) {
        result.volley = { pos: { ...ghost.pos }, time };
      }
    } else {
      if (!result.bounce) result.bounce = { pos: { ...ghost.pos }, time };
      postBounce.push({ pos: { ...ghost.pos }, time });
      if (ghost.pos.y > apexY) {
        apexY = ghost.pos.y;
        apexIndex = postBounce.length - 1;
      }
    }
  }

  // Pick the contact point after the bounce: the ball on its way back down
  // through a comfortable height, or the top of the bounce if it never gets
  // that high — which is exactly what a good drop shot forces you to do.
  if (postBounce.length > 0 && apexIndex >= 0) {
    const target = Math.min(comfortableHeight, apexY);
    let chosen = postBounce[apexIndex];
    for (let i = apexIndex; i < postBounce.length; i++) {
      if (postBounce[i].pos.y <= target) {
        chosen = postBounce[i];
        break;
      }
    }
    result.afterBounce = { pos: { ...chosen.pos }, time: chosen.time };
  }

  const best = result.afterBounce ?? result.volley ?? result.bounce;
  if (best) {
    result.pos = { ...best.pos };
    result.time = best.time;
    result.reachable = true;
  }

  return result;
};

/** Speed in km/h, the unit every broadcast graphic uses. */
export const speedKmh = (v: Vec3): number => length(v) * 3.6;

export const clampToCourt = (p: Vec3): Vec3 =>
  set(
    p,
    clamp(p.x, -COURT.halfWidth + BALL.radius, COURT.halfWidth - BALL.radius),
    clamp(p.y, BALL.radius, COURT.frontWallOutHeight),
    clamp(p.z, BALL.radius, COURT.length - BALL.radius),
  );

export const copyBall = (dst: BallState, src: BallState): void => {
  copy(dst.pos, src.pos);
  copy(dst.vel, src.vel);
  copy(dst.spin, src.spin);
  dst.temperature = src.temperature;
  dst.floorBounces = src.floorBounces;
  dst.hitFrontWall = src.hitFrontWall;
  dst.wallsSinceStrike = [...src.wallsSinceStrike];
  dst.lastStriker = src.lastStriker;
  dst.live = src.live;
};
