import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { PLAYER } from '../engine/constants';
import { clamp01, damp } from '../engine/math';
import type { PlayerState } from '../engine/types';
import type { Character } from '../data/roster';

/**
 * A player.
 *
 * Built from primitives rather than a rigged mesh: the whole point is that the
 * animation is driven by the simulation, not by a clip. The run cycle comes
 * from actual velocity, the racket arm comes from the actual swing phase, the
 * stance drops when the engine says the player is lunging, and posture sags as
 * stamina drains. Nothing here is decorative — if the model looks tired, the
 * player *is* tired.
 */

const SKIN = '#c99566';

export interface PlayerModelProps {
  player: PlayerState;
  character: Character;
  /** Draw a highlight ring so you can find yourself instantly. */
  highlight?: boolean;
  highlightColor?: string;
}

export const PlayerModel = ({
  player,
  character,
  highlight = false,
  highlightColor = '#00e0ff',
}: PlayerModelProps) => {
  const root = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const racketArm = useRef<THREE.Group>(null);
  const offArm = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);

  // Phase of the run cycle, advanced by distance travelled rather than by time
  // so the legs stay in step with the actual movement at any speed.
  const stride = useRef(0);
  const crouch = useRef(0);

  const kit = useMemo(
    () => ({
      shirt: new THREE.MeshStandardMaterial({ color: character.kit.primary, roughness: 0.72 }),
      shorts: new THREE.MeshStandardMaterial({ color: character.kit.secondary, roughness: 0.78 }),
      trim: new THREE.MeshStandardMaterial({
        color: character.kit.accent,
        roughness: 0.4,
        metalness: 0.15,
      }),
      skin: new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.86 }),
      shoe: new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.6 }),
    }),
    [character.kit.primary, character.kit.secondary, character.kit.accent],
  );

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    if (!root.current) return;

    root.current.position.set(player.pos.x, 0, player.pos.z);
    root.current.rotation.y = player.facing;

    const speed = Math.hypot(player.vel.x, player.vel.z);
    const speedRatio = clamp01(speed / PLAYER.baseMaxSpeed);

    // --- Legs -------------------------------------------------------------
    stride.current += speed * delta * 2.6;
    const swing = Math.sin(stride.current) * (0.35 + speedRatio * 0.75);
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;

    // --- Stance -----------------------------------------------------------
    // Lunging, low balls and exhaustion all drop the centre of gravity.
    const lungeTarget = player.swing.lunging && player.swing.phase !== 'idle' ? 1 : 0;
    const staminaSag = 1 - clamp01(player.stamina / PLAYER.maxStamina);
    const target = Math.max(lungeTarget, staminaSag * 0.35, speedRatio * 0.22);
    crouch.current = damp(crouch.current, target, 9, delta);

    if (hips.current) {
      hips.current.position.y = 0.92 - crouch.current * 0.3;
      hips.current.rotation.x = crouch.current * 0.26;
    }
    if (torso.current) {
      // Lean into the direction of travel.
      torso.current.rotation.x = 0.08 + speedRatio * 0.22 + crouch.current * 0.2;
    }
    if (head.current) {
      // The head stays level and tracks forward, however folded the body is.
      head.current.rotation.x = -(0.08 + speedRatio * 0.22 + crouch.current * 0.2);
    }

    // --- Racket arm -------------------------------------------------------
    // Driven directly by the swing state machine, so what you see is exactly
    // what the physics is about to do.
    let armAngle: number;
    let armTwist = 0;
    switch (player.swing.phase) {
      case 'backswing': {
        const t = clamp01(player.swing.elapsed / 0.18);
        armAngle = -0.4 - t * 2.1;
        armTwist = t * 0.9;
        break;
      }
      case 'contact':
        armAngle = 0.55;
        armTwist = -0.3;
        break;
      case 'recovery': {
        const t = clamp01(player.swing.elapsed / PLAYER.recoveryTime);
        armAngle = 0.55 + t * 0.5;
        armTwist = -0.3 + t * 0.3;
        break;
      }
      default:
        // Idle: a ready position, with a little arm swing while running.
        armAngle = -0.35 - Math.sin(stride.current) * speedRatio * 0.4;
    }

    if (racketArm.current) {
      const side = character.handed === 'left' ? -1 : 1;
      racketArm.current.rotation.x = armAngle;
      racketArm.current.rotation.z = side * (0.35 + armTwist);
      // Backhand swings come across the body.
      racketArm.current.rotation.y =
        player.swing.side === 'backhand' && player.swing.phase !== 'idle' ? -side * 1.15 : 0;
    }
    if (offArm.current) {
      offArm.current.rotation.x = 0.2 + Math.sin(stride.current + Math.PI) * speedRatio * 0.5;
    }
  });

  const handSide = character.handed === 'left' ? -1 : 1;

  return (
    <group ref={root}>
      {highlight && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.52, 32]} />
          <meshBasicMaterial color={highlightColor} transparent opacity={0.55} toneMapped={false} />
        </mesh>
      )}

      <group ref={hips} position={[0, 0.92, 0]}>
        {/* ---- Legs ---- */}
        <group ref={legL} position={[-0.13, 0, 0]}>
          <mesh position={[0, -0.26, 0]} castShadow material={kit.shorts}>
            <capsuleGeometry args={[0.085, 0.28, 3, 8]} />
          </mesh>
          <mesh position={[0, -0.62, 0]} castShadow material={kit.skin}>
            <capsuleGeometry args={[0.072, 0.3, 3, 8]} />
          </mesh>
          <mesh position={[0, -0.86, 0.04]} castShadow material={kit.shoe}>
            <boxGeometry args={[0.14, 0.09, 0.26]} />
          </mesh>
        </group>
        <group ref={legR} position={[0.13, 0, 0]}>
          <mesh position={[0, -0.26, 0]} castShadow material={kit.shorts}>
            <capsuleGeometry args={[0.085, 0.28, 3, 8]} />
          </mesh>
          <mesh position={[0, -0.62, 0]} castShadow material={kit.skin}>
            <capsuleGeometry args={[0.072, 0.3, 3, 8]} />
          </mesh>
          <mesh position={[0, -0.86, 0.04]} castShadow material={kit.shoe}>
            <boxGeometry args={[0.14, 0.09, 0.26]} />
          </mesh>
        </group>

        {/* ---- Torso ---- */}
        <group ref={torso}>
          <mesh position={[0, 0.26, 0]} castShadow material={kit.shirt}>
            <capsuleGeometry args={[0.19, 0.34, 4, 10]} />
          </mesh>
          {/* Kit trim across the chest. */}
          <mesh position={[0, 0.34, 0.16]} material={kit.trim}>
            <boxGeometry args={[0.3, 0.05, 0.06]} />
          </mesh>

          {/* ---- Head ---- */}
          <group ref={head} position={[0, 0.63, 0]}>
            <mesh castShadow material={kit.skin}>
              <sphereGeometry args={[0.115, 16, 14]} />
            </mesh>
            {/* Hair, in the kit's accent so characters read apart at distance. */}
            <mesh position={[0, 0.045, -0.02]} material={kit.trim}>
              <sphereGeometry args={[0.113, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
            </mesh>
          </group>

          {/* ---- Off arm ---- */}
          <group ref={offArm} position={[-handSide * 0.23, 0.42, 0]}>
            <mesh position={[0, -0.17, 0]} castShadow material={kit.skin}>
              <capsuleGeometry args={[0.055, 0.24, 3, 8]} />
            </mesh>
            <mesh position={[0, -0.42, 0]} castShadow material={kit.skin}>
              <capsuleGeometry args={[0.048, 0.2, 3, 8]} />
            </mesh>
          </group>

          {/* ---- Racket arm ---- */}
          <group ref={racketArm} position={[handSide * 0.23, 0.42, 0]}>
            <mesh position={[0, -0.17, 0]} castShadow material={kit.skin}>
              <capsuleGeometry args={[0.058, 0.24, 3, 8]} />
            </mesh>
            <mesh position={[0, -0.42, 0]} castShadow material={kit.skin}>
              <capsuleGeometry args={[0.05, 0.2, 3, 8]} />
            </mesh>

            {/* ---- Hand and racket ----
                The grip starts at the wrist — the forearm capsule ends at
                -0.52, so anything lower than that reads as a racket floating
                loose beside the player rather than being held. */}
            <mesh position={[0, -0.55, 0]} castShadow material={kit.skin}>
              <sphereGeometry args={[0.05, 10, 8]} />
            </mesh>
            <group position={[0, -0.55, 0]} rotation={[0.35, 0, handSide * 0.28]}>
              <mesh position={[0, -0.11, 0]} castShadow>
                <cylinderGeometry args={[0.016, 0.019, 0.22, 8]} />
                <meshStandardMaterial color="#15181d" roughness={0.85} />
              </mesh>
              {/* Throat, bridging the handle to the head. */}
              <mesh position={[0, -0.25, 0]} castShadow>
                <cylinderGeometry args={[0.012, 0.014, 0.09, 6]} />
                <meshStandardMaterial color="#22262e" roughness={0.5} metalness={0.4} />
              </mesh>
              {/* Head: a flattened torus, with strings as a translucent disc. */}
              <mesh position={[0, -0.42, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <torusGeometry args={[0.135, 0.013, 8, 28]} />
                <meshStandardMaterial
                  color={character.kit.accent}
                  roughness={0.32}
                  metalness={0.55}
                />
              </mesh>
              <mesh position={[0, -0.42, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <circleGeometry args={[0.13, 24]} />
                <meshBasicMaterial
                  color="#ffffff"
                  transparent
                  opacity={0.14}
                  side={THREE.DoubleSide}
                />
              </mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
};
