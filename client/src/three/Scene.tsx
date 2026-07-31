import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';

import { Arena } from './Arena';
import { BallView, FlightPath, BounceMarker } from './BallView';
import { CameraDirector, DEFAULT_CAMERA, type CameraMode } from './CameraDirector';
import { Court } from './Court';
import { PlayerModel } from './PlayerModel';
import type { MatchEngine } from '../game/MatchEngine';
import type { WorldState } from '../engine/types';

/**
 * The 3D view.
 *
 * The whole scene reads directly from `engine.renderState` inside `useFrame`,
 * never from React state. That is deliberate: the simulation runs at 60 Hz and
 * pushing it through React would re-reconcile the entire tree every tick. React
 * owns the interface; three.js owns the court.
 */

/** Bridges the mutable engine state into the components that need to re-render. */
const SceneContents = ({ engine }: { engine: MatchEngine }) => {
  // A stable object the child components read every frame. Mutated, not replaced.
  const view = useRef<{ state: WorldState }>({ state: engine.renderState });
  const [, forceTick] = useState(0);
  const lastPhase = useRef(engine.renderState.rally.phase);

  useFrame(() => {
    view.current.state = engine.renderState;
    // Re-render only when something structural changes — a new phase, a replay
    // starting or ending — not on every frame.
    const phase = engine.renderState.rally.phase;
    if (phase !== lastPhase.current) {
      lastPhase.current = phase;
      forceTick((n) => n + 1);
    }
  });

  const state = view.current.state;
  const replay = engine.replay;

  const mode: CameraMode = replay.active
    ? replay.isReview
      ? 'sideline'
      : 'replay'
    : engine.settings.mode === 'spectate'
      ? 'broadcast'
      : 'follow';

  // The bounce the review is adjudicating, if there is one.
  const bounce = replay.path.length > 2 ? replay.path[replay.path.length - 1] : null;

  return (
    <>
      <color attach="background" args={['#04060a']} />
      <fog attach="fog" args={['#04060a', 22, 62]} />

      <Arena dimmed={replay.active} />
      <Court
        tinHeight={state.match.tinHeight}
        serveSide={state.rally.phase === 'preServe' ? state.rally.serveSide : null}
        dimmed={replay.active}
      />

      <LiveActors engine={engine} />

      {/* Hawk-Eye overlays, shown only during replays and reviews. */}
      {replay.active && replay.path.length > 1 && (
        <FlightPath points={replay.path} color={replay.isReview ? '#ff3860' : '#00e0ff'} />
      )}
      {replay.active && bounce && bounce.y < 0.1 && (
        <BounceMarker position={bounce} color={replay.isReview ? '#ff3860' : '#00e0ff'} />
      )}

      <CameraDirector
        state={state}
        mode={mode}
        perspectiveOf={engine.settings.localPlayer}
        timeScale={replay.active ? replay.speed : 1}
        impact={engine.impact}
      />
    </>
  );
};

/**
 * The players and the ball. Split out so that the frequently-mutating actors do
 * not force the static court and arena to reconcile.
 */
const LiveActors = ({ engine }: { engine: MatchEngine }) => {
  // These objects are handed to the models once and then mutated in place by
  // the simulation, so the models animate without React involvement.
  const proxy = useRef({
    state: engine.renderState,
  });

  useFrame(() => {
    proxy.current.state = engine.renderState;
  });

  const state = proxy.current.state;
  const isLocal = engine.settings.mode !== 'spectate';

  return (
    <>
      {([0, 1] as const).map((index) => (
        <PlayerModel
          key={index}
          player={state.players[index]}
          character={engine.sim.characters[index]}
          highlight={isLocal && index === engine.settings.localPlayer}
          highlightColor="#00e0ff"
        />
      ))}
      <BallView ball={state.ball} showTrail={!engine.replay.active} />
    </>
  );
};

export interface SceneProps {
  engine: MatchEngine;
}

export const Scene = ({ engine }: SceneProps) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={DEFAULT_CAMERA}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      className="absolute inset-0"
    >
      <SceneContents engine={engine} />
    </Canvas>
  );
};
