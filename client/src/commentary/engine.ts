import { Rng } from '../engine/math';
import type { Character } from '../data/roster';
import type { SimEvent, WorldState } from '../engine/types';
import { INTRO_LINES, LINES, type CommentaryContext, type Speaker } from './lines';

/**
 * The commentary box.
 *
 * Every candidate line for an event is scored, the highest-priority one wins
 * the microphone, and everything else is dropped rather than queued — because
 * the thing that makes generated commentary sound artificial is not bad writing,
 * it is a backlog of stale lines being read out thirty seconds after the moment
 * has passed. A line about a nick is worthless once the next rally is under way.
 *
 * Three voices share one microphone with a strict pecking order: the referee
 * always speaks first and is never interrupted, play-by-play calls the action,
 * and the colour commentator fills the gaps.
 */

export interface Utterance {
  id: string;
  speaker: Speaker;
  text: string;
  priority: number;
  /** Seconds this line will occupy the microphone. */
  duration: number;
  /** Match time at which it was said. */
  at: number;
}

/** Rough speaking time: about 2.7 words per second, with a floor. */
const estimateDuration = (text: string): number =>
  Math.max(1.1, (text.split(/\s+/).length / 2.7) * 1.06);

export interface CommentaryOptions {
  names: [string, string];
  characters: [Character, Character];
  refereeName: string;
  seed?: number;
  /** Suppress the colour commentator for players who find it chatty. */
  colourEnabled?: boolean;
}

export class CommentaryEngine {
  private rng: Rng;
  private options: Required<CommentaryOptions>;

  /** What is being said right now, and how long is left of it. */
  private current: Utterance | null = null;
  private remaining = 0;

  /** Line id → match time when it was last used, for cooldowns. */
  private lastUsed = new Map<string, number>();

  /** A short backlog, only for high-priority lines worth waiting a beat for. */
  private pending: Utterance[] = [];

  /** Everything said this match, newest first — the on-screen ticker reads this. */
  history: Utterance[] = [];

  constructor(options: CommentaryOptions) {
    this.rng = new Rng(options.seed ?? 0x5175a5);
    this.options = {
      seed: 0x5175a5,
      colourEnabled: true,
      ...options,
    };
  }

  /** Queue the pre-match introductions. */
  introduce(): void {
    const lines = INTRO_LINES(
      this.options.names,
      this.options.characters,
      this.options.refereeName,
    );
    lines.forEach((line, i) => {
      this.pending.push({
        id: `intro-${i}`,
        speaker: line.speaker,
        text: line.text,
        priority: 30,
        duration: estimateDuration(line.text),
        at: 0,
      });
    });
  }

  /**
   * Offer this tick's events to the commentary team.
   *
   * `extras` carries the match-level context the phrase bank reasons about —
   * momentum, streaks, rally statistics — which the raw event stream does not.
   */
  handle(
    events: SimEvent[],
    state: WorldState,
    extras: Pick<
      CommentaryContext,
      'momentum' | 'streak' | 'rallyShots' | 'rallyDuration' | 'lastSpeedKmh' | 'averageRally'
    >,
  ): void {
    for (const event of events) {
      const context: CommentaryContext = {
        event,
        state,
        characters: this.options.characters,
        names: this.options.names,
        refereeName: this.options.refereeName,
        ...extras,
      };

      let best: { template: (typeof LINES)[number]; text: string } | null = null;

      for (const template of LINES) {
        if (template.speaker === 'colour' && !this.options.colourEnabled) continue;
        if (!template.when(context)) continue;

        const last = this.lastUsed.get(template.id);
        if (last !== undefined && state.time - last < template.cooldown) continue;

        if (best && template.priority <= best.template.priority) continue;

        const options = template.say(context);
        if (options.length === 0) continue;
        best = { template, text: this.rng.pick(options) };
      }

      if (!best) continue;

      this.lastUsed.set(best.template.id, state.time);
      const utterance: Utterance = {
        id: `${best.template.id}-${state.tick}`,
        speaker: best.template.speaker,
        text: best.text,
        priority: best.template.priority,
        duration: estimateDuration(best.text),
        at: state.time,
      };

      this.offer(utterance);
    }
  }

  /**
   * Decide what happens to a new line: speak it now, interrupt, hold it, or
   * throw it away.
   */
  private offer(utterance: Utterance): void {
    if (!this.current) {
      this.speak(utterance);
      return;
    }

    // The referee talks over anyone. A clearly more important call interrupts.
    const interrupts =
      utterance.speaker === 'referee' || utterance.priority >= this.current.priority + 12;

    if (interrupts) {
      this.speak(utterance);
      return;
    }

    // Worth waiting a moment for, but only if it will still be relevant.
    if (utterance.priority >= 70 && this.pending.length < 2) {
      this.pending.push(utterance);
    }
    // Anything else is simply dropped — a stale line is worse than silence.
  }

  private speak(utterance: Utterance): void {
    this.current = utterance;
    this.remaining = utterance.duration;
    this.history.unshift(utterance);
    if (this.history.length > 40) this.history.length = 40;
    this.onSpeak?.(utterance);
  }

  /** Set by the audio layer to actually voice a line. */
  onSpeak: ((utterance: Utterance) => void) | null = null;

  /** Advance the microphone. Call once per frame with real elapsed seconds. */
  update(dt: number, matchTime: number): void {
    if (!this.current) {
      const next = this.pending.shift();
      if (next) {
        // Drop anything that has aged out while it waited.
        if (matchTime - next.at < 4) this.speak(next);
      }
      return;
    }

    this.remaining -= dt;
    if (this.remaining > 0) return;

    this.current = null;
    // A short beat of silence before the next line, so it does not run on.
    this.remaining = 0.35;
  }

  nowSpeaking(): Utterance | null {
    return this.current;
  }

  /** The most recent lines, for the on-screen ticker. */
  recent(count = 4): Utterance[] {
    return this.history.slice(0, count);
  }

  reset(): void {
    this.current = null;
    this.pending.length = 0;
    this.history.length = 0;
    this.lastUsed.clear();
    this.remaining = 0;
  }
}
