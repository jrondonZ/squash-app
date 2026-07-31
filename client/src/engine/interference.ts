import { COURT, PLAYER } from './constants';
import { clamp01, distanceXZ, dot, length, normalize, remap, sub, vec, type Vec3 } from './math';
import type { BallState, PlayerState, RallyOutcome } from './types';

/**
 * Interference: let, stroke and no let.
 *
 * This follows WSF Rule 8. The striker is entitled to four things — direct
 * access to the ball, a fair view of it, a reasonable swing, and the freedom to
 * play it directly to the front wall — and which of those was denied, by whom,
 * and whether it mattered, decides the call.
 *
 * The engine watches the geometry continuously and keeps the worst moment of
 * the current shot. When a player appeals, the referee rules on that record,
 * which is exactly how a human referee works: on what they saw, not on what is
 * happening the instant the hand goes up.
 */

export interface InterferenceObservation {
  /** Was the opponent in the striker's path to the ball? 0–1. */
  accessBlocked: number;
  /** Was the opponent inside the striker's swing arc? 0–1. */
  swingImpeded: number;
  /** Was the striker's view of the ball obscured? 0–1. */
  viewBlocked: number;
  /** Was the straight line from the ball to the front wall blocked? 0–1. */
  lineBlocked: number;
  /** Did the opponent make every effort to clear? 0 (none) – 1 (full effort). */
  opponentClearing: number;
  /** Did the striker make every effort to reach and play the ball? 0–1. */
  strikerEffort: number;
  /** Would the striker's return have been good? 0–1. */
  returnQuality: number;
  /** Was the striker in position to hit an outright winner? 0–1. */
  winningOpportunity: number;
  /** Did the players physically make contact? */
  physicalContact: boolean;
  /** Did the striker turn on the ball, following it round? */
  turned: boolean;
  /** Was the opponent's swing dangerously excessive? */
  dangerousSwing: boolean;
  /** Distance between the striker and the ball at the worst moment. */
  separation: number;
}

export const emptyObservation = (): InterferenceObservation => ({
  accessBlocked: 0,
  swingImpeded: 0,
  viewBlocked: 0,
  lineBlocked: 0,
  opponentClearing: 1,
  strikerEffort: 1,
  returnQuality: 0.6,
  winningOpportunity: 0,
  physicalContact: false,
  turned: false,
  dangerousSwing: false,
  separation: 2,
});

/** Overall severity of the interference, used to distinguish "minimal" from real. */
export const severityOf = (o: InterferenceObservation): number =>
  clamp01(
    Math.max(
      o.accessBlocked * 0.95,
      o.swingImpeded * 1.0,
      o.lineBlocked * 0.9,
      o.viewBlocked * 0.55,
    ) + (o.physicalContact ? 0.25 : 0),
  );

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const _seg = vec();
const _toPoint = vec();
const _closest = vec();

/**
 * Perpendicular distance from `point` to the segment a→b in the floor plane,
 * plus where along the segment the closest approach fell.
 *
 * The parameter matters as much as the distance. Clamping to the endpoints and
 * looking only at the distance treats an opponent standing *behind* the striker
 * — or already past the ball — as blocking the route between them, which is
 * how you end up awarding a let every other rally.
 */
const closestOnSegmentXZ = (point: Vec3, a: Vec3, b: Vec3): { distance: number; t: number } => {
  _seg.x = b.x - a.x;
  _seg.z = b.z - a.z;
  _seg.y = 0;
  const segLenSq = _seg.x * _seg.x + _seg.z * _seg.z;
  if (segLenSq < 1e-6) {
    return { distance: Math.hypot(point.x - a.x, point.z - a.z), t: 0 };
  }

  _toPoint.x = point.x - a.x;
  _toPoint.z = point.z - a.z;
  const raw = (_toPoint.x * _seg.x + _toPoint.z * _seg.z) / segLenSq;
  const t = clamp01(raw);
  _closest.x = a.x + _seg.x * t;
  _closest.z = a.z + _seg.z * t;
  return { distance: Math.hypot(point.x - _closest.x, point.z - _closest.z), t: raw };
};

/** True when the closest approach is genuinely *between* the two endpoints. */
const isBetween = (t: number): boolean => t > 0.12 && t < 0.94;

/** How much a body of the given radius blocks a corridor of the given width. */
const blockage = (distance: number, corridorHalfWidth: number): number =>
  clamp01(1 - (distance - PLAYER.bodyRadius) / Math.max(0.05, corridorHalfWidth));

const _frontWallPoint = vec();
const _ballDir = vec();
const _opponentDir = vec();

export interface InterferenceInputs {
  striker: PlayerState;
  opponent: PlayerState;
  ball: BallState;
  /** Where the striker is trying to make contact. */
  contact: Vec3;
  /** Where the striker was when the ball was last struck by the opponent. */
  strikerOrigin: Vec3;
  /** Elapsed time since the opponent played their shot. */
  sinceShot: number;
  /** Estimated quality of the return the striker could make. */
  returnQuality: number;
  turned: boolean;
}

/**
 * Measure the interference geometry for this instant.
 */
export const observeInterference = (input: InterferenceInputs): InterferenceObservation => {
  const { striker, opponent, ball, contact, strikerOrigin, sinceShot } = input;
  const o = emptyObservation();

  o.separation = distanceXZ(striker.pos, contact);
  o.returnQuality = input.returnQuality;
  o.turned = input.turned;

  // --- Direct access: is the opponent standing in the running line? ---------
  const path = closestOnSegmentXZ(opponent.pos, striker.pos, contact);
  // The corridor a player needs widens the further they still have to travel.
  const corridor = remap(o.separation, 0.4, 3.5, 0.26, 0.52);
  o.accessBlocked = isBetween(path.t) ? blockage(path.distance, corridor) : 0;

  // --- Swing: is the opponent inside the arc the racket must travel? --------
  const swingRadius = 1.06;
  const swingDistance = distanceXZ(opponent.pos, contact);
  o.swingImpeded = blockage(swingDistance, swingRadius - PLAYER.bodyRadius);
  // Standing behind the striker relative to the ball is much less of a problem
  // than standing on the hitting side.
  sub(_ballDir, contact, striker.pos);
  normalize(_ballDir, _ballDir);
  sub(_opponentDir, opponent.pos, striker.pos);
  const behind = dot(_opponentDir, _ballDir);
  if (behind < 0) o.swingImpeded *= 0.35;

  // --- Line to the front wall ----------------------------------------------
  // The striker is entitled to play the ball directly to the front wall. The
  // straight line is from the contact point to the front wall on the same side.
  _frontWallPoint.x = contact.x * 0.72;
  _frontWallPoint.y = 0;
  _frontWallPoint.z = 0;
  const line = closestOnSegmentXZ(opponent.pos, contact, _frontWallPoint);
  o.lineBlocked = isBetween(line.t) ? blockage(line.distance, 0.42) : 0;
  // Only counts if the opponent is genuinely in front of the contact point.
  if (opponent.pos.z > contact.z + 0.3) o.lineBlocked = 0;

  // --- View -----------------------------------------------------------------
  // The striker's sight line runs from their eyes to the ball as it comes off
  // the front wall.
  const view = closestOnSegmentXZ(opponent.pos, striker.pos, ball.pos);
  o.viewBlocked = isBetween(view.t)
    ? blockage(view.distance, 0.36) * clamp01(1 - sinceShot * 1.6)
    : 0;

  // --- Effort ---------------------------------------------------------------
  // Did the opponent move away from the ball after playing it?
  const clearingSpeed = length(opponent.vel);
  sub(_opponentDir, opponent.pos, contact);
  normalize(_opponentDir, _opponentDir);
  const movingAway = dot(
    { x: opponent.vel.x, y: 0, z: opponent.vel.z },
    _opponentDir,
  );
  o.opponentClearing = clamp01(0.25 + movingAway * 0.5 + clearingSpeed * 0.09);
  // Standing still in the middle of the court after playing a shot is the
  // definition of not making every effort to clear.
  if (clearingSpeed < 0.5 && (o.accessBlocked > 0.4 || o.lineBlocked > 0.4)) {
    o.opponentClearing = Math.min(o.opponentClearing, 0.18);
  }

  // Did the striker actually go for the ball?
  const strikerTravel = distanceXZ(striker.pos, strikerOrigin);
  const expectedTravel = Math.max(0.001, distanceXZ(strikerOrigin, contact));
  o.strikerEffort = clamp01(strikerTravel / expectedTravel + length(striker.vel) * 0.12);

  // --- Opportunity ----------------------------------------------------------
  // A striker in the front of the court, with the ball sitting up and the
  // opponent behind them, was about to win the rally.
  const attackingPosition = clamp01(1 - contact.z / COURT.shortLine);
  const ballSittingUp = clamp01((contact.y - 0.35) / 0.9);
  const opponentBehind = clamp01((opponent.pos.z - contact.z) / 2.5);
  o.winningOpportunity = clamp01(
    attackingPosition * 0.45 + ballSittingUp * 0.3 + opponentBehind * 0.35,
  );

  // --- Physical contact and danger ------------------------------------------
  o.physicalContact = distanceXZ(striker.pos, opponent.pos) < PLAYER.bodyRadius * 2.05;
  o.dangerousSwing =
    (opponent.swing.phase === 'backswing' || opponent.swing.phase === 'contact') &&
    distanceXZ(striker.pos, opponent.pos) < 1.0;

  return o;
};

/**
 * Fold a new observation into the record for this shot.
 *
 * The *geometry* is kept from the worst instant, because that is the moment a
 * referee remembers. The two *effort* measures are kept at their best value
 * over the whole shot instead, because "every effort" is a judgement about the
 * player's whole movement, not about one frame — without this, every appeal is
 * judged on the instant before the striker had even started moving, and the
 * referee wrongly rules that nobody ever tried.
 */
export const worseOf = (
  a: InterferenceObservation | null,
  b: InterferenceObservation,
): InterferenceObservation => {
  if (!a) return b;
  const worst = severityOf(b) > severityOf(a) ? b : a;
  return {
    ...worst,
    strikerEffort: Math.max(a.strikerEffort, b.strikerEffort),
    opponentClearing: Math.max(a.opponentClearing, b.opponentClearing),
    // Contact and danger are sticky: if it happened at all, it happened.
    physicalContact: a.physicalContact || b.physicalContact,
    dangerousSwing: a.dangerousSwing || b.dangerousSwing,
    turned: a.turned || b.turned,
  };
};

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface InterferenceDecision {
  decision: Extract<RallyOutcome, 'let' | 'stroke' | 'noLet'>;
  /** Referee's spoken words. */
  call: string;
  /** The rule actually applied, shown in the review overlay. */
  rule: string;
  detail: string;
  /** How marginal the call was, 0 (obvious) – 1 (coin flip). Drives review odds. */
  marginal: number;
}

/**
 * `strictness` shifts a referee between generous with strokes (0) and
 * unforgiving (1). Real referees differ and so do ours.
 */
export const decideInterference = (
  o: InterferenceObservation,
  strictness = 0.5,
): InterferenceDecision => {
  const severity = severityOf(o);
  const minimalThreshold = 0.2 + strictness * 0.18;

  // Rule 8.6.1 — no let if the return would not have been good.
  if (o.returnQuality < 0.16) {
    return {
      decision: 'noLet',
      call: 'No let',
      rule: 'WSF 8.6.1',
      detail: 'The striker would not have made a good return.',
      marginal: clamp01(o.returnQuality / 0.16) * 0.6,
    };
  }

  // Rule 8.6.3 — no let if the striker did not make every effort.
  if (o.strikerEffort < 0.32) {
    return {
      decision: 'noLet',
      call: 'No let',
      rule: 'WSF 8.6.3',
      detail: 'The striker did not make every effort to reach and play the ball.',
      marginal: clamp01(o.strikerEffort / 0.32) * 0.7,
    };
  }

  // Rule 8.6.2 — no let for minimal interference the striker could play through.
  if (severity < minimalThreshold && !o.physicalContact) {
    return {
      decision: 'noLet',
      call: 'No let',
      rule: 'WSF 8.6.2',
      detail: 'Minimal interference. The striker was able to play the ball.',
      marginal: clamp01(severity / minimalThreshold),
    };
  }

  // Rule 8.8 — stroke conditions, in the order a referee applies them.

  // Dangerous or excessive swing by the opponent.
  if (o.dangerousSwing && o.swingImpeded > 0.45) {
    return {
      decision: 'stroke',
      call: 'Stroke',
      rule: 'WSF 8.8.4',
      detail: 'Dangerous play by the opponent. Stroke to the striker.',
      marginal: 0.2,
    };
  }

  // The striker was prevented from playing the ball directly to the front wall.
  if (o.lineBlocked > 0.55) {
    return {
      decision: 'stroke',
      call: 'Stroke',
      rule: 'WSF 8.8.3',
      detail: 'The opponent prevented a return played directly to the front wall.',
      marginal: clamp01(1 - (o.lineBlocked - 0.55) / 0.35) * 0.55,
    };
  }

  // The opponent did not make every effort to avoid the interference.
  if (o.opponentClearing < 0.3 && severity > minimalThreshold + 0.1) {
    return {
      decision: 'stroke',
      call: 'Stroke',
      rule: 'WSF 8.8.1',
      detail: 'The opponent did not make every effort to avoid the interference.',
      marginal: clamp01(o.opponentClearing / 0.3) * 0.65,
    };
  }

  // The striker would have hit a winning return.
  if (o.winningOpportunity > 0.66 && severity > minimalThreshold) {
    return {
      decision: 'stroke',
      call: 'Stroke',
      rule: 'WSF 8.8.2',
      detail: 'The striker would have made a winning return.',
      marginal: clamp01(1 - (o.winningOpportunity - 0.66) / 0.3) * 0.7,
    };
  }

  // Turning: a let is the normal outcome, for safety as much as fairness.
  if (o.turned) {
    return {
      decision: 'let',
      call: 'Let',
      rule: 'WSF 8.12',
      detail: 'The striker turned. Let ball.',
      marginal: 0.35,
    };
  }

  // Rule 8.7 — otherwise, a let.
  return {
    decision: 'let',
    call: 'Let',
    rule: 'WSF 8.7',
    detail: 'Interference, and the striker could have made a good return. Yes let.',
    marginal: clamp01(1 - Math.abs(severity - 0.5) * 2) * 0.8,
  };
};

/**
 * A stroke is worth a point; a let replays the rally. Returns the rally winner
 * for a stroke, or null when the point is to be replayed.
 */
export const resolveDecision = (
  decision: InterferenceDecision,
  appellant: 0 | 1,
): 0 | 1 | null => {
  switch (decision.decision) {
    case 'stroke':
      return appellant;
    case 'noLet':
      return appellant === 0 ? 1 : 0;
    case 'let':
      return null;
  }
};
