import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { BALL } from '../engine/constants';
import { clamp01, remap } from '../engine/math';
import type { BallState } from '../engine/types';

/**
 * The ball, and the trail behind it.
 *
 * A squash ball is 40 mm of black rubber moving at up to 70 m/s. On screen that
 * is both too small to follow and too fast to track, which is why televised
 * squash leans on ball-tracking graphics. The trail here is the same idea: a
 * fading ribbon of recent positions, brightening with speed, so the eye can
 * follow the rally. The two yellow dots are there too — and they spin at the
 * ball's actual angular velocity.
 */

const TRAIL_LENGTH = 34;

export interface BallViewProps {
  ball: BallState;
  /** Hide the trail during replays where the Hawk-Eye ribbon is shown instead. */
  showTrail?: boolean;
  accent?: string;
}

export const BallView = ({ ball, showTrail = true, accent = '#ffe066' }: BallViewProps) => {
  const group = useRef<THREE.Group>(null);
  const core = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  const trail = useRef<THREE.Line>(null);

  // Ring buffer of recent positions.
  const history = useRef<Float32Array>(new Float32Array(TRAIL_LENGTH * 3));
  const filled = useRef(0);

  const trailGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LENGTH * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_LENGTH * 3), 3));
    return geo;
  }, []);

  const trailColor = useMemo(() => new THREE.Color(accent), [accent]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    if (!group.current) return;

    group.current.position.set(ball.pos.x, ball.pos.y, ball.pos.z);

    const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);

    // Spin the ball for real, about its own angular velocity axis.
    if (core.current) {
      const spinRate = Math.hypot(ball.spin.x, ball.spin.y, ball.spin.z);
      if (spinRate > 0.01) {
        const axis = new THREE.Vector3(ball.spin.x, ball.spin.y, ball.spin.z).normalize();
        core.current.rotateOnWorldAxis(axis, spinRate * delta);
      }
    }

    // A fast ball reads as a brighter, slightly larger smear.
    if (glow.current) {
      const heat = clamp01(speed / 55);
      glow.current.scale.setScalar(1 + heat * 1.9);
      const material = glow.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.05 + heat * 0.32;
    }

    // --- Trail -------------------------------------------------------------
    if (!showTrail || !trail.current) return;

    const buffer = history.current;
    // Shift the ring buffer back one slot and append the new position.
    buffer.copyWithin(0, 3);
    buffer[(TRAIL_LENGTH - 1) * 3] = ball.pos.x;
    buffer[(TRAIL_LENGTH - 1) * 3 + 1] = ball.pos.y;
    buffer[(TRAIL_LENGTH - 1) * 3 + 2] = ball.pos.z;
    filled.current = Math.min(TRAIL_LENGTH, filled.current + 1);

    const positions = trailGeometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = trailGeometry.getAttribute('color') as THREE.BufferAttribute;
    const start = TRAIL_LENGTH - filled.current;

    for (let i = 0; i < TRAIL_LENGTH; i++) {
      // Anything before the buffer has filled collapses onto the ball, so no
      // stray line shoots in from the origin on the first frames.
      const source = i < start ? TRAIL_LENGTH - 1 : i;
      positions.setXYZ(i, buffer[source * 3], buffer[source * 3 + 1], buffer[source * 3 + 2]);

      const age = i / (TRAIL_LENGTH - 1);
      const brightness = age * age * remap(speed, 0, 50, 0.25, 1);
      colors.setXYZ(
        i,
        trailColor.r * brightness,
        trailColor.g * brightness,
        trailColor.b * brightness,
      );
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    trailGeometry.computeBoundingSphere();
  });

  return (
    <>
      <group ref={group}>
        <mesh ref={core} castShadow>
          <sphereGeometry args={[BALL.radius, 16, 14]} />
          <meshStandardMaterial color="#16181c" roughness={0.78} metalness={0.02} />
        </mesh>

        {/* The double yellow dot. */}
        <mesh position={[0, BALL.radius * 0.98, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[BALL.radius * 0.3, 10]} />
          <meshBasicMaterial color="#ffd400" toneMapped={false} />
        </mesh>
        <mesh position={[0, -BALL.radius * 0.98, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[BALL.radius * 0.3, 10]} />
          <meshBasicMaterial color="#ffd400" toneMapped={false} />
        </mesh>

        <mesh ref={glow}>
          <sphereGeometry args={[BALL.radius * 1.9, 12, 10]} />
          <meshBasicMaterial color={accent} transparent opacity={0.12} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>

      {showTrail && (
        // @ts-expect-error — three's Line is available as an r3f primitive.
        <line ref={trail} geometry={trailGeometry} frustumCulled={false}>
          <lineBasicMaterial vertexColors transparent opacity={0.85} toneMapped={false} depthWrite={false} />
        </line>
      )}
    </>
  );
};

/**
 * The Hawk-Eye style flight-path ribbon used in replays and video reviews:
 * the exact path the ball took, drawn all at once instead of trailing behind it.
 */
export const FlightPath = ({
  points,
  color = '#00e0ff',
}: {
  points: Array<{ x: number; y: number; z: number }>;
  color?: string;
}) => {
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
    );
    return new THREE.TubeGeometry(curve, Math.min(240, points.length * 2), 0.012, 6, false);
  }, [points]);

  if (!geometry) return null;

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} transparent opacity={0.72} toneMapped={false} />
    </mesh>
  );
};

/**
 * A marker where the ball touched down — the bounce graphic every review uses
 * to show whether a ball was in or out.
 */
export const BounceMarker = ({
  position,
  color = '#ff3860',
  label,
}: {
  position: { x: number; y: number; z: number };
  color?: string;
  label?: string;
}) => {
  const ring = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ring.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 3.4) * 0.12;
    ring.current.scale.setScalar(pulse);
  });

  return (
    <group position={[position.x, position.y + 0.006, position.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.05, 0.085, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.05, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.28} toneMapped={false} />
      </mesh>
      {label && (
        <mesh position={[0, 0.35, 0]}>
          <planeGeometry args={[0.001, 0.001]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      )}
    </group>
  );
};
