import type { Simulation } from '../engine/world';
import type { PlayerInput, WorldState } from '../engine/types';

/**
 * Online play.
 *
 * The netcode is host-authoritative. One peer owns the simulation and is the
 * single source of truth for the ball, the score and every referee decision;
 * the other sends its inputs upstream and renders interpolated snapshots coming
 * back. Squash is the right sport for this model: the ball is shared, contested
 * and physically subtle, so two peers each simulating it independently would
 * disagree about who won the rally within a handful of exchanges — and there is
 * no way to reconcile that disagreement fairly after the fact.
 *
 * What keeps it playable for the guest is that the engine is deterministic, so
 * the guest can run the same simulation locally as a prediction and only
 * correct when the host's authoritative snapshot disagrees.
 */

export interface NetTransport {
  /** Called every tick by the match loop with the inputs it just used. */
  publish(sim: Simulation, inputs: [PlayerInput, PlayerInput]): void;
  close(): void;
  readonly role: 'host' | 'guest';
  readonly connected: boolean;
}

export interface NetHandlers {
  onRemoteInput?: (input: PlayerInput) => void;
  onSnapshot?: (state: WorldState) => void;
  onPeerJoined?: (info: { name: string; character: string }) => void;
  onPeerLeft?: () => void;
  onStart?: (config: { seed: string; characters: [string, string]; hostPlayer: 0 | 1 }) => void;
  onLatency?: (ms: number) => void;
}

type Envelope =
  | { t: 'input'; tick: number; input: PlayerInput }
  | { t: 'snap'; state: WorldState }
  | { t: 'join'; name: string; character: string }
  | { t: 'start'; seed: string; characters: [string, string]; hostPlayer: 0 | 1 }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'leave' };

/** Minimal shape of the ActionCable subscription we rely on. */
interface CableSubscription {
  send(data: unknown): void;
  perform(action: string, data?: unknown): void;
  unsubscribe(): void;
}

interface CableConsumer {
  subscriptions: {
    create(
      channel: { channel: string; room: string },
      callbacks: {
        connected?: () => void;
        disconnected?: () => void;
        received?: (data: unknown) => void;
      },
    ): CableSubscription;
  };
  disconnect(): void;
}

/**
 * ActionCable-backed transport. The Rails side is a pure relay: it never
 * simulates anything, it just fans messages out to the other peer in the room.
 */
export class CableTransport implements NetTransport {
  role: 'host' | 'guest';
  connected = false;

  private subscription: CableSubscription | null = null;
  private consumer: CableConsumer | null = null;
  private handlers: NetHandlers;
  private lastSnapshotAt = 0;
  private snapshotInterval: number;
  private pingHandle: number | null = null;

  constructor(
    consumer: CableConsumer,
    room: string,
    role: 'host' | 'guest',
    handlers: NetHandlers,
    snapshotRate = 20,
  ) {
    this.role = role;
    this.handlers = handlers;
    this.consumer = consumer;
    this.snapshotInterval = 1000 / snapshotRate;

    this.subscription = consumer.subscriptions.create(
      { channel: 'MatchChannel', room },
      {
        connected: () => {
          this.connected = true;
          this.startPinging();
        },
        disconnected: () => {
          this.connected = false;
          this.handlers.onPeerLeft?.();
        },
        received: (data) => this.receive(data as Envelope),
      },
    );
  }

  private startPinging(): void {
    if (typeof window === 'undefined') return;
    this.pingHandle = window.setInterval(() => {
      this.send({ t: 'ping', at: Date.now() });
    }, 2000);
  }

  private send(message: Envelope): void {
    this.subscription?.perform('relay', { payload: message });
  }

  private receive(message: Envelope): void {
    if (!message || typeof message !== 'object') return;

    switch (message.t) {
      case 'input':
        // Only the host acts on incoming inputs.
        if (this.role === 'host') this.handlers.onRemoteInput?.(message.input);
        break;
      case 'snap':
        if (this.role === 'guest') this.handlers.onSnapshot?.(message.state);
        break;
      case 'join':
        this.handlers.onPeerJoined?.({ name: message.name, character: message.character });
        break;
      case 'start':
        this.handlers.onStart?.({
          seed: message.seed,
          characters: message.characters,
          hostPlayer: message.hostPlayer,
        });
        break;
      case 'ping':
        this.send({ t: 'pong', at: message.at });
        break;
      case 'pong':
        this.handlers.onLatency?.(Date.now() - message.at);
        break;
      case 'leave':
        this.handlers.onPeerLeft?.();
        break;
    }
  }

  announce(name: string, character: string): void {
    this.send({ t: 'join', name, character });
  }

  startMatch(seed: string, characters: [string, string], hostPlayer: 0 | 1): void {
    this.send({ t: 'start', seed, characters, hostPlayer });
  }

  publish(sim: Simulation, inputs: [PlayerInput, PlayerInput]): void {
    if (!this.connected) return;

    if (this.role === 'guest') {
      // The guest is player 1 by convention; send only its own input.
      this.send({ t: 'input', tick: sim.state.tick, input: inputs[1] });
      return;
    }

    // The host publishes authoritative snapshots on a fixed wall-clock cadence,
    // not every tick — 60 full world states a second is far more bandwidth than
    // the guest needs to interpolate smoothly.
    const now = performance.now();
    if (now - this.lastSnapshotAt < this.snapshotInterval) return;
    this.lastSnapshotAt = now;
    this.send({ t: 'snap', state: sim.snapshot() });
  }

  close(): void {
    if (this.pingHandle !== null) clearInterval(this.pingHandle);
    this.send({ t: 'leave' });
    this.subscription?.unsubscribe();
    this.consumer?.disconnect();
    this.connected = false;
  }
}

/**
 * A loopback transport used by the local and single-player modes so the match
 * loop can always call `net.publish` without branching on the mode.
 */
export class NullTransport implements NetTransport {
  role: 'host' = 'host';
  connected = true;
  publish(): void {}
  close(): void {}
}
