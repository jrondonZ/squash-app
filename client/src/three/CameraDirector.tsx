import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { COURT } from '../engine/constants';
import { clamp, clamp01, damp } from '../engine/math';
import type { WorldState } from '../engine/types';

/**
 * The camera operator.
 *
 * Televised squash is shot from one place — high behind the glass back wall,
 * because it is the only angle from which both players and the front wall are
 * visible at once. That is the default here, with a slow push and a gentle
 * lateral drift that follows the play, the way a real operator works. The other
 * modes exist for the moments broadcast coverage cuts away: an over-the-shoulder
 * view for playing, and a free orbit for replays and reviews.
 */

export type CameraMode = 'broadcast' | 'follow' | 'shoulder' | 'replay' | 'overhead' | 'sideline';

export interface CameraDirectorProps {
  state: WorldState;
  mode: CameraMode;
  /** Which player the shoulder camera sits behind. */
  perspectiveOf: 0 | 1;
  /** Slow-motion factor, used to calm the camera during replays. */
  timeScale?: number;
  /** Manual orbit offset in radians, driven by dragging during a replay. */
  orbit?: { azimuth: number; elevation: number; distance: number };
  /** Extra shake on big impacts, 0–1. */
  impact?: number;
}

const _desired = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _current = new THREE.Vector3();

export const CameraDirector = ({
  state,
  mode,
  perspectiveOf,
  timeScale = 1,
  orbit,
  impact = 0,
}: CameraDirectorProps) => {
  const { camera } = useThree();
  const smoothedTarget = useRef(new THREE.Vector3(0, 1.4, COURT.length * 0.55));
  const shake = useRef(0);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);

    const ball = state.ball;
    const me = state.players[perspectiveOf];
    const them = state.players[perspectiveOf === 0 ? 1 : 0];

    // What the camera is interested in: mostly the ball, pulled towards the
    // midpoint of the two players so it never loses either of them.
    const midX = (me.pos.x + them.pos.x) / 2;
    const midZ = (me.pos.z + them.pos.z) / 2;
    _lookAt.set(
      ball.live ? ball.pos.x * 0.55 + midX * 0.45 : midX,
      ball.live ? clamp(ball.pos.y * 0.4 + 0.9, 0.8, 2.4) : 1.2,
      ball.live ? ball.pos.z * 0.4 + midZ * 0.6 : midZ,
    );

    // Ease the target rather than snapping — this is the difference between a
    // camera operator and a security camera.
    smoothedTarget.current.x = damp(smoothedTarget.current.x, _lookAt.x, 3.2, delta);
    smoothedTarget.current.y = damp(smoothedTarget.current.y, _lookAt.y, 2.6, delta);
    smoothedTarget.current.z = damp(smoothedTarget.current.z, _lookAt.z, 3.2, delta);

    switch (mode) {
      case 'broadcast': {
        // The classic angle: behind and above the glass back wall. Drifts a
        // little with the play but never swings around.
        _desired.set(
          smoothedTarget.current.x * 0.24,
          4.9,
          COURT.length + 6.2,
        );
        break;
      }
      case 'follow': {
        // Tighter, and pushes in as the rally moves to the front of the court.
        const depth = clamp01(smoothedTarget.current.z / COURT.length);
        _desired.set(
          smoothedTarget.current.x * 0.42,
          3.4 + depth * 1.1,
          COURT.length + 2.6 + depth * 2.6,
        );
        break;
      }
      case 'shoulder': {
        // Over the player's shoulder, looking down the court.
        const behind = 2.05;
        _desired.set(
          me.pos.x * 0.72,
          1.95,
          clamp(me.pos.z + behind, 2.4, COURT.length + 1.4),
        );
        break;
      }
      case 'overhead': {
        // Straight down — the angle a referee wishes they had.
        _desired.set(0, 11.4, COURT.length / 2 + 0.01);
        break;
      }
      case 'sideline': {
        // Through the side glass, the angle that shows depth of shot best.
        _desired.set(COURT.halfWidth + 5.4, 2.6, smoothedTarget.current.z);
        break;
      }
      case 'replay': {
        // Free orbit around the point of interest.
        const azimuth = orbit?.azimuth ?? 0.4;
        const elevation = orbit?.elevation ?? 0.42;
        const distance = orbit?.distance ?? 7.5;
        _desired.set(
          smoothedTarget.current.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
          clamp(smoothedTarget.current.y + Math.sin(elevation) * distance, 0.8, 12),
          smoothedTarget.current.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
        );
        break;
      }
    }

    // Slow motion calms the camera down as well as the action.
    const responsiveness = mode === 'shoulder' ? 7.5 : 2.4;
    const rate = responsiveness * clamp(timeScale, 0.35, 1);

    _current.copy(camera.position);
    camera.position.set(
      damp(_current.x, _desired.x, rate, delta),
      damp(_current.y, _desired.y, rate, delta),
      damp(_current.z, _desired.z, rate, delta),
    );

    // Impact shake, decaying fast so it punctuates rather than distracts.
    shake.current = Math.max(shake.current, impact);
    if (shake.current > 0.001) {
      const magnitude = shake.current * 0.055;
      camera.position.x += (Math.random() - 0.5) * magnitude;
      camera.position.y += (Math.random() - 0.5) * magnitude;
      shake.current = damp(shake.current, 0, 9, delta);
    }

    camera.lookAt(smoothedTarget.current);
  });

  return null;
};

/** Sensible starting position so the first frame is not looking at the void. */
export const DEFAULT_CAMERA = {
  position: [0, 4.9, COURT.length + 6.2] as [number, number, number],
  fov: 44,
  near: 0.05,
  far: 120,
};
