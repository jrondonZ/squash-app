import { useMemo } from 'react';
import * as THREE from 'three';

import { COURT, SERVICE_BOX_BACK, sideWallOutHeight } from '../engine/constants';

/**
 * The show court.
 *
 * Modelled on the all-glass portable courts the World Tour plays its finals on:
 * an opaque front wall carrying the tin and the painted lines, three glass walls
 * so the crowd can see in, and a pale maple floor. Everything is built from the
 * real dimensions in `constants.ts`, so the court you look at and the court the
 * physics runs against are the same court.
 */

const LINE_RED = '#c8102e';
const LINE_WIDTH = 0.05;
const FLOOR_EPSILON = 0.004;

/** A painted line on the floor. */
const FloorLine = ({
  x = 0,
  z = 0,
  width,
  depth,
}: {
  x?: number;
  z?: number;
  width: number;
  depth: number;
}) => (
  <mesh position={[x, FLOOR_EPSILON, z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false}>
    <planeGeometry args={[width, depth]} />
    <meshBasicMaterial color={LINE_RED} toneMapped={false} />
  </mesh>
);

/** A painted line on the front wall. */
const WallLine = ({ y, height = LINE_WIDTH }: { y: number; height?: number }) => (
  <mesh position={[0, y, 0.012]}>
    <planeGeometry args={[COURT.width, height]} />
    <meshBasicMaterial color={LINE_RED} toneMapped={false} />
  </mesh>
);

/**
 * The out line on a side wall slopes from 4.57 m at the front to 2.13 m at the
 * back, so it cannot be a box — it is a thin quad built from four corners.
 */
const SideWallOutLine = ({ side }: { side: -1 | 1 }) => {
  const geometry = useMemo(() => {
    const x = side * (COURT.halfWidth - 0.01);
    const topFront = sideWallOutHeight(0);
    const topBack = sideWallOutHeight(COURT.length);
    const t = LINE_WIDTH;

    const positions = new Float32Array([
      x, topFront, 0,
      x, topFront - t, 0,
      x, topBack, COURT.length,
      x, topFront - t, 0,
      x, topBack - t, COURT.length,
      x, topBack, COURT.length,
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }, [side]);

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={LINE_RED} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
};

export interface CourtProps {
  /** Tin height in use — the tour tin is 430 mm. */
  tinHeight: number;
  /** Highlight the service box that is in play. */
  serveSide?: -1 | 1 | null;
  /** Dim the court for replays and reviews. */
  dimmed?: boolean;
}

export const Court = ({ tinHeight, serveSide = null, dimmed = false }: CourtProps) => {
  const halfLength = COURT.length / 2;

  // Glass.
  //
  // Physically accurate glass is almost invisible, which on screen reads as no
  // wall at all — the court loses its shape and the sloping out lines look like
  // they are floating in space. Real show-court glass is also toughened, held in
  // a frame and lit from above, so it catches light along its surface. We lean
  // into that: enough tint and specular response to see the panel, not enough to
  // obscure the play behind it.
  const glass = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#9fc4d8',
        transparent: true,
        opacity: 0.3,
        roughness: 0.14,
        metalness: 0.1,
        transmission: 0.62,
        thickness: 0.04,
        ior: 1.5,
        reflectivity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    [],
  );

  const frontWallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: dimmed ? '#8f9aa6' : '#eef1f5',
        roughness: 0.92,
        metalness: 0,
      }),
    [dimmed],
  );

  const floorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: dimmed ? '#8a7458' : '#d8b98a',
        roughness: 0.42,
        metalness: 0.02,
      }),
    [dimmed],
  );

  return (
    <group>
      {/* ---- Floor ---------------------------------------------------- */}
      <mesh
        position={[0, 0, halfLength]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        material={floorMaterial}
      >
        <planeGeometry args={[COURT.width, COURT.length]} />
      </mesh>

      {/* Short line, running the full width. */}
      <FloorLine z={COURT.shortLine} width={COURT.width} depth={LINE_WIDTH} />
      {/* Half-court line, from the short line to the back wall. */}
      <FloorLine
        z={COURT.shortLine + (COURT.length - COURT.shortLine) / 2}
        width={LINE_WIDTH}
        depth={COURT.length - COURT.shortLine}
      />
      {/* Each service box is closed by a back edge and an inner edge. Both run
          only across the 1.6 m box, not the full width of the court. */}
      {([-1, 1] as const).map((side) => (
        <group key={`box-${side}`}>
          <FloorLine
            x={(side * (COURT.halfWidth + COURT.serviceBoxSize)) / 2}
            z={SERVICE_BOX_BACK}
            width={COURT.serviceBoxSize}
            depth={LINE_WIDTH}
          />
          <FloorLine
            x={side * COURT.serviceBoxSize}
            z={COURT.shortLine + COURT.serviceBoxSize / 2}
            width={LINE_WIDTH}
            depth={COURT.serviceBoxSize}
          />
        </group>
      ))}

      {/* Highlight the box in play during the serve. */}
      {serveSide !== null && (
        <mesh
          position={[
            serveSide * (COURT.halfWidth + COURT.serviceBoxSize) / 2,
            FLOOR_EPSILON * 0.5,
            COURT.shortLine + COURT.serviceBoxSize / 2,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[COURT.serviceBoxSize, COURT.serviceBoxSize]} />
          <meshBasicMaterial color="#00e0ff" transparent opacity={0.09} toneMapped={false} />
        </mesh>
      )}

      {/* ---- Front wall ------------------------------------------------ */}
      <mesh
        position={[0, COURT.frontWallOutHeight / 2, -0.01]}
        receiveShadow
        material={frontWallMaterial}
      >
        <planeGeometry args={[COURT.width, COURT.frontWallOutHeight]} />
      </mesh>

      {/* The tin: a resonant board across the base of the front wall. */}
      <mesh position={[0, tinHeight / 2, 0.015]}>
        <boxGeometry args={[COURT.width, tinHeight, 0.03]} />
        <meshStandardMaterial color="#16324f" roughness={0.5} metalness={0.35} />
      </mesh>
      {/* Its top edge, which is the line that actually matters. */}
      <mesh position={[0, tinHeight, 0.03]}>
        <boxGeometry args={[COURT.width, 0.022, 0.035]} />
        <meshBasicMaterial color={LINE_RED} toneMapped={false} />
      </mesh>

      {/* Service line and front wall out line. */}
      <WallLine y={COURT.serviceLineHeight} />
      <WallLine y={COURT.frontWallOutHeight} height={0.07} />

      {/* ---- Glass side and back walls --------------------------------- */}
      {([-1, 1] as const).map((side) => (
        <mesh
          key={`side-${side}`}
          position={[side * COURT.halfWidth, COURT.frontWallOutHeight / 2, halfLength]}
          rotation={[0, -side * Math.PI / 2, 0]}
          material={glass}
        >
          <planeGeometry args={[COURT.length, COURT.frontWallOutHeight]} />
        </mesh>
      ))}
      {([-1, 1] as const).map((side) => (
        <SideWallOutLine key={`sideline-${side}`} side={side} />
      ))}

      <mesh
        position={[0, COURT.backWallOutHeight / 2 + 0.6, COURT.length]}
        rotation={[0, Math.PI, 0]}
        material={glass}
      >
        <planeGeometry args={[COURT.width, COURT.backWallOutHeight + 1.2]} />
      </mesh>
      {/* Back wall out line. */}
      <mesh position={[0, COURT.backWallOutHeight, COURT.length - 0.012]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[COURT.width, LINE_WIDTH]} />
        <meshBasicMaterial color={LINE_RED} toneMapped={false} />
      </mesh>

      {/* Structural frame. The corner posts and top rail are what actually read
          as "there is a wall here" from the broadcast angle. */}
      <group>
        {/* Corner posts at all four corners of the glass. */}
        {([-1, 1] as const).flatMap((side) =>
          [0, COURT.length].map((z) => (
            <mesh
              key={`post-${side}-${z}`}
              position={[side * COURT.halfWidth, COURT.frontWallOutHeight / 2, z]}
            >
              <boxGeometry args={[0.1, COURT.frontWallOutHeight, 0.1]} />
              <meshStandardMaterial color="#1b2028" roughness={0.35} metalness={0.75} />
            </mesh>
          )),
        )}

        {/* Top rail along each side wall, and across the back. */}
        {([-1, 1] as const).map((side) => (
          <mesh
            key={`rail-${side}`}
            position={[side * COURT.halfWidth, COURT.frontWallOutHeight, halfLength]}
          >
            <boxGeometry args={[0.12, 0.08, COURT.length]} />
            <meshStandardMaterial color="#12161c" roughness={0.45} metalness={0.65} />
          </mesh>
        ))}
        <mesh position={[0, COURT.frontWallOutHeight, COURT.length]}>
          <boxGeometry args={[COURT.width + 0.12, 0.08, 0.12]} />
          <meshStandardMaterial color="#12161c" roughness={0.45} metalness={0.65} />
        </mesh>

        {/* Skirting where the glass meets the floor, on all three glass walls. */}
        {([-1, 1] as const).map((side) => (
          <mesh key={`skirt-${side}`} position={[side * COURT.halfWidth, 0.05, halfLength]}>
            <boxGeometry args={[0.07, 0.1, COURT.length]} />
            <meshStandardMaterial color="#1b2028" roughness={0.6} metalness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 0.05, COURT.length]}>
          <boxGeometry args={[COURT.width, 0.1, 0.07]} />
          <meshStandardMaterial color="#1b2028" roughness={0.6} metalness={0.4} />
        </mesh>
      </group>
    </group>
  );
};
