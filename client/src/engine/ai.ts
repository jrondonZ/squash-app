import { COURT, PLAYER } from './constants';
import { clamp, clamp01, distanceXZ, length, Rng, remap, type Vec3 } from './math';
import { severityOf } from './interference';
import { backswingDuration } from './player';
import type { Character } from '../data/roster';
import type { PlayerInput, ShotType } from './types';
import { emptyInput } from './types';
import type { Simulation } from './world';
import { other } from './rules';

/**
 * The computer opponent.
 *
 * It plays the game the way a coach describes it: get to the T, read the ball,
 * choose a shot that fits the situation and your own game, and execute it under
 * whatever pressure you are under. It does not cheat — it uses the same inputs,
 * the same swing timing and the same physics as a human, and it is beatable by
 * moving it around.
 */

export type Difficulty = 'club' | 'county' | 'national' | 'pro' | 'worldClass';

interface DifficultyProfile {
  /** Seconds before the AI reacts to a new shot. */
  reaction: number;
  /** Standard deviation of swing timing error, in seconds. */
  timingError: number;
  /** Standard deviation of aim error, -1..1 units. */
  aimError: number;
  /** How well it reads deception, 0–1. */
  anticipation: number;
  /** How often it picks the tactically best shot rather than a safe one. */
  tactics: number;
  /** Fraction of top speed it actually uses when covering. */
  intensity: number;
  label: string;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyProfile> = {
  club: {
    reaction: 0.34,
    timingError: 0.055,
    aimError: 0.42,
    anticipation: 0.25,
    tactics: 0.3,
    intensity: 0.72,
    label: 'Club',
  },
  county: {
    reaction: 0.26,
    timingError: 0.04,
    aimError: 0.3,
    anticipation: 0.42,
    tactics: 0.48,
    intensity: 0.82,
    label: 'County',
  },
  national: {
    reaction: 0.2,
    timingError: 0.028,
    aimError: 0.2,
    anticipation: 0.6,
    tactics: 0.66,
    intensity: 0.9,
    label: 'National',
  },
  pro: {
    reaction: 0.15,
    timingError: 0.019,
    aimError: 0.13,
    anticipation: 0.76,
    tactics: 0.82,
    intensity: 0.96,
    label: 'PSA Tour',
  },
  worldClass: {
    reaction: 0.11,
    timingError: 0.012,
    aimError: 0.085,
    anticipation: 0.9,
    tactics: 0.94,
    intensity: 1,
    label: 'World Class',
  },
};

export class SquashAI {
  private profile: DifficultyProfile;
  private rng: Rng;
  private index: 0 | 1;
  private character: Character;

  /** Time left before the AI has processed the current shot. */
  private reactionTimer = 0;
  /** Tick of the last shot the AI reacted to, so it reacts exactly once. */
  private lastReactedShot = -1;
  /** Shot the AI has committed to for this rally exchange. */
  private plannedShot: ShotType = 'drive';
  private plannedAimX = 0;
  private plannedAimY = 0;
  /** Seconds until the AI should start its backswing. */
  private swingTimer = Number.POSITIVE_INFINITY;
  private swinging = false;
  private held = 0;
  private serveDelay = 0;
  /** One appeal per shot at most. */
  private appealedThisShot = false;

  constructor(index: 0 | 1, character: Character, difficulty: Difficulty, seed: number) {
    this.index = index;
    this.character = character;
    this.profile = DIFFICULTIES[difficulty];
    this.rng = new Rng(seed);
    this.serveDelay = this.rng.range(0.8, 1.8);
  }

  /** Produce this tick's input. */
  think(sim: Simulation, dt: number): PlayerInput {
    const input = emptyInput();
    const state = sim.state;
    const me = state.players[this.index];
    const opponent = state.players[other(this.index)];

    switch (state.rally.phase) {
      case 'preServe': {
        if (state.rally.server !== this.index) {
          // Take up the receiving position and wait.
          const target = {
            x: -state.rally.serveSide * 2.15,
            z: COURT.shortLine + 1.6,
          };
          this.moveToward(input, me.pos, target, 0.75);
          return input;
        }
        this.serveDelay -= dt;
        if (this.serveDelay <= 0) {
          input.serve = true;
          // Most professionals lob serve; the aggressive ones mix in a hard one.
          const hard = this.rng.chance(this.character.aggression * 0.35);
          input.shot = hard ? 'drive' : 'lob';
          input.aimX = this.rng.noise(0.35);
          input.aimY = this.rng.noise(0.4);
          input.swingHeld = hard;
          this.serveDelay = this.rng.range(0.9, 2.0);
        }
        return input;
      }

      case 'inPlay':
        return this.playRally(sim, input, dt);

      case 'appealing':
      case 'review':
      case 'rallyOver':
      case 'betweenGames': {
        // Walk back towards the T between rallies.
        this.moveToward(input, me.pos, PLAYER.tPosition, 0.4);
        this.reset();
        return input;
      }

      default:
        void opponent;
        return input;
    }
  }

  private reset(): void {
    this.swingTimer = Number.POSITIVE_INFINITY;
    this.swinging = false;
    this.held = 0;
    this.lastReactedShot = -1;
    this.appealedThisShot = false;
  }

  private playRally(sim: Simulation, input: PlayerInput, dt: number): PlayerInput {
    const state = sim.state;
    const me = state.players[this.index];
    const opponent = state.players[other(this.index)];
    const ball = state.ball;
    const amStriker = sim.strikerIndex() === this.index;

    if (!amStriker) {
      // Clear to the T — and clearing properly is what avoids conceding strokes.
      this.reset();
      const clearTarget = this.chooseClearingPosition(sim);
      this.moveToward(input, me.pos, clearTarget, this.profile.intensity * 0.92);
      return input;
    }

    // React to the opponent's shot once, after a reaction delay.
    if (this.lastReactedShot !== state.rally.shotCount) {
      this.lastReactedShot = state.rally.shotCount;
      const deceptionPenalty =
        (this.opponentDeception(sim) / 100) * (1 - this.profile.anticipation) * 0.22;
      this.reactionTimer = this.profile.reaction + deceptionPenalty + this.rng.noise(0.03);
      this.swinging = false;
      this.held = 0;
      this.swingTimer = Number.POSITIVE_INFINITY;
      this.appealedThisShot = false;
    }

    if (this.reactionTimer > 0) {
      this.reactionTimer -= dt;
      // Still holds a court position while reading the ball.
      this.moveToward(input, me.pos, PLAYER.tPosition, 0.35);
      return input;
    }

    const interception = sim.interceptionFor(this.index);

    // Take it early or let it bounce? Volleying is the aggressive option: it
    // buys time off the opponent but demands a cleaner contact, so how often
    // the AI does it tracks the character's volley rating.
    let contact = interception.afterBounce ?? interception.bounce ?? {
      pos: interception.pos,
      time: interception.time,
    };
    if (interception.volley) {
      const appetite = (this.character.attributes.volley / 100) * 0.75 + this.character.aggression * 0.3;
      const canGetThere = this.canCover(me.pos, interception.volley.pos, interception.volley.time);
      if (canGetThere && this.rng.chance(clamp01(appetite))) contact = interception.volley;
    }
    const target: Vec3 = contact.pos;

    // Stand just behind the contact point so the racket comes through the ball.
    const approach = {
      x: clamp(target.x - Math.sign(target.x || 1) * 0.26, -COURT.halfWidth + 0.3, COURT.halfWidth - 0.3),
      z: clamp(target.z + 0.36, 0.4, COURT.length - 0.4),
    };
    this.moveToward(input, me.pos, approach, this.profile.intensity);

    // Plan the shot as soon as the ball is committed.
    if (this.swingTimer === Number.POSITIVE_INFINITY) {
      const plan = this.chooseShot(sim, target);
      this.plannedShot = plan.shot;
      this.plannedAimX = plan.aimX;
      this.plannedAimY = plan.aimY;

      // Start the backswing so that contact lands in the window.
      const lead = backswingDuration(this.character, this.plannedShot);
      this.swingTimer = contact.time - lead - PLAYER.contactWindow * 0.5;
      this.swingTimer += this.rng.gaussian(0, this.profile.timingError);
    }

    input.shot = this.plannedShot;
    input.aimX = clamp(this.plannedAimX + this.rng.gaussian(0, this.profile.aimError * 0.3), -1, 1);
    input.aimY = clamp(this.plannedAimY + this.rng.gaussian(0, this.profile.aimError * 0.3), -1, 1);

    const distance = distanceXZ(me.pos, target);
    input.lunge = distance > PLAYER.reach * 0.85;

    if (!this.swinging) {
      this.swingTimer -= dt;
      if (this.swingTimer <= 0) {
        this.swinging = true;
        input.swingPressed = true;
        this.held = 0;
      }
    }

    if (this.swinging) {
      // Power commitment: attacking shots are loaded, touch shots are not.
      const wantsPower =
        this.plannedShot === 'kill' ||
        this.plannedShot === 'drive' ||
        this.plannedShot === 'crossCourt' ||
        this.plannedShot === 'volley';
      const holdTarget = wantsPower ? 0.34 : 0.06;
      this.held += dt;
      input.swingHeld = this.held < holdTarget;
    }

    // Appeal for a let when genuinely blocked — some characters far more than others.
    if (this.shouldAppeal(sim, dt)) input.appeal = true;

    void ball;
    void opponent;
    return input;
  }

  /**
   * Where to stand while the opponent plays.
   *
   * "Clear to the T" is the coaching cliché, but taken literally it concedes a
   * stroke every time the opponent's ball is also near the middle. What a good
   * player actually does is get as close to the T as they can *while* staying
   * out of two lines: the opponent's run to the ball, and the ball's path to
   * the front wall. So that is what this does — sample positions around the T
   * and take the best compromise.
   */
  private chooseClearingPosition(sim: Simulation): { x: number; z: number } {
    const state = sim.state;
    const opponent = state.players[other(this.index)];
    const t = PLAYER.tPosition;

    const interception = sim.interceptionFor(other(this.index));
    const contact = interception.reachable ? interception.pos : state.ball.pos;
    // The line the opponent will play the ball down to the front wall.
    const frontWallPoint = { x: contact.x * 0.72, y: 0, z: 0 };

    let best: { x: number; z: number } = { x: t.x, z: t.z };
    let bestScore = -Infinity;

    const radii = [0, 0.55, 1.05, 1.55];
    const arms = 10;
    for (const radius of radii) {
      for (let a = 0; a < (radius === 0 ? 1 : arms); a++) {
        const angle = (a / arms) * Math.PI * 2;
        const candidate = {
          x: clamp(t.x + Math.cos(angle) * radius, -COURT.halfWidth + 0.35, COURT.halfWidth - 0.35),
          z: clamp(t.z + Math.sin(angle) * radius, 0.6, COURT.length - 0.5),
        };
        const point = { x: candidate.x, y: 0, z: candidate.z };

        // Clearance from the opponent's run to the ball.
        const runClearance = distanceToSegment(point, opponent.pos, contact);
        // Clearance from the ball's line to the front wall.
        const lineClearance = distanceToSegment(point, contact, frontWallPoint);
        // Do not stand on top of them either.
        const bodyClearance = distanceXZ(point, opponent.pos);

        const score =
          Math.min(runClearance, 1.5) * 1.0 +
          Math.min(lineClearance, 1.3) * 1.15 +
          Math.min(bodyClearance, 1.6) * 0.5 -
          // All else equal, be near the T.
          Math.hypot(candidate.x - t.x, candidate.z - t.z) * 0.62;

        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
    }
    return best;
  }

  /**
   * Shot selection.
   *
   * The tactical rules are the ones every coach teaches: length when you are
   * under pressure, attack when the ball sits up in the front, move them to the
   * opposite corner from where they are standing, and boast when you are stuck
   * in the back with nothing else on.
   */
  private chooseShot(sim: Simulation, contact: Vec3): { shot: ShotType; aimX: number; aimY: number } {
    const state = sim.state;
    const me = state.players[this.index];
    const opponent = state.players[other(this.index)];
    const attrs = this.character.attributes;

    // Court zones. The front court that actually justifies an attacking shot is
    // the first third — not everything in front of the short line, which is
    // over half the floor and would have the AI dropping from the middle.
    const front = contact.z < 3.4;
    const midCourt = contact.z >= 3.4 && contact.z <= 6.3;
    const deep = contact.z > 6.3;
    const veryDeep = contact.z > COURT.length - 1.9;
    const ballHigh = contact.y > 0.85;
    const underPressure = distanceXZ(me.pos, contact) > PLAYER.reach * 0.8;
    const stamina = me.stamina / PLAYER.maxStamina;

    // Which side of the court is the opponent guarding?
    const opponentSide = Math.sign(opponent.pos.x || 1);
    const opponentDeep = opponent.pos.z > COURT.shortLine + 0.5;
    const opponentFront = opponent.pos.z < COURT.shortLine - 0.4;
    const mySide = Math.sign(contact.x || 1);

    // Score every option, then take the best — with a chance of the safe one
    // instead, scaled by the difficulty's tactical rating.
    const options: Array<{ shot: ShotType; score: number; aimX: number; aimY: number }> = [];

    const push = (shot: ShotType, score: number, aimX = 0, aimY = 0) =>
      options.push({ shot, score, aimX, aimY });

    // Straight length — the bread and butter, and the default in real squash.
    // Roughly two thirds of professional shots are simply a good length.
    push(
      'drive',
      1.0 + (opponentFront ? 0.35 : 0) + (underPressure ? 0.35 : 0) + (deep ? 0.25 : 0),
      0,
      0.1,
    );

    // Cross-court to move them off the wall they are guarding.
    push('crossCourt', 0.78 + (opponentSide === mySide ? 0.3 : -0.2) + (deep ? 0.1 : 0), 0, 0.1);

    // Lob to reset when stretched, especially from the front.
    push(
      'lob',
      (underPressure ? 0.75 : 0.3) +
        (front ? 0.25 : 0) +
        (stamina < 0.45 ? 0.25 : 0) +
        (attrs.touch / 100) * 0.2,
      0,
      0.3,
    );

    // Drop — genuinely on only from the front, with the opponent behind you and
    // no pressure on the shot. From anywhere else it is the losing option.
    if (!deep) {
      push(
        'drop',
        (front ? 0.72 : midCourt ? 0.05 : -0.4) +
          (opponentDeep ? 0.35 : -0.5) +
          (attrs.touch / 100) * 0.3 +
          this.character.aggression * 0.2 -
          (underPressure ? 0.7 : 0),
        0,
        -0.15,
      );
    }

    // Kill / nick when the ball sits up and they are out of position.
    if (ballHigh && !deep) {
      push(
        'kill',
        (front ? 0.62 : 0.1) +
          (opponentDeep ? 0.3 : -0.35) +
          (attrs.power / 100) * 0.3 +
          this.character.aggression * 0.25 -
          (underPressure ? 0.8 : 0),
        0,
        -0.2,
      );
      push(
        'nick',
        (front ? 0.5 : -0.1) +
          (attrs.touch / 100) * 0.3 +
          this.character.aggression * 0.2 -
          (underPressure ? 0.85 : 0) -
          0.15,
        0,
        -0.1,
      );
    }

    // Boast — the escape shot from the back corner.
    if (veryDeep) {
      push('boast', 0.35 + (underPressure ? 0.45 : 0) - (attrs.retrieval / 100) * 0.2, 0, 0.1);
    }

    // Volley: taking it early is a decision, not a shot shape, but the engine
    // models it as its own profile because the contact and pace differ.
    if (contact.y > 0.95 && state.ball.floorBounces === 0) {
      push(
        'volley',
        0.3 + (attrs.volley / 100) * 0.45 + (opponentDeep ? 0.15 : 0),
        0,
        0,
      );
    }

    // Deception: a hold-and-flick, if this character does that sort of thing.
    if (!underPressure && this.rng.chance(this.character.holdFrequency * 0.35)) {
      push('flick', 0.4 + (attrs.deception / 100) * 0.5, 0, 0.1);
    }

    // Signature shot bonus — characters play like themselves.
    for (const option of options) {
      if (option.shot === this.character.signatureShot) option.score += 0.18;
      option.score += this.rng.noise(0.12);
    }

    options.sort((a, b) => b.score - a.score);

    // Tactical discipline: sometimes take the safe option instead of the best.
    const takeBest = this.rng.chance(this.profile.tactics);
    const chosen = takeBest
      ? options[0]
      : options.find((o) => o.shot === 'drive' || o.shot === 'lob') ?? options[0];

    // Aim into the corner furthest from the opponent.
    const aimX = clamp(chosen.aimX - opponentSide * 0.35 * (chosen.shot === 'crossCourt' ? -1 : 1), -1, 1);

    return { shot: chosen.shot, aimX, aimY: chosen.aimY };
  }

  /**
   * Decide whether to put a hand up.
   *
   * At most one appeal per shot, and the roll is a rate per second scaled by
   * `dt` — appealing is a decision a player makes once when they feel blocked,
   * not something they reconsider sixty times a second.
   */
  private shouldAppeal(sim: Simulation, dt: number): boolean {
    const state = sim.state;
    if (state.rally.appeal) return false;
    if (state.rally.shotCount < 2) return false;
    if (this.appealedThisShot) return false;

    const record = sim.interferenceFor(this.index);
    if (!record) return false;

    const severity = severityOf(record);
    if (severity < 0.7) return false;
    // A player who is not really going for the ball knows they will get no let.
    if (record.strikerEffort < 0.45) return false;

    // Expected appeals per second while genuinely blocked, before temperament.
    const rate = this.character.appealTendency * remap(severity, 0.7, 1, 0.15, 0.85);
    if (!this.rng.chance(clamp01(rate * dt))) return false;

    this.appealedThisShot = true;
    return true;
  }

  private opponentDeception(sim: Simulation): number {
    const opponentIndex = other(this.index);
    return sim.characters[opponentIndex].attributes.deception;
  }

  /** Can this player physically cover the ground to `target` in `time`? */
  private canCover(from: Vec3, target: Vec3, time: number): boolean {
    const topSpeed = PLAYER.baseMaxSpeed * (0.82 + (this.character.attributes.speed / 100) * 0.34);
    return distanceXZ(from, target) <= topSpeed * time * this.profile.intensity + PLAYER.reach;
  }

  private moveToward(
    input: PlayerInput,
    from: Vec3,
    target: { readonly x: number; readonly z: number },
    intensity: number,
  ): void {
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.12) {
      input.moveX = 0;
      input.moveZ = 0;
      return;
    }
    // Ease off as the target is approached so the AI does not oscillate.
    const gain = clamp01(distance / 0.65) * intensity;
    input.moveX = (dx / distance) * gain;
    input.moveZ = (dz / distance) * gain;
  }
}

/** Perpendicular distance from a point to a segment, in the floor plane. */
const distanceToSegment = (p: Vec3, a: Vec3, b: Vec3): number => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-6) return Math.hypot(p.x - a.x, p.z - a.z);
  const t = clamp01(((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq);
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
};

export const difficultyLabel = (d: Difficulty): string => DIFFICULTIES[d].label;

/** Rough strength estimate used to seed online matchmaking and the ladder. */
export const aiRating = (character: Character, difficulty: Difficulty): number => {
  const p = DIFFICULTIES[difficulty];
  const base =
    (character.attributes.accuracy + character.attributes.speed + character.attributes.touch) / 3;
  return Math.round(base * (0.6 + p.tactics * 0.5) * (0.8 + p.anticipation * 0.35));
};

export const clampInput = (input: PlayerInput): PlayerInput => {
  const mag = Math.hypot(input.moveX, input.moveZ);
  if (mag > 1) {
    input.moveX /= mag;
    input.moveZ /= mag;
  }
  input.aimX = clamp(input.aimX, -1, 1);
  input.aimY = clamp(input.aimY, -1, 1);
  return input;
};

void length;
