import { clamp } from '../engine/math';
import type { BallState, PlayerInput, PlayerState, ShotType } from '../engine/types';
import { emptyInput } from '../engine/types';

/**
 * Controls.
 *
 * The shot you play is not chosen from a menu of ten buttons — it comes from a
 * modifier plus the direction you are pushing, which is how you actually think
 * about squash. Push forward and tap for a drive; hold touch and pull back for a
 * lob; hold touch and push forward for a drop. Two players share a keyboard for
 * local matches, and gamepads work for either.
 */

export interface KeyMap {
  up: string;
  down: string;
  left: string;
  right: string;
  swing: string;
  /** Soft shots: drop and lob. */
  touch: string;
  /** Hard shots: kill and volley. */
  power: string;
  boast: string;
  lunge: string;
  appeal: string;
  review: string;
}

export const KEYMAP_P1: KeyMap = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  swing: 'Space',
  touch: 'KeyQ',
  power: 'KeyE',
  boast: 'KeyR',
  lunge: 'ShiftLeft',
  appeal: 'KeyT',
  review: 'KeyY',
};

export const KEYMAP_P2: KeyMap = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  swing: 'Slash',
  touch: 'Period',
  power: 'Comma',
  boast: 'KeyM',
  lunge: 'ShiftRight',
  appeal: 'KeyP',
  review: 'KeyO',
};

export const KEY_LABELS: Record<string, string> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyQ: 'Q',
  KeyE: 'E',
  KeyR: 'R',
  KeyT: 'T',
  KeyY: 'Y',
  KeyM: 'M',
  KeyO: 'O',
  KeyP: 'P',
  Space: 'Space',
  Slash: '/',
  Period: '.',
  Comma: ',',
  ShiftLeft: 'Shift',
  ShiftRight: 'R-Shift',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/**
 * Tracks which keys are down. A single listener pair serves every local player,
 * and `pressedThisFrame` gives the rising edge the swing needs.
 */
export class KeyboardTracker {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    // Stop the page scrolling out from under the match.
    if (
      e.code === 'Space' ||
      e.code.startsWith('Arrow') ||
      e.code === 'Slash' ||
      e.code === 'Quote'
    ) {
      e.preventDefault();
    }
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };

  private onBlur = () => {
    // Losing focus mid-swing should not leave a key stuck down.
    this.down.clear();
    this.pressed.clear();
  };

  attach(): void {
    if (this.attached || typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.attached = false;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call once per simulation tick, after all inputs have been read. */
  endFrame(): void {
    this.pressed.clear();
  }
}

/**
 * Work out which shot the player is asking for from the modifier they are
 * holding and the direction they are pushing.
 */
export const resolveShot = (
  modifiers: { touch: boolean; power: boolean; boast: boolean },
  moveX: number,
  moveZ: number,
  player: PlayerState,
  ball: BallState,
): ShotType => {
  if (modifiers.boast) return 'boast';

  // Pushing back (positive z) asks for height, pushing forward asks for depth.
  const pullingBack = moveZ > 0.35;
  const pushingForward = moveZ < -0.35;

  if (modifiers.touch) {
    if (pullingBack) return 'lob';
    // A touch shot aimed hard across the court is a hunt for the nick.
    if (Math.abs(moveX) > 0.6 && pushingForward) return 'nick';
    return 'drop';
  }

  if (modifiers.power) {
    // Taking it out of the air is a volley; off the bounce it is a kill.
    const inAir = ball.floorBounces === 0 && ball.pos.y > 0.75;
    return inAir ? 'volley' : 'kill';
  }

  // Default: length. Straight unless you are clearly aiming across.
  const side = Math.sign(player.pos.x || 1);
  const aimingAcross = moveX !== 0 && Math.sign(moveX) !== side && Math.abs(moveX) > 0.45;
  return aimingAcross ? 'crossCourt' : 'drive';
};

/** Read one local player's input for this tick. */
export const readKeyboardInput = (
  keys: KeyboardTracker,
  map: KeyMap,
  player: PlayerState,
  ball: BallState,
): PlayerInput => {
  const input = emptyInput();

  const moveX = (keys.isDown(map.right) ? 1 : 0) - (keys.isDown(map.left) ? 1 : 0);
  // "Up" on the keyboard means towards the front wall, which is -z.
  const moveZ = (keys.isDown(map.down) ? 1 : 0) - (keys.isDown(map.up) ? 1 : 0);

  input.moveX = moveX;
  input.moveZ = moveZ;

  const modifiers = {
    touch: keys.isDown(map.touch),
    power: keys.isDown(map.power),
    boast: keys.isDown(map.boast),
  };

  input.shot = resolveShot(modifiers, moveX, moveZ, player, ball);
  // Aim follows the same stick that drives movement: push where you want it.
  input.aimX = clamp(moveX, -1, 1);
  input.aimY = clamp(moveZ, -1, 1);

  input.swingHeld = keys.isDown(map.swing);
  input.swingPressed = keys.wasPressed(map.swing);
  input.serve = keys.wasPressed(map.swing);
  input.lunge = keys.isDown(map.lunge);
  input.appeal = keys.wasPressed(map.appeal);
  input.review = keys.wasPressed(map.review);

  return input;
};

// ---------------------------------------------------------------------------
// Gamepad
// ---------------------------------------------------------------------------

const DEADZONE = 0.22;

const applyDeadzone = (value: number): number =>
  Math.abs(value) < DEADZONE ? 0 : (value - Math.sign(value) * DEADZONE) / (1 - DEADZONE);

/** Tracks button edges per pad, since the Gamepad API only reports state. */
export class GamepadTracker {
  private previous = new Map<number, boolean[]>();

  read(index: number, player: PlayerState, ball: BallState): PlayerInput | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pad = navigator.getGamepads()[index];
    if (!pad) return null;

    const input = emptyInput();
    const before = this.previous.get(index) ?? [];
    const pressed = (button: number) => (pad.buttons[button]?.pressed ?? false) && !before[button];
    const held = (button: number) => pad.buttons[button]?.pressed ?? false;

    input.moveX = applyDeadzone(pad.axes[0] ?? 0);
    input.moveZ = applyDeadzone(pad.axes[1] ?? 0);

    const modifiers = {
      touch: held(2), // X / Square
      power: held(1), // B / Circle
      boast: held(3), // Y / Triangle
    };
    input.shot = resolveShot(modifiers, input.moveX, input.moveZ, player, ball);

    // Right stick aims independently when it is being used.
    const aimX = applyDeadzone(pad.axes[2] ?? 0);
    const aimY = applyDeadzone(pad.axes[3] ?? 0);
    input.aimX = aimX !== 0 ? aimX : input.moveX;
    input.aimY = aimY !== 0 ? aimY : input.moveZ;

    input.swingHeld = held(0);
    input.swingPressed = pressed(0);
    input.serve = pressed(0);
    input.lunge = held(5) || held(7); // Right bumper / trigger
    input.appeal = pressed(4); // Left bumper
    input.review = pressed(6); // Left trigger

    this.previous.set(
      index,
      pad.buttons.map((b) => b.pressed),
    );
    return input;
  }

  static connected(): number[] {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads())
      .map((pad, i) => (pad ? i : -1))
      .filter((i) => i >= 0);
  }
}

/** Touch controls state, written by the on-screen pad and read by the loop. */
export interface TouchState {
  moveX: number;
  moveZ: number;
  swingHeld: boolean;
  swingPressed: boolean;
  touch: boolean;
  power: boolean;
  boast: boolean;
  lunge: boolean;
  appeal: boolean;
}

export const emptyTouchState = (): TouchState => ({
  moveX: 0,
  moveZ: 0,
  swingHeld: false,
  swingPressed: false,
  touch: false,
  power: false,
  boast: false,
  lunge: false,
  appeal: false,
});

export const readTouchInput = (
  touch: TouchState,
  player: PlayerState,
  ball: BallState,
): PlayerInput => {
  const input = emptyInput();
  input.moveX = touch.moveX;
  input.moveZ = touch.moveZ;
  input.shot = resolveShot(
    { touch: touch.touch, power: touch.power, boast: touch.boast },
    touch.moveX,
    touch.moveZ,
    player,
    ball,
  );
  input.aimX = touch.moveX;
  input.aimY = touch.moveZ;
  input.swingHeld = touch.swingHeld;
  input.swingPressed = touch.swingPressed;
  input.serve = touch.swingPressed;
  input.lunge = touch.lunge;
  input.appeal = touch.appeal;
  return input;
};
