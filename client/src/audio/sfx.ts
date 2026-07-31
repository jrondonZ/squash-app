import { clamp01, remap } from '../engine/math';
import type { SimEvent } from '../engine/types';

/**
 * Sound, synthesised rather than sampled.
 *
 * Every sound in the game is generated from oscillators and filtered noise at
 * runtime. That keeps the whole thing dependency-free and asset-free, and it
 * means the sounds are genuinely parametric: the crack of the ball is pitched
 * and filtered by its actual impact speed, so a soft drop and a 200 km/h drive
 * are audibly different events rather than the same sample at two volumes.
 */

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;
  private volume = 0.75;

  /** Browsers require a user gesture before audio can start. */
  async resume(): Promise<void> {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') await this.ctx.resume();
  }

  private init(): void {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // One second of white noise, reused as the source for every noisy sound.
    const rate = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, rate, rate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startCrowdBed();
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    if (this.master) this.master.gain.value = this.volume;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? this.volume : 0;
  }

  /** A continuous low murmur, which is what an arena actually sounds like. */
  private startCrowdBed(): void {
    if (!this.ctx || !this.noiseBuffer || !this.master) return;

    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;

    this.crowdGain = this.ctx.createGain();
    this.crowdGain.gain.value = 0.035;

    source.connect(filter).connect(this.crowdGain).connect(this.master);
    source.start();
  }

  private noise(duration: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.start(this.ctx.currentTime);
    source.stop(this.ctx.currentTime + duration);
    return source;
  }

  private envelope(attack: number, decay: number, peak: number): GainNode | null {
    if (!this.ctx) return null;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    return gain;
  }

  /**
   * The strings meeting the ball: a broadband thwack with a short pitched tail,
   * both scaled by how hard the ball was struck.
   */
  racketHit(speed: number, quality: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const power = clamp01(speed / 60);

    const body = this.noise(0.09);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = remap(power, 0, 1, 900, 2600);
    filter.Q.value = 1.1;
    const gain = this.envelope(0.002, 0.075, 0.18 + power * 0.42);
    if (body && gain) body.connect(filter).connect(gain).connect(this.master);

    // A clean strike rings; a mishit thuds.
    const tone = this.ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = remap(power, 0, 1, 180, 420);
    const toneGain = this.envelope(0.003, 0.05 + quality * 0.06, 0.08 + quality * 0.14);
    if (toneGain) {
      tone.connect(toneGain).connect(this.master);
      tone.start();
      tone.stop(this.ctx.currentTime + 0.16);
    }
  }

  /** Ball on plaster or glass: a hard, bright crack. */
  wallHit(speed: number, glass: boolean): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const power = clamp01(speed / 60);

    const body = this.noise(0.06);
    const filter = this.ctx.createBiquadFilter();
    filter.type = glass ? 'highpass' : 'bandpass';
    filter.frequency.value = glass ? 1800 : remap(power, 0, 1, 1200, 3400);
    filter.Q.value = glass ? 0.7 : 1.6;
    const gain = this.envelope(0.001, glass ? 0.09 : 0.055, 0.1 + power * 0.4);
    if (body && gain) body.connect(filter).connect(gain).connect(this.master);
  }

  /** Ball on floor: duller, with more low end. */
  floorHit(speed: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const power = clamp01(speed / 45);
    const body = this.noise(0.07);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = remap(power, 0, 1, 700, 1900);
    const gain = this.envelope(0.002, 0.06, 0.06 + power * 0.24);
    if (body && gain) body.connect(filter).connect(gain).connect(this.master);
  }

  /**
   * The tin. A resonant aluminium board — two detuned partials ringing out,
   * which is exactly why everyone in the building knows you have hit it.
   */
  tinHit(speed: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const power = clamp01(speed / 50);
    const now = this.ctx.currentTime;

    for (const [frequency, level] of [
      [196, 0.3],
      [293, 0.19],
      [441, 0.1],
    ] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = frequency * (0.97 + Math.random() * 0.06);
      const gain = this.envelope(0.002, 0.55, level * (0.4 + power * 0.9));
      if (!gain) continue;
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 0.7);
    }

    const body = this.noise(0.05);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    const gain = this.envelope(0.001, 0.05, 0.2);
    if (body && gain) body.connect(filter).connect(gain).connect(this.master);
  }

  /** The nick — a ball dying in the join makes almost no sound at all. */
  nick(): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const body = this.noise(0.04);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;
    const gain = this.envelope(0.001, 0.035, 0.1);
    if (body && gain) body.connect(filter).connect(gain).connect(this.master);
  }

  /** Shoe on a sprung floor. */
  squeak(intensity: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 900 + Math.random() * 700;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 1.9, now + 0.09);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200;
    filter.Q.value = 5;

    const gain = this.envelope(0.006, 0.1, 0.02 + clamp01(intensity) * 0.05);
    if (!gain) return;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  /** Applause, scaled by how good the point was. */
  applause(intensity: number): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const level = clamp01(intensity);
    const duration = 0.9 + level * 2.4;

    const body = this.noise(duration);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.5;

    if (!this.ctx || !body) return;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.04 + level * 0.16, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    body.connect(filter).connect(gain).connect(this.master);
  }

  /** Duck the crowd bed while someone is speaking. */
  duckCrowd(ducked: boolean): void {
    if (!this.crowdGain || !this.ctx) return;
    const target = ducked ? 0.014 : 0.035;
    this.crowdGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  /** Route a tick's worth of simulation events to the right sounds. */
  playEvents(events: SimEvent[]): void {
    if (!this.enabled) return;
    for (const event of events) {
      switch (event.type) {
        case 'racketHit':
          this.racketHit(event.speed, event.quality);
          break;
        case 'ballWall':
          if (event.nick) this.nick();
          else this.wallHit(event.speed, event.wall === 'back');
          break;
        case 'ballFloor':
          this.floorHit(event.speed);
          break;
        case 'ballTin':
          this.tinHit(event.speed);
          break;
        case 'rallyEnd':
          // Longer, better rallies get a bigger reception.
          this.applause(clamp01(0.2 + event.shotCount / 35));
          break;
        case 'gameEnd':
          this.applause(0.85);
          break;
        case 'matchEnd':
          this.applause(1);
          break;
        default:
          break;
      }
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const soundEngine = new SoundEngine();
