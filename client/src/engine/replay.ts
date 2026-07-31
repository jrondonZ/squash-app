import { SIM } from './constants';
import { clamp, clamp01, lerp, type Vec3 } from './math';
import type { SimEvent, WorldState } from './types';

/**
 * The time dimension.
 *
 * Everything the game shows you about a rally after it has happened — instant
 * replay, the referee's video review, the Hawk-Eye trajectory overlay, the
 * momentum graph — is served from this one recorder. It keeps a rolling window
 * of full world snapshots plus the event stream, and lets anything downstream
 * sample the match at an arbitrary point in time, forwards or backwards, at any
 * speed.
 */

export interface RecordedFrame {
  tick: number;
  time: number;
  state: WorldState;
  events: SimEvent[];
}

export interface ReplayClip {
  frames: RecordedFrame[];
  startTime: number;
  endTime: number;
  duration: number;
  /** Interesting instants inside the clip, for the scrub bar's markers. */
  markers: ReplayMarker[];
  label: string;
}

export interface ReplayMarker {
  time: number;
  /** 0–1 position within the clip. */
  t: number;
  kind: 'hit' | 'bounce' | 'wall' | 'decision' | 'end';
  label: string;
}

export class ReplayRecorder {
  private frames: RecordedFrame[] = [];
  private capacity: number;
  /** Tick at which the current rally began, so a clip can be cut from it. */
  private rallyStartTick = 0;

  constructor(seconds: number = SIM.replayBufferSeconds) {
    this.capacity = Math.ceil(seconds * SIM.tickRate);
  }

  record(state: WorldState, events: SimEvent[]): void {
    this.frames.push({ tick: state.tick, time: state.time, state, events });
    if (this.frames.length > this.capacity) {
      this.frames.splice(0, this.frames.length - this.capacity);
    }
    for (const event of events) {
      if (event.type === 'rallyStart') this.rallyStartTick = state.tick;
    }
  }

  clear(): void {
    this.frames.length = 0;
  }

  get length(): number {
    return this.frames.length;
  }

  latest(): RecordedFrame | null {
    return this.frames[this.frames.length - 1] ?? null;
  }

  /** Cut a clip covering the rally that just finished. */
  lastRally(label = 'Rally replay'): ReplayClip | null {
    return this.clipFromTick(this.rallyStartTick, label);
  }

  /** Cut the final `seconds` of the buffer — the classic instant replay. */
  lastSeconds(seconds: number, label = 'Instant replay'): ReplayClip | null {
    const latest = this.latest();
    if (!latest) return null;
    const fromTick = latest.tick - Math.ceil(seconds * SIM.tickRate);
    return this.clipFromTick(fromTick, label);
  }

  private clipFromTick(fromTick: number, label: string): ReplayClip | null {
    const frames = this.frames.filter((f) => f.tick >= fromTick);
    if (frames.length < 2) return null;
    const startTime = frames[0].time;
    const endTime = frames[frames.length - 1].time;
    return {
      frames,
      startTime,
      endTime,
      duration: Math.max(0.001, endTime - startTime),
      markers: buildMarkers(frames, startTime, endTime),
      label,
    };
  }
}

const buildMarkers = (
  frames: RecordedFrame[],
  startTime: number,
  endTime: number,
): ReplayMarker[] => {
  const duration = Math.max(0.001, endTime - startTime);
  const markers: ReplayMarker[] = [];

  for (const frame of frames) {
    for (const event of frame.events) {
      let kind: ReplayMarker['kind'] | null = null;
      let label = '';
      switch (event.type) {
        case 'racketHit':
          kind = 'hit';
          label = event.shot;
          break;
        case 'ballFloor':
          kind = 'bounce';
          label = `bounce ${event.bounceIndex}`;
          break;
        case 'ballWall':
          if (event.wall === 'front' || event.nick) {
            kind = 'wall';
            label = event.nick ? 'nick' : 'front wall';
          }
          break;
        case 'refereeCall':
          kind = 'decision';
          label = event.call;
          break;
        case 'rallyEnd':
          kind = 'end';
          label = event.outcome;
          break;
        default:
          break;
      }
      if (!kind) continue;
      markers.push({
        time: frame.time,
        t: clamp01((frame.time - startTime) / duration),
        kind,
        label,
      });
    }
  }
  return markers;
};

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

export interface PlaybackSample {
  /** Interpolated world state at the requested time. */
  state: WorldState;
  /** 0–1 position within the clip. */
  t: number;
  time: number;
  /** Events that fired between the previous sample and this one. */
  events: SimEvent[];
}

const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

/**
 * Sample a clip at an arbitrary time, interpolating positions between the two
 * bracketing frames so that slow motion stays smooth rather than stepping at
 * 60 Hz.
 */
export const sampleClip = (clip: ReplayClip, time: number): PlaybackSample => {
  const clamped = clamp(time, clip.startTime, clip.endTime);
  const { frames } = clip;

  // Binary search for the bracketing frames.
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].time <= clamped) lo = mid;
    else hi = mid;
  }

  const a = frames[lo];
  const b = frames[hi];
  const span = Math.max(1e-6, b.time - a.time);
  const f = clamp01((clamped - a.time) / span);

  const state: WorldState = {
    ...b.state,
    ball: {
      ...b.state.ball,
      pos: lerpVec3(a.state.ball.pos, b.state.ball.pos, f),
      vel: lerpVec3(a.state.ball.vel, b.state.ball.vel, f),
      spin: lerpVec3(a.state.ball.spin, b.state.ball.spin, f),
    },
    players: [0, 1].map((i) => ({
      ...b.state.players[i],
      pos: lerpVec3(a.state.players[i].pos, b.state.players[i].pos, f),
      vel: lerpVec3(a.state.players[i].vel, b.state.players[i].vel, f),
      facing: lerp(a.state.players[i].facing, b.state.players[i].facing, f),
    })) as WorldState['players'],
  };

  return {
    state,
    t: clamp01((clamped - clip.startTime) / clip.duration),
    time: clamped,
    events: b.events,
  };
};

/** Every position the ball occupied during the clip — the flight-path ribbon. */
export const ballPath = (clip: ReplayClip, stride = 1): Vec3[] => {
  const path: Vec3[] = [];
  for (let i = 0; i < clip.frames.length; i += stride) {
    path.push({ ...clip.frames[i].state.ball.pos });
  }
  return path;
};

/** The ball's path since the last racket contact — what a review actually shows. */
export const lastShotPath = (clip: ReplayClip): Vec3[] => {
  let startIndex = 0;
  for (let i = clip.frames.length - 1; i >= 0; i--) {
    if (clip.frames[i].events.some((e) => e.type === 'racketHit' || e.type === 'serve')) {
      startIndex = i;
      break;
    }
  }
  return clip.frames.slice(startIndex).map((f) => ({ ...f.state.ball.pos }));
};

/** Peak ball speed inside the clip, in km/h — the broadcast graphic. */
export const peakSpeed = (clip: ReplayClip): number => {
  let peak = 0;
  for (const frame of clip.frames) {
    const v = frame.state.ball.vel;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > peak) peak = speed;
  }
  return peak * 3.6;
};

// ---------------------------------------------------------------------------
// Match timeline — the fourth dimension at match scale
// ---------------------------------------------------------------------------

export interface TimelinePoint {
  /** Match time in seconds. */
  time: number;
  /** Rally number. */
  rally: number;
  scores: [number, number];
  gameIndex: number;
  /** Momentum, -1 (player 2 dominant) to +1 (player 1 dominant). */
  momentum: number;
  /** Rally length in shots. */
  shots: number;
  /** Rally duration in seconds. */
  duration: number;
  winner: 0 | 1;
  outcome: string;
}

/**
 * Momentum is a decayed running average of who is winning rallies, weighted by
 * how hard those rallies were. It is what the on-screen momentum bar shows and
 * what the colour commentator reacts to.
 */
export class MatchTimeline {
  points: TimelinePoint[] = [];
  private momentum = 0;

  record(
    time: number,
    rally: number,
    scores: [number, number],
    gameIndex: number,
    winner: 0 | 1,
    shots: number,
    duration: number,
    outcome: string,
  ): void {
    // Long, hard-fought rallies swing momentum more than a service fault does.
    const weight = clamp01(0.25 + Math.min(shots, 30) / 40 + Math.min(duration, 40) / 90);
    const direction = winner === 0 ? 1 : -1;
    this.momentum = clamp(this.momentum * 0.78 + direction * weight * 0.45, -1, 1);

    this.points.push({
      time,
      rally,
      scores,
      gameIndex,
      momentum: this.momentum,
      shots,
      duration,
      winner,
      outcome,
    });
  }

  current(): number {
    return this.momentum;
  }

  /** Longest rally of the match, in shots. */
  longestRally(): TimelinePoint | null {
    return this.points.reduce<TimelinePoint | null>(
      (best, p) => (!best || p.shots > best.shots ? p : best),
      null,
    );
  }

  /** Consecutive rallies won by a player, ending at the latest point. */
  currentStreak(): { player: 0 | 1; count: number } | null {
    if (this.points.length === 0) return null;
    const player = this.points[this.points.length - 1].winner;
    let count = 0;
    for (let i = this.points.length - 1; i >= 0; i--) {
      if (this.points[i].winner !== player) break;
      count += 1;
    }
    return { player, count };
  }

  averageRallyLength(): number {
    if (this.points.length === 0) return 0;
    return this.points.reduce((sum, p) => sum + p.shots, 0) / this.points.length;
  }

  clear(): void {
    this.points.length = 0;
    this.momentum = 0;
  }
}
