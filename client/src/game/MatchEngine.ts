import { SIM } from '../engine/constants';
import { hashString } from '../engine/math';
import { Simulation, type WorldConfig } from '../engine/world';
import { SquashAI, type Difficulty } from '../engine/ai';
import {
  MatchTimeline,
  ReplayRecorder,
  sampleClip,
  lastShotPath,
  type ReplayClip,
} from '../engine/replay';
import { CommentaryEngine } from '../commentary/engine';
import { soundEngine } from '../audio/sfx';
import { speechEngine } from '../audio/speech';
import { characterById } from '../data/roster';
import {
  GamepadTracker,
  KEYMAP_P1,
  KEYMAP_P2,
  KeyboardTracker,
  emptyTouchState,
  readKeyboardInput,
  readTouchInput,
  type TouchState,
} from './input';
import { emptyInput, type PlayerInput, type SimEvent, type WorldState } from '../engine/types';
import type { NetTransport } from '../net/transport';

/**
 * The match loop.
 *
 * Owns the simulation and everything hanging off it — AI, replay recording,
 * commentary, audio, netcode — and steps them all at a fixed 60 Hz with an
 * accumulator, independently of the display refresh rate. The renderer reads
 * state straight off this object every frame; React only hears about the parts
 * that belong on the scoreboard, and only when they change. Running the sim
 * through React state at 60 Hz would spend the entire frame budget on
 * reconciliation.
 */

export type MatchMode = 'local' | 'ai' | 'online' | 'spectate';

export interface MatchSettings extends WorldConfig {
  mode: MatchMode;
  difficulty: Difficulty;
  /** Which player the local human controls. */
  localPlayer: 0 | 1;
  commentaryEnabled: boolean;
  speechEnabled: boolean;
  soundEnabled: boolean;
  volume: number;
}

export interface HudState {
  scores: [number, number];
  games: [number, number];
  completedGames: Array<[number, number]>;
  gameIndex: number;
  server: 0 | 1;
  serveSide: -1 | 1;
  phase: WorldState['rally']['phase'];
  outcome: WorldState['rally']['outcome'];
  stamina: [number, number];
  ballTemperature: number;
  matchWinner: 0 | 1 | null;
  rallyShots: number;
  momentum: number;
  lastCall: { call: string; detail: string } | null;
  reviewsRemaining: [number, number];
  elapsed: number;
  totalRallies: number;
  distance: [number, number];
  averageRally: number;
  longestRally: number;
  /** Commentary ticker, newest first. */
  commentary: Array<{ id: string; speaker: string; text: string }>;
}

/** What the replay overlay needs to render itself. */
export interface ReplayState {
  active: boolean;
  clip: ReplayClip | null;
  /** 0–1 through the clip. */
  progress: number;
  speed: number;
  paused: boolean;
  label: string;
  /** Flight path of the final shot, for the Hawk-Eye ribbon. */
  path: Array<{ x: number; y: number; z: number }>;
  /** True when this is an official video review rather than a replay. */
  isReview: boolean;
  reviewVerdict: string | null;
}

export class MatchEngine {
  sim: Simulation;
  recorder = new ReplayRecorder();
  timeline = new MatchTimeline();
  commentary: CommentaryEngine;
  settings: MatchSettings;

  private ai: [SquashAI | null, SquashAI | null] = [null, null];
  private keyboard = new KeyboardTracker();
  private gamepads = new GamepadTracker();
  touch: TouchState = emptyTouchState();
  private useTouch = false;

  private accumulator = 0;
  private running = false;
  private rafHandle: number | null = null;
  private lastFrameTime = 0;

  /** Camera shake, decayed each frame and fed by heavy impacts. */
  impact = 0;

  /** Replay playback, which runs on wall-clock time rather than sim time. */
  replay: ReplayState = {
    active: false,
    clip: null,
    progress: 0,
    speed: 0.28,
    paused: false,
    label: '',
    path: [],
    isReview: false,
    reviewVerdict: null,
  };
  private replayTime = 0;

  /** The state the renderer should draw — live, or a replay frame. */
  renderState: WorldState;

  /** Networking, when this is an online match. */
  net: NetTransport | null = null;
  private remoteInput: PlayerInput = emptyInput();

  private hudListeners = new Set<(hud: HudState) => void>();
  private lastHudPush = 0;
  private lastCall: { call: string; detail: string } | null = null;
  private lastSpeedKmh = 0;

  constructor(settings: MatchSettings) {
    this.settings = settings;
    this.sim = new Simulation(settings);
    this.renderState = this.sim.state;

    const names: [string, string] = [
      characterById(settings.characters[0]).shortName,
      characterById(settings.characters[1]).shortName,
    ];

    this.commentary = new CommentaryEngine({
      names,
      characters: this.sim.characters,
      refereeName: this.sim.refereeName(),
      seed: hashString(String(settings.seed)),
      colourEnabled: settings.commentaryEnabled,
    });

    this.commentary.onSpeak = (utterance) => {
      if (this.settings.speechEnabled) speechEngine.say(utterance.speaker, utterance.text);
      soundEngine.duckCrowd(true);
    };

    // Fill the AI slots that no human is holding.
    if (settings.mode === 'ai') {
      const aiIndex = settings.localPlayer === 0 ? 1 : 0;
      this.ai[aiIndex] = new SquashAI(
        aiIndex,
        this.sim.characters[aiIndex],
        settings.difficulty,
        hashString(`${settings.seed}-ai`),
      );
    } else if (settings.mode === 'spectate') {
      this.ai[0] = new SquashAI(0, this.sim.characters[0], settings.difficulty, hashString(`${settings.seed}-a`));
      this.ai[1] = new SquashAI(1, this.sim.characters[1], settings.difficulty, hashString(`${settings.seed}-b`));
    }

    soundEngine.setEnabled(settings.soundEnabled);
    soundEngine.setVolume(settings.volume);
    speechEngine.setEnabled(settings.speechEnabled);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.keyboard.attach();
    this.commentary.introduce();
    this.lastFrameTime = performance.now();
    this.loop();
  }

  stop(): void {
    this.running = false;
    this.keyboard.detach();
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    speechEngine.cancel();
    this.net?.close();
    this.net = null;
  }

  setTouchEnabled(enabled: boolean): void {
    this.useTouch = enabled;
  }

  onHud(listener: (hud: HudState) => void): () => void {
    this.hudListeners.add(listener);
    return () => this.hudListeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  private loop = (): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    const now = performance.now();
    // Clamp so that a backgrounded tab does not fast-forward the match.
    const frameDelta = Math.min((now - this.lastFrameTime) / 1000, 0.25);
    this.lastFrameTime = now;

    this.commentary.update(frameDelta, this.sim.state.time);
    if (!this.commentary.nowSpeaking()) soundEngine.duckCrowd(false);

    this.impact = Math.max(0, this.impact - frameDelta * 2.6);

    if (this.replay.active) {
      this.advanceReplay(frameDelta);
    } else {
      this.accumulator += frameDelta;
      let steps = 0;
      // Bounded catch-up: better to run slow than to spiral.
      while (this.accumulator >= SIM.tickDelta && steps < 6) {
        this.tick();
        this.accumulator -= SIM.tickDelta;
        steps += 1;
      }
      this.renderState = this.sim.state;
    }

    this.pushHud(now);
  };

  private tick(): void {
    const inputs = this.collectInputs();
    const events = this.sim.step(inputs);
    this.keyboard.endFrame();
    this.touch.swingPressed = false;

    this.recorder.record(this.sim.snapshot(), events);
    this.consume(events);

    if (this.net) this.net.publish(this.sim, inputs);
  }

  private collectInputs(): [PlayerInput, PlayerInput] {
    const state = this.sim.state;
    const inputs: [PlayerInput, PlayerInput] = [emptyInput(), emptyInput()];

    for (let i = 0; i < 2; i++) {
      const index = i as 0 | 1;
      const player = state.players[index];

      if (this.ai[index]) {
        inputs[index] = this.ai[index]!.think(this.sim, SIM.tickDelta);
        continue;
      }

      if (this.settings.mode === 'online' && index !== this.settings.localPlayer) {
        inputs[index] = this.remoteInput;
        continue;
      }

      // Local human. Player one may be on touch or a gamepad.
      const isFirstLocal =
        this.settings.mode === 'local' ? index === 0 : index === this.settings.localPlayer;

      if (isFirstLocal && this.useTouch) {
        inputs[index] = readTouchInput(this.touch, player, state.ball);
        continue;
      }

      const padIndex = this.settings.mode === 'local' ? index : 0;
      const pad = this.gamepads.read(padIndex, player, state.ball);
      if (pad && (pad.moveX !== 0 || pad.moveZ !== 0 || pad.swingHeld || pad.swingPressed)) {
        inputs[index] = pad;
        continue;
      }

      const map =
        this.settings.mode === 'local' ? (index === 0 ? KEYMAP_P1 : KEYMAP_P2) : KEYMAP_P1;
      inputs[index] = readKeyboardInput(this.keyboard, map, player, state.ball);
    }

    return inputs;
  }

  /** React to this tick's events: audio, commentary, statistics, replays. */
  private consume(events: SimEvent[]): void {
    if (this.settings.soundEnabled) soundEngine.playEvents(events);

    for (const event of events) {
      switch (event.type) {
        case 'racketHit':
          this.lastSpeedKmh = event.speed * 3.6;
          break;
        case 'ballTin':
          this.impact = 0.8;
          break;
        case 'ballWall':
          if (event.speed > 40) this.impact = Math.max(this.impact, 0.3);
          break;
        case 'refereeCall':
          this.lastCall = { call: event.call, detail: event.detail };
          break;
        case 'rallyEnd':
          this.timeline.record(
            this.sim.state.time,
            this.sim.state.match.totalRallies,
            [this.sim.state.players[0].score, this.sim.state.players[1].score],
            this.sim.state.match.gameIndex,
            event.winner,
            event.shotCount,
            event.duration,
            event.outcome,
          );
          // Big rallies earn a replay, the way a broadcast would cut to one.
          if (event.shotCount >= 18 || event.outcome === 'stroke') {
            this.queueReplay(`${event.shotCount}-shot rally`);
          }
          break;
        case 'reviewStart':
          this.startReview();
          break;
        case 'reviewEnd':
          this.replay.reviewVerdict = event.overturned
            ? 'DECISION OVERTURNED'
            : 'DECISION STANDS';
          break;
        case 'gameEnd':
        case 'matchEnd':
          this.impact = 0.5;
          break;
        default:
          break;
      }
    }

    const streak = this.timeline.currentStreak();
    this.commentary.handle(events, this.sim.state, {
      momentum: this.timeline.current(),
      streak,
      rallyShots: this.sim.state.rally.shotCount,
      rallyDuration: this.sim.state.rally.duration,
      lastSpeedKmh: this.lastSpeedKmh,
      averageRally: this.timeline.averageRallyLength(),
    });
  }

  // -------------------------------------------------------------------------
  // Replays — the fourth dimension
  // -------------------------------------------------------------------------

  /** Cut to a replay of the rally that just finished. */
  queueReplay(label = 'Replay', speed = 0.28): void {
    const clip = this.recorder.lastRally(label);
    if (!clip) return;
    this.replay = {
      active: true,
      clip,
      progress: 0,
      speed,
      paused: false,
      label,
      path: lastShotPath(clip),
      isReview: false,
      reviewVerdict: null,
    };
    this.replayTime = clip.startTime;
  }

  /** The official video review: slower, dimmer, and it holds on the incident. */
  private startReview(): void {
    const clip = this.recorder.lastSeconds(6, 'Video review');
    if (!clip) return;
    this.replay = {
      active: true,
      clip,
      progress: 0,
      speed: 0.18,
      paused: false,
      label: 'VIDEO REVIEW',
      path: lastShotPath(clip),
      isReview: true,
      reviewVerdict: null,
    };
    this.replayTime = clip.startTime;
  }

  private advanceReplay(delta: number): void {
    const { clip } = this.replay;
    if (!clip) {
      this.replay.active = false;
      return;
    }

    if (!this.replay.paused) {
      this.replayTime += delta * this.replay.speed;
    }

    if (this.replayTime >= clip.endTime) {
      // A review holds on the last frame until the verdict arrives; an ordinary
      // replay simply ends and hands the court back.
      if (this.replay.isReview) {
        this.replayTime = clip.endTime;
      } else {
        this.replay.active = false;
        this.renderState = this.sim.state;
        return;
      }
    }

    const sample = sampleClip(clip, this.replayTime);
    this.renderState = sample.state;
    this.replay.progress = sample.t;

    // The simulation keeps running underneath a review so the clock is honest.
    if (this.replay.isReview) {
      this.accumulator += delta;
      let steps = 0;
      while (this.accumulator >= SIM.tickDelta && steps < 6) {
        this.tick();
        this.accumulator -= SIM.tickDelta;
        steps += 1;
      }
      if (this.sim.state.rally.phase !== 'review') {
        this.replay.active = false;
        this.renderState = this.sim.state;
      }
    }
  }

  /** Scrub to a position in the clip, 0–1. Used by the replay timeline. */
  scrubTo(t: number): void {
    const { clip } = this.replay;
    if (!clip) return;
    this.replay.paused = true;
    this.replayTime = clip.startTime + clip.duration * Math.min(1, Math.max(0, t));
    this.renderState = sampleClip(clip, this.replayTime).state;
    this.replay.progress = t;
  }

  setReplaySpeed(speed: number): void {
    this.replay.speed = speed;
    this.replay.paused = false;
  }

  toggleReplayPause(): void {
    this.replay.paused = !this.replay.paused;
  }

  exitReplay(): void {
    this.replay.active = false;
    this.replay.clip = null;
    this.renderState = this.sim.state;
  }

  // -------------------------------------------------------------------------
  // Networking
  // -------------------------------------------------------------------------

  applyRemoteInput(input: PlayerInput): void {
    this.remoteInput = input;
  }

  /**
   * Reconcile against the host's authoritative state.
   *
   * The guest keeps simulating locally so its own player responds to input
   * immediately rather than after a round trip, and the host's snapshot then
   * overwrites everything. Because both peers run the same deterministic engine
   * from the same seed, the two states are usually within a frame of each other
   * and the correction is invisible; when they are not — a let call, a stroke,
   * a shot the guest mispredicted — the host wins, always.
   */
  applyRemoteSnapshot(snapshot: WorldState): void {
    // Ignore snapshots that have been overtaken by one we already applied;
    // WebSocket ordering is guaranteed but re-sends after a stall are not.
    if (snapshot.tick < this.lastAppliedTick) return;
    this.lastAppliedTick = snapshot.tick;

    this.sim.restore(snapshot);
    this.renderState = this.sim.state;
  }

  /** Latency to the peer, in milliseconds, for the connection indicator. */
  latency = 0;
  private lastAppliedTick = -1;

  /** Attach a live transport. The engine takes ownership of closing it. */
  attachTransport(transport: NetTransport): void {
    this.net = transport;
  }

  // -------------------------------------------------------------------------
  // HUD
  // -------------------------------------------------------------------------

  private pushHud(now: number): void {
    // The scoreboard does not need sixty updates a second.
    if (now - this.lastHudPush < 90) return;
    this.lastHudPush = now;

    const s = this.sim.state;
    const longest = this.timeline.longestRally();

    const hud: HudState = {
      scores: [s.players[0].score, s.players[1].score],
      games: [...s.match.games] as [number, number],
      completedGames: s.match.completedGames.map((g) => [...g] as [number, number]),
      gameIndex: s.match.gameIndex,
      server: s.rally.server,
      serveSide: s.rally.serveSide,
      phase: s.rally.phase,
      outcome: s.rally.outcome,
      stamina: [s.players[0].stamina, s.players[1].stamina],
      ballTemperature: s.ball.temperature,
      matchWinner: s.match.winner,
      rallyShots: s.rally.shotCount,
      momentum: this.timeline.current(),
      lastCall: this.lastCall,
      reviewsRemaining: [s.players[0].reviewsRemaining, s.players[1].reviewsRemaining],
      elapsed: s.match.elapsed,
      totalRallies: s.match.totalRallies,
      distance: [s.players[0].distanceCovered, s.players[1].distanceCovered],
      averageRally: this.timeline.averageRallyLength(),
      longestRally: longest?.shots ?? 0,
      commentary: this.commentary.recent(4).map((u) => ({
        id: u.id,
        speaker: u.speaker,
        text: u.text,
      })),
    };

    for (const listener of this.hudListeners) listener(hud);
  }
}
