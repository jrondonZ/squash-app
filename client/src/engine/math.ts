/**
 * Small, allocation-conscious math layer for the simulation.
 *
 * The engine is deterministic: given the same seed and the same input stream it
 * produces bit-identical states on every machine. That property is what makes
 * the netcode (host-authoritative with guest prediction) and the replay system
 * work, so nothing in here may reach for `Math.random()` or wall-clock time.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clone = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export const set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};

export const copy = (out: Vec3, a: Vec3): Vec3 => set(out, a.x, a.y, a.z);

export const add = (out: Vec3, a: Vec3, b: Vec3): Vec3 =>
  set(out, a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (out: Vec3, a: Vec3, b: Vec3): Vec3 =>
  set(out, a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (out: Vec3, a: Vec3, s: number): Vec3 =>
  set(out, a.x * s, a.y * s, a.z * s);

/** out = a + b * s — the fused operation the integrator leans on. */
export const addScaled = (out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 =>
  set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (out: Vec3, a: Vec3, b: Vec3): Vec3 =>
  set(
    out,
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

export const distance = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

/** Horizontal (floor-plane) distance, which is what court positioning cares about. */
export const distanceXZ = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
};

export const normalize = (out: Vec3, a: Vec3): Vec3 => {
  const len = length(a);
  if (len < 1e-9) return set(out, 0, 0, 0);
  return scale(out, a, 1 / len);
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec = (out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 =>
  set(out, lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Maps `v` from [inMin,inMax] onto [outMin,outMax], clamped at both ends. */
export const remap = (
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => {
  if (inMax - inMin === 0) return outMin;
  return clamp(outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin),
    Math.min(outMin, outMax), Math.max(outMin, outMax));
};

/** Smootherstep — C2 continuous, used for camera and animation easing. */
export const smootherstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Frame-rate independent exponential approach.
 * `rate` is the fraction of the remaining gap closed per second.
 */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  target + (current - target) * Math.exp(-rate * dt);

export const sign = (v: number): number => (v < 0 ? -1 : v > 0 ? 1 : 0);

export const TAU = Math.PI * 2;

/** Shortest signed angular delta from `a` to `b`, in radians. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

export const dampAngle = (current: number, target: number, rate: number, dt: number): number =>
  current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

/**
 * mulberry32 — 32-bit state, fast, good enough distribution for gameplay noise.
 * State is a plain number so it serialises into snapshots for free.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Symmetric noise in [-amount, amount]. */
  noise(amount: number): number {
    return (this.next() * 2 - 1) * amount;
  }

  /** Approximate standard normal via the mean of 3 uniforms (cheap, bounded). */
  gaussian(mean = 0, stdDev = 1): number {
    const u = (this.next() + this.next() + this.next()) / 3;
    return mean + (u - 0.5) * 3.4641016 * stdDev;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }

  getState(): number {
    return this.state;
  }

  setState(state: number): void {
    this.state = state >>> 0;
  }
}

/** Deterministic 32-bit string hash, for turning seed phrases into RNG seeds. */
export const hashString = (str: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
