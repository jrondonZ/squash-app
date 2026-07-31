import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { COURT } from '../engine/constants';

/**
 * Everything outside the glass.
 *
 * A show court is lit from directly above and surrounded by darkness with a
 * crowd you sense more than see. That contrast is what makes the court read as
 * a lit box floating in a black arena, which is the entire visual identity of
 * televised squash.
 */

/** Tiered banks of seating, rendered as instanced blocks rather than people. */
const Crowd = ({ seed = 1 }: { seed?: number }) => {
  const mesh = useRef<THREE.InstancedMesh>(null);

  const { count, matrices, colors } = useMemo(() => {
    const rows = 9;
    const perRow = 46;
    const sides = 2;
    const total = rows * perRow * sides;

    const matrices = new Float32Array(total * 16);
    const colors = new Float32Array(total * 3);
    const dummy = new THREE.Object3D();
    const colour = new THREE.Color();

    // Deterministic scatter so the crowd does not reshuffle on every render.
    let s = seed * 9301 + 49297;
    const rand = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };

    let i = 0;
    for (let side = 0; side < sides; side++) {
      const direction = side === 0 ? -1 : 1;
      for (let row = 0; row < rows; row++) {
        for (let seat = 0; seat < perRow; seat++) {
          const distance = COURT.halfWidth + 2.6 + row * 0.95;
          const height = 0.5 + row * 0.42;
          const z = -3 + (seat / perRow) * (COURT.length + 8);

          dummy.position.set(
            direction * distance + (rand() - 0.5) * 0.25,
            height,
            z + (rand() - 0.5) * 0.3,
          );
          dummy.scale.setScalar(0.32 + rand() * 0.12);
          dummy.rotation.y = rand() * Math.PI;
          dummy.updateMatrix();
          dummy.matrix.toArray(matrices, i * 16);

          // Muted, desaturated tones — a crowd in the dark, not a sweet shop.
          const shade = 0.1 + rand() * 0.22;
          colour.setHSL(rand(), 0.18, shade);
          colour.toArray(colors, i * 3);
          i++;
        }
      }
    }
    return { count: total, matrices, colors };
  }, [seed]);

  useFrame(() => {
    const instanced = mesh.current;
    if (!instanced || instanced.userData.initialised) return;
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      matrix.fromArray(matrices, i * 16);
      instanced.setMatrixAt(i, matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.userData.initialised = true;
  });

  const colorAttribute = useMemo(() => new THREE.InstancedBufferAttribute(colors, 3), [colors]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <capsuleGeometry args={[0.22, 0.34, 3, 6]}>
        <instancedBufferAttribute attach="attributes-color" args={[colorAttribute.array, 3]} />
      </capsuleGeometry>
      <meshStandardMaterial vertexColors roughness={0.95} />
    </instancedMesh>
  );
};

/** The LED ribbon boards that ring a tour court. */
const RibbonBoards = ({ accent = '#00d4ff' }: { accent?: string }) => {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (!material.current) return;
    // A slow pulse, so the boards feel alive without pulling the eye.
    const pulse = 0.55 + Math.sin(clock.elapsedTime * 1.1) * 0.12;
    material.current.opacity = pulse;
  });

  return (
    <group>
      {/* Boards sit at the foot of the seating on each side, facing the court,
          low enough that they light the floor rather than the play. */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={side}
          position={[side * (COURT.halfWidth + 1.9), 0.3, COURT.length / 2]}
          rotation={[0, side * (Math.PI / 2), 0]}
        >
          <planeGeometry args={[COURT.length + 3, 0.55]} />
          <meshBasicMaterial
            ref={material}
            color={accent}
            transparent
            opacity={0.5}
            toneMapped={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      {/* And one across the back, behind the glass, as every show court has. */}
      <mesh position={[0, 0.3, COURT.length + 2.4]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[COURT.width + 3, 0.55]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={0.42}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

export interface ArenaProps {
  accent?: string;
  /** Drop the house lights during a review or a replay. */
  dimmed?: boolean;
}

export const Arena = ({ accent = '#00d4ff', dimmed = false }: ArenaProps) => {
  const intensity = dimmed ? 0.4 : 1;

  return (
    <group>
      {/* Seating decks, so the crowd is not floating in the dark. */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`deck-${side}`}
          position={[side * (COURT.halfWidth + 6.4), 1.7, COURT.length / 2]}
          rotation={[0, 0, side * -0.42]}
        >
          <boxGeometry args={[9.4, 0.3, COURT.length + 9]} />
          <meshStandardMaterial color="#0b0e14" roughness={0.95} />
        </mesh>
      ))}

      {/* The arena floor, well below and beyond the court. */}
      <mesh position={[0, -0.06, COURT.length / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[70, 70]} />
        <meshStandardMaterial color="#07090d" roughness={1} />
      </mesh>

      <Crowd />
      <RibbonBoards accent={accent} />

      {/* ---- Lighting -------------------------------------------------- */}
      {/* Low ambient so the shadows stay deep. */}
      <hemisphereLight args={['#8fb6d9', '#0a0d12', 0.42 * intensity]} />

      {/* The rig: four hard lights directly above the court, as on a real
          show court, plus a soft fill from the front so faces are not black. */}
      {[
        [-1.6, 2.2],
        [1.6, 2.2],
        [-1.6, 7.0],
        [1.6, 7.0],
      ].map(([x, z], i) => (
        <spotLight
          key={i}
          position={[x, 8.4, z]}
          target-position={[x * 0.4, 0, z]}
          angle={0.78}
          penumbra={0.85}
          intensity={26 * intensity}
          distance={30}
          decay={1.35}
          color="#f4f8ff"
          castShadow={i === 0}
          shadow-mapSize={[1024, 1024]}
          shadow-bias={-0.0008}
        />
      ))}

      <directionalLight
        position={[0, 5, -6]}
        intensity={0.5 * intensity}
        color="#cfe4ff"
      />

      {/* Accent wash from the ribbon boards, bounced back onto the players. */}
      <pointLight position={[0, 1.2, COURT.length + 2]} intensity={6 * intensity} distance={12} color={accent} />
    </group>
  );
};
