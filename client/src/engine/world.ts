import {
  BALL,
  COURT,
  PLAYER,
  RULES,
  SIM,
  serviceBox,
} from './constants';
import {
  clamp01,
  distanceXZ,
  hashString,
  length,
  Rng,
  set,
  vec,
  type Vec3,
} from './math';
import {
  coolBall,
  createBall,
  markStruck,
  predictInterception,
  stepBall,
  type Interception,
} from './ball';
import { characterById, type Character } from '../data/roster';
import {
  applyRecoil,
  canReachBall,
  contactPoint,
  createPlayer,
  faceBall,
  movePlayer,
  recoverStamina,
  reachOf,
  separatePlayers,
  stretchFactor,
  timingQuality,
  updateSwing,
} from './player';
import { executeServe, executeShot, type ShotResult } from './shots';
import {
  awardRally,
  checkFootPosition,
  checkServeFrontWall,
  checkServeLanding,
  estimateReturnQuality,
  isGameBall,
  isMatchBall,
  other,
  ruleOnBodyContact,
  ruleOnDeadBall,
  SERVE_FAULT_TEXT,
  startNextGame,
  type ServeFault,
} from './rules';
import {
  emptyObservation,
  observeInterference,
  severityOf,
  worseOf,
  type InterferenceObservation,
} from './interference';
import {
  createRefereeState,
  profileFor,
  requestReview,
  resetReviews,
  ruleOnAppeal,
  type RefereeRuling,
  type RefereeState,
} from './referee';
import type {
  PlayerInput,
  RallyOutcome,
  SimEvent,
  WorldState,
} from './types';

export interface WorldConfig {
  seed: string | number;
  characters: [string, string];
  refereeId?: string;
  /** Tour tin (0.43) by default. */
  tinHeight?: number;
  /** Start the ball warm to skip the knock-up. */
  warmBall?: boolean;
  /** Shorter games for a quick match. */
  pointsToWin?: number;
}

/**
 * The simulation.
 *
 * `step()` advances exactly one 60 Hz tick from a pair of inputs and returns
 * the events that happened. Nothing in here touches the DOM, three.js, the
 * clock or Math.random — the renderer, the commentary, the audio and the
 * netcode are all downstream consumers of the event stream and the state.
 */
export class Simulation {
  state: WorldState;
  referee: RefereeState;
  characters: [Character, Character];
  private rng: Rng;

  /** Worst interference seen during the current shot, per potential appellant. */
  private interference: [InterferenceObservation | null, InterferenceObservation | null] = [
    null,
    null,
  ];
  /** Where each player stood when the opponent last struck the ball. */
  private shotOrigins: [Vec3, Vec3] = [vec(), vec()];
  /** Seconds since the ball was last struck. */
  private sinceShot = 0;
  /** Pending referee ruling awaiting a possible video review. */
  private pendingRuling: RefereeRuling | null = null;
  /** Shot type of the last stroke played, for the commentary. */
  private lastShot: ShotResult | null = null;
  private lastShotType: PlayerInput['shot'] = 'drive';
  /** Set when the ball has come off the back wall, for turning detection. */
  private ballWentPastStriker = false;
  private pointsToWin: number;

  constructor(config: WorldConfig) {
    const seed =
      typeof config.seed === 'string' ? hashString(config.seed) : config.seed >>> 0;
    this.rng = new Rng(seed);
    this.pointsToWin = config.pointsToWin ?? RULES.pointsToWinGame;

    this.characters = [
      characterById(config.characters[0]),
      characterById(config.characters[1]),
    ];

    const ball = createBall();
    if (config.warmBall) ball.temperature = BALL.tempHot - 4;

    this.state = {
      tick: 0,
      time: 0,
      ball,
      players: [createPlayer(0, config.characters[0]), createPlayer(1, config.characters[1])],
      rally: {
        phase: 'preServe',
        phaseTime: 0,
        server: 0,
        serveSide: 1,
        serveSideChosen: false,
        shotCount: 0,
        duration: 0,
        outcome: null,
        winner: null,
        rallyIndex: 0,
        appeal: null,
        serveInFlight: false,
        pendingFault: null,
      },
      match: {
        gameIndex: 0,
        games: [0, 0],
        completedGames: [],
        elapsed: 0,
        winner: null,
        tinHeight: config.tinHeight ?? COURT.tinHeightTour,
        totalRallies: 0,
      },
      rngState: this.rng.getState(),
    };

    this.referee = createRefereeState(config.refereeId ?? 'central');
    this.placeForServe();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Advance one tick. Returns every event generated during it. */
  step(inputs: [PlayerInput, PlayerInput]): SimEvent[] {
    const events: SimEvent[] = [];
    const dt = SIM.tickDelta;
    const s = this.state;

    s.tick += 1;
    s.time += dt;
    s.rally.phaseTime += dt;
    if (s.rally.phase === 'inPlay') {
      s.match.elapsed += dt;
      s.rally.duration += dt;
      this.sinceShot += dt;
    }

    switch (s.rally.phase) {
      case 'preServe':
        this.stepPreServe(inputs, events, dt);
        break;
      case 'inPlay':
        this.stepInPlay(inputs, events, dt);
        break;
      case 'rallyOver':
        this.stepRallyOver(events, dt);
        break;
      case 'appealing':
        this.stepAppealing(inputs, events, dt);
        break;
      case 'review':
        this.stepReview(events, dt);
        break;
      case 'betweenGames':
        this.stepBetweenGames(events, dt);
        break;
      case 'matchOver':
        break;
      default:
        break;
    }

    // The ball is always losing heat to the air and the walls; during a rally it
    // simply gains it faster than it loses it. Cooling only between rallies
    // would let the temperature — and with it the bounce — run away over a long
    // match instead of settling at a playing equilibrium.
    coolBall(s.ball, dt);

    s.rngState = this.rng.getState();
    return events;
  }

  /** Deep copy of the state, for snapshots and the replay recorder. */
  snapshot(): WorldState {
    const s = this.state;
    return {
      tick: s.tick,
      time: s.time,
      ball: {
        ...s.ball,
        pos: { ...s.ball.pos },
        vel: { ...s.ball.vel },
        spin: { ...s.ball.spin },
        wallsSinceStrike: [...s.ball.wallsSinceStrike],
      },
      players: s.players.map((p) => ({
        ...p,
        pos: { ...p.pos },
        vel: { ...p.vel },
        swing: { ...p.swing },
        gameScores: [...p.gameScores],
        conductRecord: [...p.conductRecord],
      })) as WorldState['players'],
      rally: { ...s.rally, appeal: s.rally.appeal ? { ...s.rally.appeal } : null },
      match: {
        ...s.match,
        games: [...s.match.games] as [number, number],
        completedGames: s.match.completedGames.map((g) => [...g] as [number, number]),
      },
      rngState: s.rngState,
    };
  }

  /** Overwrite state from a snapshot — used by the guest in an online match. */
  restore(snap: WorldState): void {
    this.state = snap;
    this.rng.setState(snap.rngState);
  }

  /** The referee's current view of the last incident, for the review overlay. */
  currentRuling(): RefereeRuling | null {
    return this.pendingRuling;
  }

  /** The player whose turn it is to strike. */
  strikerIndex(): 0 | 1 {
    const last = this.state.ball.lastStriker;
    if (last === null) return this.state.rally.server;
    return other(last);
  }

  // -------------------------------------------------------------------------
  // Phases
  // -------------------------------------------------------------------------

  private placeForServe(): void {
    const s = this.state;
    const server = s.players[s.rally.server];
    const receiver = s.players[other(s.rally.server)];
    const box = serviceBox(s.rally.serveSide);

    set(server.pos, (box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2);
    set(server.vel, 0, 0, 0);
    server.hasBall = true;
    server.swing.phase = 'idle';

    // The receiver stands in the quarter they are about to receive in.
    const receivingSign = -s.rally.serveSide;
    set(receiver.pos, receivingSign * 2.2, 0, COURT.shortLine + 1.5);
    set(receiver.vel, 0, 0, 0);
    receiver.swing.phase = 'idle';

    const ball = s.ball;
    set(ball.pos, server.pos.x + s.rally.serveSide * -0.35, 0.95, server.pos.z - 0.2);
    set(ball.vel, 0, 0, 0);
    set(ball.spin, 0, 0, 0);
    ball.live = false;
    ball.lastStriker = null;
    ball.floorBounces = 0;
    ball.hitFrontWall = false;
    ball.wallsSinceStrike = [];

    s.rally.serveInFlight = false;
    s.rally.pendingFault = null;
    s.rally.shotCount = 0;
    s.rally.duration = 0;
    s.rally.outcome = null;
    s.rally.winner = null;
    s.rally.appeal = null;
    this.interference = [null, null];
    this.sinceShot = 0;
    this.ballWentPastStriker = false;
    this.pendingRuling = null;
  }

  private stepPreServe(inputs: [PlayerInput, PlayerInput], events: SimEvent[], dt: number): void {
    const s = this.state;
    const serverIndex = s.rally.server;

    for (let i = 0; i < 2; i++) {
      const idx = i as 0 | 1;
      const player = s.players[idx];
      recoverStamina(player, this.characters[idx], dt);
      // The server may shuffle inside the box; the receiver may take position.
      movePlayer(player, this.characters[idx], inputs[idx], dt);
    }

    // Keep the ball in the server's hand.
    const server = s.players[serverIndex];
    set(s.ball.pos, server.pos.x + s.rally.serveSide * -0.32, 0.95, server.pos.z - 0.2);

    const input = inputs[serverIndex];
    if (!input.serve && !input.swingPressed) return;

    // Foot fault check happens at the moment of striking.
    const legalStance = checkFootPosition(server.pos, s.rally.serveSide);
    const contact = vec(server.pos.x + s.rally.serveSide * -0.42, 1.0, server.pos.z - 0.15);

    const style: 'lob' | 'hard' | 'bodyLine' =
      input.shot === 'kill' || input.shot === 'drive'
        ? 'hard'
        : input.shot === 'boast'
          ? 'bodyLine'
          : 'lob';

    const result = executeServe({
      contact,
      character: this.characters[serverIndex],
      side: s.rally.serveSide,
      style,
      aimX: input.aimX,
      aimY: input.aimY,
      power: clamp01(input.swingHeld ? 0.75 : 0.5),
      rng: this.rng,
    });

    set(s.ball.pos, contact.x, contact.y, contact.z);
    set(s.ball.vel, result.vel.x, result.vel.y, result.vel.z);
    set(s.ball.spin, result.spin.x, result.spin.y, result.spin.z);
    markStruck(s.ball, serverIndex);
    server.hasBall = false;

    s.rally.serveInFlight = true;
    s.rally.serveSideChosen = true;
    s.rally.shotCount = 1;
    s.rally.phase = 'inPlay';
    s.rally.phaseTime = 0;
    s.rally.rallyIndex += 1;
    this.sinceShot = 0;
    this.lastShot = result;
    this.lastShotType = 'serve';
    this.captureShotOrigins();

    if (!legalStance) {
      s.rally.pendingFault = 'footFault';
    }

    events.push({
      type: 'serve',
      player: serverIndex,
      side: s.rally.serveSide,
      legal: legalStance,
      reason: legalStance ? undefined : SERVE_FAULT_TEXT.footFault,
    });
    events.push({ type: 'rallyStart', server: serverIndex });
  }

  private captureShotOrigins(): void {
    for (let i = 0; i < 2; i++) {
      const p = this.state.players[i];
      set(this.shotOrigins[i], p.pos.x, p.pos.y, p.pos.z);
    }
  }

  private stepInPlay(inputs: [PlayerInput, PlayerInput], events: SimEvent[], dt: number): void {
    const s = this.state;
    const striker = this.strikerIndex();

    // --- Players ------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const idx = i as 0 | 1;
      const player = s.players[idx];
      const character = this.characters[idx];
      const input = inputs[idx];

      movePlayer(player, character, input, dt);
      faceBall(player, s.ball, dt);

      const isStriker = idx === striker;
      const swingUpdate = updateSwing(player, character, input, s.ball, dt, true);

      if (swingUpdate.missed) events.push({ type: 'swingMiss', player: idx });

      if (swingUpdate.contactNow && s.ball.live) {
        const lunging = player.swing.lunging;
        if (canReachBall(player, character, s.ball, lunging)) {
          // Striking a ball that has already bounced twice does not save it,
          // but the rules only care once the ball is dead.
          this.strike(idx, isStriker, events);
        }
      }
    }

    separatePlayers(s.players[0], s.players[1], dt);

    // --- Appeals ------------------------------------------------------------
    for (let i = 0; i < 2; i++) {
      const idx = i as 0 | 1;
      if (inputs[idx].appeal && s.rally.appeal === null) {
        this.raiseAppeal(idx, 'interference', events);
        return;
      }
    }

    // --- Interference watch -------------------------------------------------
    this.observe(striker);

    // --- Ball ---------------------------------------------------------------
    const before = { ...s.ball.pos };
    const fatal = stepBall(s.ball, dt, s.match.tinHeight, events);
    this.checkBodyContact(before, events);
    this.checkServeLegality(events);

    if (this.state.rally.phase !== 'inPlay') return;

    if (fatal === 'out') {
      this.endRallyFromDeadBall('out', events);
      return;
    }
    if (fatal === 'tin') {
      this.endRallyFromDeadBall('tin', events);
      return;
    }

    // Not up: the ball touched the floor without reaching the front wall.
    if (!s.ball.hitFrontWall && s.ball.floorBounces >= 1 && s.ball.lastStriker !== null) {
      this.endRallyFromDeadBall('floorBeforeFront', events);
      return;
    }

    // Double bounce: the receiver failed to get there.
    if (s.ball.floorBounces >= 2) {
      // A pending service fault the receiver never attempted now applies.
      if (s.rally.pendingFault) {
        this.applyServeFault(s.rally.pendingFault, events);
        return;
      }
      this.endRallyFromDeadBall('doubleBounce', events);
      return;
    }

    // Track whether the ball has gone behind the striker, for turning calls.
    const strikerPlayer = s.players[striker];
    if (s.ball.pos.z > strikerPlayer.pos.z + 0.4 && s.ball.wallsSinceStrike.includes('back')) {
      this.ballWentPastStriker = true;
    }
  }

  /** Execute a racket strike. */
  private strike(playerIndex: 0 | 1, isStriker: boolean, events: SimEvent[]): void {
    const s = this.state;
    const player = s.players[playerIndex];
    const character = this.characters[playerIndex];

    // Hitting the ball twice in a row is a double hit and loses the rally.
    if (s.ball.lastStriker === playerIndex && s.rally.shotCount > 0) {
      s.rally.outcome = 'carry';
      this.finishRally(other(playerIndex), 'carry', 'Not up', 'Double hit.', events);
      return;
    }

    const contact = vec();
    contactPoint(s.ball, contact);

    const stretch = stretchFactor(player, character, s.ball.pos, player.swing.lunging);
    const timing = timingQuality(player.swing, character);

    const result = executeShot({
      shot: player.swing.type,
      contact,
      ball: s.ball,
      character,
      aimX: player.swing.aimX,
      aimY: player.swing.aimY,
      power: player.swing.power,
      timing,
      stamina: player.stamina / PLAYER.maxStamina,
      stretch,
      rng: this.rng,
      tinHeight: s.match.tinHeight,
    });

    set(s.ball.pos, contact.x, Math.max(contact.y, BALL.radius + 0.01), contact.z);
    set(s.ball.vel, result.vel.x, result.vel.y, result.vel.z);
    set(s.ball.spin, result.spin.x, result.spin.y, result.spin.z);
    markStruck(s.ball, playerIndex);

    player.swing.phase = 'recovery';
    player.swing.elapsed = 0;
    applyRecoil(player, stretch);

    // A returned service is deemed good under WSF 6.8, whatever the fault was.
    if (s.rally.serveInFlight && !isStrikerServer(s.rally.server, playerIndex)) {
      s.rally.serveInFlight = false;
      s.rally.pendingFault = null;
    }

    s.rally.shotCount += 1;
    this.sinceShot = 0;
    this.interference = [null, null];
    this.ballWentPastStriker = false;
    this.lastShot = result;
    this.lastShotType = player.swing.type;
    this.captureShotOrigins();

    void isStriker;

    events.push({
      type: 'racketHit',
      player: playerIndex,
      shot: player.swing.type,
      quality: result.quality,
      speed: length(result.vel),
      pos: { ...contact },
    });
  }

  /** Did the ball strike a player? */
  private checkBodyContact(before: Vec3, events: SimEvent[]): void {
    const s = this.state;
    if (!s.ball.live) return;
    const striker = s.ball.lastStriker;
    if (striker === null) return;

    const victimIndex = other(striker);
    const victim = s.players[victimIndex];

    // Sample the ball's path this tick against the victim's body capsule.
    const samples = 4;
    let hit = false;
    const contact = vec();
    for (let i = 1; i <= samples; i++) {
      const t = i / samples;
      const px = before.x + (s.ball.pos.x - before.x) * t;
      const py = before.y + (s.ball.pos.y - before.y) * t;
      const pz = before.z + (s.ball.pos.z - before.z) * t;
      if (py > PLAYER.height || py < 0.1) continue;
      const d = Math.hypot(px - victim.pos.x, pz - victim.pos.z);
      if (d < PLAYER.bodyRadius + BALL.radius) {
        hit = true;
        set(contact, px, py, pz);
        break;
      }
    }
    if (!hit) return;

    // Would the return have been good had it not struck the opponent?
    const strikerPlayer = s.players[striker];
    const returnQuality = estimateReturnQuality(contact, strikerPlayer.pos, length(s.ball.vel));
    // A ball travelling towards the front wall and above tin height was going in.
    const headingToFront = s.ball.vel.z < -1;
    const wouldHaveBeenGood = headingToFront && returnQuality > 0.25;

    const ruling = ruleOnBodyContact(
      striker,
      victimIndex,
      s.ball,
      wouldHaveBeenGood,
      this.ballWentPastStriker,
    );

    s.ball.live = false;
    set(s.ball.vel, 0, 0, 0);

    events.push({
      type: 'hitOpponent',
      striker,
      struck: victimIndex,
      pos: { ...contact },
      wouldHaveBeenGood,
    });

    if (ruling.outcome === 'let') {
      this.replayPoint('Let ball — the ball struck the opponent after the front wall.', events);
      return;
    }
    this.finishRally(ruling.winner, ruling.outcome, ruling.call, ruling.detail, events);
  }

  /** Watch a service in flight for the various ways it can be a fault. */
  private checkServeLegality(events: SimEvent[]): void {
    const s = this.state;
    if (!s.rally.serveInFlight) return;

    const walls = s.ball.wallsSinceStrike;

    // The service must travel directly to the front wall.
    if (walls.length > 0 && walls[0] !== 'front' && !s.rally.pendingFault) {
      s.rally.pendingFault = 'short';
    }

    // Height on the front wall. `stepBall` already turned an out or a tin into
    // a fatal outcome, so what is left is the cut line.
    if (s.ball.hitFrontWall && !s.rally.pendingFault) {
      const frontHit = this.lastFrontWallHeight(events);
      if (frontHit !== null) {
        const fault = checkServeFrontWall(frontHit, s.match.tinHeight);
        if (fault) s.rally.pendingFault = fault;
      }
    }

    // Landing quarter, checked on the first bounce.
    if (s.ball.hitFrontWall && s.ball.floorBounces === 1 && !s.rally.pendingFault) {
      const landing = this.lastFloorContact(events);
      if (landing) {
        const fault = checkServeLanding(landing, s.rally.serveSide);
        if (fault) s.rally.pendingFault = fault;
      }
      // Whether or not it was a fault, the service is over once it bounces and
      // the receiver's opportunity to deem it good is nearly gone.
    }
  }

  private lastFrontWallHeight(events: SimEvent[]): number | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'ballWall' && e.wall === 'front') return e.pos.y;
    }
    return null;
  }

  private lastFloorContact(events: SimEvent[]): Vec3 | null {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'ballFloor') return e.pos;
    }
    return null;
  }

  private applyServeFault(fault: ServeFault, events: SimEvent[]): void {
    const s = this.state;
    const winner = other(s.rally.server);
    const outcome: RallyOutcome = fault === 'footFault' ? 'footFault' : 'fault';
    this.finishRally(
      winner,
      outcome,
      fault === 'footFault' ? 'Foot fault' : 'Fault',
      SERVE_FAULT_TEXT[fault],
      events,
    );
  }

  private endRallyFromDeadBall(
    reason: 'tin' | 'out' | 'doubleBounce' | 'floorBeforeFront',
    events: SimEvent[],
  ): void {
    const s = this.state;

    // A service that goes down or out is an immediate loss, not a fault.
    if (s.rally.serveInFlight && (reason === 'tin' || reason === 'out')) {
      s.rally.serveInFlight = false;
    }

    const ruling = ruleOnDeadBall(reason, s.ball, s.rally);
    if (!ruling) return;
    this.finishRally(ruling.winner, ruling.outcome, ruling.call, ruling.detail, events);
  }

  // -------------------------------------------------------------------------
  // Interference and appeals
  // -------------------------------------------------------------------------

  private observe(striker: 0 | 1): void {
    const s = this.state;
    if (!s.ball.live) return;
    // Interference is judged on the striker's approach to the ball, which only
    // really begins once the ball is on its way back off the front wall.
    if (!s.ball.hitFrontWall && this.sinceShot < 0.35) return;

    const strikerPlayer = s.players[striker];
    const opponent = s.players[other(striker)];

    // Where the striker is heading: the ball's next playable point.
    const interception = predictInterception(s.ball, 0.95, s.match.tinHeight, 1.6);
    const contact = interception.reachable ? interception.pos : { ...s.ball.pos };

    const returnQuality = estimateReturnQuality(contact, strikerPlayer.pos, length(s.ball.vel));

    const observation = observeInterference({
      striker: strikerPlayer,
      opponent,
      ball: s.ball,
      contact,
      strikerOrigin: this.shotOrigins[striker],
      sinceShot: this.sinceShot,
      returnQuality,
      turned: this.ballWentPastStriker,
    });

    this.interference[striker] = worseOf(this.interference[striker], observation);
  }

  private raiseAppeal(player: 0 | 1, kind: 'interference', events: SimEvent[]): void {
    const s = this.state;
    s.rally.appeal = { by: player, kind, decision: null, underReview: false, reviewOverturned: null };
    s.rally.phase = 'appealing';
    s.rally.phaseTime = 0;
    s.ball.live = false;

    events.push({ type: 'appeal', player, kind });

    const observation = this.interference[player] ?? emptyObservation();
    const ruling = ruleOnAppeal(this.referee, observation, player, this.rng);
    this.pendingRuling = ruling;

    events.push({
      type: 'interference',
      appellant: player,
      severity: severityOf(observation),
      blockedLine: observation.lineBlocked > 0.5,
    });
    events.push({
      type: 'refereeCall',
      call: ruling.decision.call,
      detail: `${ruling.decision.detail} (${ruling.decision.rule})`,
      decision: ruling.decision.decision,
    });
  }

  private stepAppealing(inputs: [PlayerInput, PlayerInput], events: SimEvent[], dt: number): void {
    const s = this.state;
    void dt;
    const ruling = this.pendingRuling;
    if (!ruling || !s.rally.appeal) {
      s.rally.phase = 'inPlay';
      return;
    }

    // A short window in which either player may call for video review.
    if (s.rally.phaseTime < 2.4) {
      for (let i = 0; i < 2; i++) {
        const idx = i as 0 | 1;
        if (!inputs[idx].review) continue;
        if (s.players[idx].reviewsRemaining <= 0) continue;
        // Only the player the decision went against can sensibly review it.
        s.rally.appeal.underReview = true;
        s.rally.phase = 'review';
        s.rally.phaseTime = 0;
        events.push({ type: 'reviewStart', player: idx });
        return;
      }
      return;
    }

    this.concludeAppeal(ruling.decision.decision, ruling.decision.call, ruling.decision.detail, events);
  }

  private stepReview(events: SimEvent[], dt: number): void {
    const s = this.state;
    void dt;
    // The review takes a few seconds of replay before the verdict lands.
    if (s.rally.phaseTime < 5.5) return;

    const ruling = this.pendingRuling;
    const appeal = s.rally.appeal;
    if (!ruling || !appeal) {
      s.rally.phase = 'preServe';
      return;
    }

    // Whoever the on-court call went against is the one reviewing it.
    const reviewer: 0 | 1 =
      ruling.decision.decision === 'noLet' ? appeal.by : other(appeal.by);

    const result = requestReview(this.referee, ruling, reviewer);
    s.players[reviewer].reviewsRemaining = result.reviewsRemaining;
    appeal.reviewOverturned = result.overturned;

    events.push({ type: 'reviewEnd', player: reviewer, overturned: result.overturned });
    events.push({
      type: 'refereeCall',
      call: result.overturned ? result.finalDecision.call : ruling.decision.call,
      detail: result.message,
      decision: result.finalDecision.decision,
    });

    this.concludeAppeal(
      result.finalDecision.decision,
      result.finalDecision.call,
      result.finalDecision.detail,
      events,
    );
  }

  private concludeAppeal(
    decision: 'let' | 'stroke' | 'noLet',
    call: string,
    detail: string,
    events: SimEvent[],
  ): void {
    const s = this.state;
    const appellant = s.rally.appeal?.by ?? s.rally.server;

    if (decision === 'let') {
      this.replayPoint(detail, events);
      return;
    }
    const winner = decision === 'stroke' ? appellant : other(appellant);
    this.finishRally(winner, decision, call, detail, events);
  }

  /** A let: the rally is replayed with the same server and the same box. */
  private replayPoint(detail: string, events: SimEvent[]): void {
    const s = this.state;
    s.rally.outcome = 'let';
    s.rally.winner = null;
    s.rally.phase = 'rallyOver';
    s.rally.phaseTime = 0;
    s.ball.live = false;
    events.push({ type: 'refereeCall', call: 'Let', detail, decision: 'let' });
    events.push({
      type: 'rallyEnd',
      winner: s.rally.server,
      outcome: 'let',
      shotCount: s.rally.shotCount,
      duration: s.rally.duration,
      shot: null,
    });
  }

  // -------------------------------------------------------------------------
  // Rally resolution
  // -------------------------------------------------------------------------

  private finishRally(
    winner: 0 | 1,
    outcome: RallyOutcome,
    call: string,
    detail: string,
    events: SimEvent[],
  ): void {
    const s = this.state;
    s.ball.live = false;
    s.rally.outcome = outcome;
    s.rally.winner = winner;
    s.rally.phase = 'rallyOver';
    s.rally.phaseTime = 0;
    s.rally.serveInFlight = false;

    events.push({ type: 'refereeCall', call, detail, decision: outcome });
    events.push({
      type: 'rallyEnd',
      winner,
      outcome,
      shotCount: s.rally.shotCount,
      duration: s.rally.duration,
      shot: this.lastShotType,
    });

    const result = awardRally(s, winner);
    events.push({
      type: 'point',
      player: winner,
      scores: [s.players[0].score, s.players[1].score],
    });

    if (result.matchWon) {
      events.push({ type: 'matchEnd', winner, games: [...s.match.games] as [number, number] });
    } else if (result.gameWon) {
      const last = s.match.completedGames[s.match.completedGames.length - 1];
      events.push({
        type: 'gameEnd',
        winner,
        scores: last,
        games: [...s.match.games] as [number, number],
      });
    } else {
      // Flag game and match ball for the referee's next score call.
      for (let i = 0; i < 2; i++) {
        const idx = i as 0 | 1;
        const p = s.players[idx];
        const o = s.players[other(idx)];
        if (isMatchBall(p, o, s.match)) {
          events.push({ type: 'gameBallPoint', player: idx, kind: 'match' });
        } else if (isGameBall(p, o)) {
          events.push({ type: 'gameBallPoint', player: idx, kind: 'game' });
        }
      }
    }
  }

  private stepRallyOver(events: SimEvent[], dt: number): void {
    const s = this.state;

    // Let the ball roll to a stop and the players recover.
    for (let i = 0; i < 2; i++) {
      const idx = i as 0 | 1;
      recoverStamina(s.players[idx], this.characters[idx], dt);
      s.players[idx].vel.x *= 0.9;
      s.players[idx].vel.z *= 0.9;
    }

    if (s.rally.phaseTime < RULES.betweenRalliesSeconds * 0.4) return;

    if (s.match.winner !== null) {
      s.rally.phase = 'matchOver';
      s.rally.phaseTime = 0;
      return;
    }

    // Did that rally close out a game?
    const gamesPlayed = s.match.completedGames.length;
    if (gamesPlayed > s.match.gameIndex) {
      s.rally.phase = 'betweenGames';
      s.rally.phaseTime = 0;
      resetReviews(this.referee);
      return;
    }

    this.placeForServe();
    s.rally.phase = 'preServe';
    s.rally.phaseTime = 0;
    void events;
  }

  private stepBetweenGames(events: SimEvent[], dt: number): void {
    const s = this.state;
    for (let i = 0; i < 2; i++) {
      recoverStamina(s.players[i as 0 | 1], this.characters[i as 0 | 1], dt * 2.2);
    }
    // The interval is compressed: 90 seconds of real time is not fun.
    if (s.rally.phaseTime < 8) return;

    startNextGame(s);
    this.placeForServe();
    s.rally.phase = 'preServe';
    s.rally.phaseTime = 0;
    void events;
  }

  // -------------------------------------------------------------------------
  // Helpers used by the AI and the UI
  // -------------------------------------------------------------------------

  /**
   * Where the striker should move to reach the ball, and when. `reachable`
   * additionally accounts for whether this particular player can physically
   * cover the ground in the time available.
   */
  interceptionFor(playerIndex: 0 | 1): Interception {
    const s = this.state;
    const character = this.characters[playerIndex];
    const player = s.players[playerIndex];
    const result = predictInterception(s.ball, 0.92, s.match.tinHeight, 2.4);
    if (!result.reachable) return result;

    const travel = distanceXZ(player.pos, result.pos);
    const topSpeed = PLAYER.baseMaxSpeed * (0.82 + (character.attributes.speed / 100) * 0.34);
    const maxTravel = result.time * topSpeed;
    result.reachable = travel <= maxTravel + reachOf(player, character, true);
    return result;
  }

  /**
   * The worst interference the engine has observed against this player during
   * the current shot. This is what the referee would rule on if they appealed,
   * so it is also what the AI consults before deciding whether to.
   */
  interferenceFor(playerIndex: 0 | 1): InterferenceObservation | null {
    return this.interference[playerIndex];
  }

  /** The last shot played, including where the striker was actually aiming. */
  lastShotResult(): ShotResult | null {
    return this.lastShot;
  }

  refereeName(): string {
    return profileFor(this.referee).name;
  }

  pointsTarget(): number {
    return this.pointsToWin;
  }
}

const isStrikerServer = (server: 0 | 1, playerIndex: 0 | 1): boolean => server === playerIndex;
