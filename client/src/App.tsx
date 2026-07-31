import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Scene } from './three/Scene';
import { Hud } from './ui/Hud';
import { Lobby } from './ui/Lobby';
import { MainMenu, DEFAULT_OPTIONS, type MatchOptions } from './ui/MainMenu';
import { MatchSummary } from './ui/MatchSummary';
import { PlayerSelect } from './ui/PlayerSelect';
import { ReplayOverlay } from './ui/ReplayOverlay';
import { MatchEngine, type MatchMode } from './game/MatchEngine';
import { characterById, type Character } from './data/roster';
import { soundEngine } from './audio/sfx';
import { speechEngine } from './audio/speech';
import { recordMatch, type RoomInfo } from './net/api';
import { connectToRoom } from './net/cable';

type Screen = 'menu' | 'select' | 'lobby' | 'match' | 'summary';

/**
 * Application shell.
 *
 * Owns which screen is showing and the lifetime of the match engine. The engine
 * is created once per match and torn down when it ends — everything stateful
 * about a match lives inside it rather than in React, so the 60 Hz simulation
 * never touches the component tree.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [options, setOptions] = useState<MatchOptions>(DEFAULT_OPTIONS);
  const [characters, setCharacters] = useState<[string, string]>(['farag', 'elias']);
  const [engine, setEngine] = useState<MatchEngine | null>(null);
  const [paused, setPaused] = useState(false);
  const [peerLeft, setPeerLeft] = useState(false);
  const roomRef = useRef<RoomInfo | null>(null);
  const roleRef = useRef<'host' | 'guest'>('host');
  const recorded = useRef(false);

  const cast = useMemo(
    () => [characterById(characters[0]), characterById(characters[1])] as [Character, Character],
    [characters],
  );

  // ---- Match lifecycle ----------------------------------------------------

  const startMatch = useCallback(
    (mode: MatchMode, picks: [string, string], seed?: string) => {
      const room = roomRef.current;
      // Online: the host is always player one and owns the simulation, and both
      // peers must build their engine from the room's shared seed.
      const isOnline = mode === 'online' && room !== null;
      const localPlayer: 0 | 1 = isOnline && roleRef.current === 'guest' ? 1 : 0;

      const next = new MatchEngine({
        seed: seed ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        characters: picks,
        refereeId: options.refereeId,
        tinHeight: options.tinHeight,
        warmBall: options.warmBall,
        mode,
        difficulty: options.difficulty,
        localPlayer,
        commentaryEnabled: options.commentaryEnabled,
        speechEnabled: options.speechEnabled,
        soundEnabled: options.soundEnabled,
        volume: options.volume,
      });

      if (isOnline) {
        const session = connectToRoom(room.code, roleRef.current, {
          onRemoteInput: (input) => next.applyRemoteInput(input),
          onSnapshot: (snapshot) => next.applyRemoteSnapshot(snapshot),
          onLatency: (ms) => {
            next.latency = ms;
          },
          onPeerLeft: () => setPeerLeft(true),
        });
        next.attachTransport(session.transport);
      }

      recorded.current = false;
      next.start();
      setEngine(next);
      setPaused(false);
      setPeerLeft(false);
      setScreen('match');
    },
    [options],
  );

  // Tear the engine down whenever it is replaced or the app unmounts.
  useEffect(() => () => engine?.stop(), [engine]);

  // Watch for the match finishing so we can show the report.
  useEffect(() => {
    if (!engine || screen !== 'match') return;
    return engine.onHud((hud) => {
      if (hud.matchWinner === null || recorded.current) return;
      recorded.current = true;

      // Persist the result for the ladder. A failure here must never take the
      // summary screen down with it — the match still happened.
      const state = engine.sim.state;
      void recordMatch({
        playerOne: cast[0].name,
        playerTwo: cast[1].name,
        characterOne: characters[0],
        characterTwo: characters[1],
        games: [...state.match.games] as [number, number],
        gameScores: state.match.completedGames,
        winner: hud.matchWinner,
        durationSeconds: Math.round(state.match.elapsed),
        totalRallies: state.match.totalRallies,
        longestRally: engine.timeline.longestRally()?.shots ?? 0,
      }).catch(() => undefined);

      // Let the crowd and the commentary finish before cutting away.
      setTimeout(() => setScreen('summary'), 4200);
    });
  }, [engine, screen, cast, characters]);

  // ---- Audio --------------------------------------------------------------

  useEffect(() => {
    // Browsers will not start audio until the user has interacted with the page.
    const unlock = () => void soundEngine.resume();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    soundEngine.setEnabled(options.soundEnabled);
    soundEngine.setVolume(options.volume);
    speechEngine.setEnabled(options.speechEnabled);
  }, [options.soundEnabled, options.volume, options.speechEnabled]);

  // Escape opens the pause menu during a match.
  useEffect(() => {
    if (screen !== 'match') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPaused((p) => !p);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  // ---- Screens ------------------------------------------------------------

  const leaveMatch = () => {
    engine?.stop();
    speechEngine.cancel();
    setEngine(null);
    setScreen('menu');
  };

  if (screen === 'menu') {
    return (
      <MainMenu
        options={options}
        onChange={setOptions}
        onStart={(mode) => {
          setOptions((o) => ({ ...o, mode }));
          setScreen(mode === 'online' ? 'lobby' : 'select');
        }}
      />
    );
  }

  if (screen === 'lobby') {
    return (
      <Lobby
        characterId={characters[0]}
        onReady={(info, role) => {
          roomRef.current = info;
          roleRef.current = role;
          setScreen('select');
        }}
        onBack={() => setScreen('menu')}
      />
    );
  }

  if (screen === 'select') {
    return (
      <PlayerSelect
        initial={characters}
        secondLabel={options.mode === 'local' ? 'Player two' : 'Opponent'}
        onConfirm={(picks) => {
          setCharacters(picks);
          startMatch(options.mode, picks, roomRef.current?.seed);
        }}
        onBack={() => setScreen('menu')}
      />
    );
  }

  if (!engine) return null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-arena-950">
      <Scene engine={engine} />
      <Hud
        engine={engine}
        characters={cast}
        onPause={() => setPaused(true)}
        onReplay={() => engine.queueReplay('Instant replay')}
      />
      <ReplayOverlay engine={engine} />

      {paused && screen === 'match' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-arena-950/88 backdrop-blur-md">
          <div className="panel panel-raised w-72 p-5 text-center">
            <div className="eyebrow mb-1">Paused</div>
            <h3 className="display mb-5 text-xl">
              {cast[0].shortName} v {cast[1].shortName}
            </h3>
            <button className="btn btn-primary mb-2 w-full" onClick={() => setPaused(false)}>
              Resume
            </button>
            <button
              className="btn btn-ghost mb-2 w-full"
              onClick={() => {
                setPaused(false);
                engine.queueReplay('Last rally');
              }}
            >
              Watch last rally
            </button>
            <button className="btn btn-ghost w-full" onClick={leaveMatch}>
              Leave match
            </button>
          </div>
        </div>
      )}

      {peerLeft && (
        <div className="panel panel-raised absolute left-1/2 top-24 -translate-x-1/2 px-5 py-3 text-center">
          <div className="eyebrow mb-0.5 text-danger">Connection</div>
          <p className="text-sm text-arena-200">Your opponent has left the court.</p>
        </div>
      )}

      {screen === 'summary' && (
        <MatchSummary
          engine={engine}
          characters={cast}
          onRematch={() => startMatch(options.mode, characters)}
          onExit={leaveMatch}
        />
      )}
    </div>
  );
}
