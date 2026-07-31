import type { MatchEngine } from '../game/MatchEngine';
import type { Character } from '../data/roster';
import type { TimelinePoint } from '../engine/replay';

/**
 * The post-match report.
 *
 * The momentum graph is the match's fourth dimension at full scale: every rally
 * plotted against time, so you can see the passage where it turned rather than
 * just the final score.
 */

const MomentumGraph = ({
  points,
  characters,
}: {
  points: TimelinePoint[];
  characters: [Character, Character];
}) => {
  if (points.length < 2) return null;

  const width = 720;
  const height = 130;
  const last = points[points.length - 1].time || 1;

  const path = points
    .map((point, i) => {
      const x = (point.time / last) * width;
      // Momentum runs +1 (player one) to -1 (player two); y is inverted.
      const y = height / 2 - point.momentum * (height / 2 - 6);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Where each game ended, so the graph reads against the scoreline.
  const gameBreaks = points.filter(
    (point, i) => i > 0 && point.gameIndex !== points[i - 1].gameIndex,
  );

  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Momentum</span>
        <span className="flex gap-3 text-[0.68rem]">
          <span className="text-volt-400">{characters[0].shortName}</span>
          <span className="text-arena-400">{characters[1].shortName}</span>
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Momentum over the match">
        <defs>
          <linearGradient id="momentum-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-volt-500)" stopOpacity="0.28" />
            <stop offset="50%" stopColor="var(--color-volt-500)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--color-arena-600)"
          strokeDasharray="3 4"
        />

        {gameBreaks.map((point, i) => (
          <line
            key={i}
            x1={(point.time / last) * width}
            y1="0"
            x2={(point.time / last) * width}
            y2={height}
            stroke="var(--color-arena-600)"
            strokeWidth="1"
          />
        ))}

        <path d={`${path} L${width},${height / 2} L0,${height / 2} Z`} fill="url(#momentum-fill)" />
        <path d={path} fill="none" stroke="var(--color-volt-500)" strokeWidth="2" />
      </svg>
    </div>
  );
};

const Stat = ({ label, a, b }: { label: string; a: string; b: string }) => (
  <div className="flex items-center gap-3 py-1.5">
    <span className="tabular w-20 text-right text-sm text-arena-100">{a}</span>
    <span className="flex-1 text-center text-[0.68rem] uppercase tracking-widest text-arena-500">
      {label}
    </span>
    <span className="tabular w-20 text-sm text-arena-100">{b}</span>
  </div>
);

export interface MatchSummaryProps {
  engine: MatchEngine;
  characters: [Character, Character];
  onRematch: () => void;
  onExit: () => void;
}

export const MatchSummary = ({ engine, characters, onRematch, onExit }: MatchSummaryProps) => {
  const state = engine.sim.state;
  const winner = state.match.winner;
  const points = engine.timeline.points;
  const longest = engine.timeline.longestRally();
  const referee = engine.sim.referee;

  const minutes = Math.floor(state.match.elapsed / 60);
  const seconds = Math.floor(state.match.elapsed % 60);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-arena-950/92 p-6 backdrop-blur-md">
      <div className="w-full max-w-3xl">
        <div className="mb-5 text-center">
          <div className="eyebrow mb-1">Match complete</div>
          <h2 className="display text-4xl leading-none">
            {winner !== null ? characters[winner].name : 'Match abandoned'}
          </h2>
          {winner !== null && (
            <p className="mt-2 text-sm text-arena-300">
              wins {state.match.games[0]}-{state.match.games[1]} —{' '}
              {state.match.completedGames.map(([a, b]) => `${a}-${b}`).join(', ')}
            </p>
          )}
        </div>

        <div className="mb-4">
          <MomentumGraph points={points} characters={characters} />
        </div>

        <div className="panel mb-4 px-5 py-3">
          <div className="mb-2 flex justify-between">
            <span className="display text-sm text-volt-400">{characters[0].shortName}</span>
            <span className="eyebrow">
              {minutes}:{String(seconds).padStart(2, '0')} · {state.match.totalRallies} rallies
            </span>
            <span className="display text-sm text-arena-300">{characters[1].shortName}</span>
          </div>

          <Stat
            label="Distance"
            a={`${state.players[0].distanceCovered.toFixed(0)} m`}
            b={`${state.players[1].distanceCovered.toFixed(0)} m`}
          />
          <Stat
            label="Stamina left"
            a={`${state.players[0].stamina.toFixed(0)}%`}
            b={`${state.players[1].stamina.toFixed(0)}%`}
          />
          <Stat
            label="Games"
            a={String(state.match.games[0])}
            b={String(state.match.games[1])}
          />

          <div className="mt-3 grid grid-cols-2 gap-4 border-t border-arena-700/50 pt-3 text-[0.72rem] text-arena-400 sm:grid-cols-4">
            <span>
              Longest rally{' '}
              <span className="tabular block text-sm text-arena-100">
                {longest?.shots ?? 0} shots
              </span>
            </span>
            <span>
              Average rally{' '}
              <span className="tabular block text-sm text-arena-100">
                {engine.timeline.averageRallyLength().toFixed(1)} shots
              </span>
            </span>
            <span>
              Ball peak{' '}
              <span className="tabular block text-sm text-arena-100">
                {state.ball.temperature.toFixed(0)}°C
              </span>
            </span>
            <span>
              Referee{' '}
              <span className="block text-sm text-arena-100">
                {referee.decisions.lets}L / {referee.decisions.strokes}S /{' '}
                {referee.decisions.noLets}N
              </span>
            </span>
          </div>
        </div>

        <div className="flex justify-center gap-3">
          <button className="btn btn-ghost" onClick={onExit}>
            Back to menu
          </button>
          <button className="btn btn-primary" onClick={onRematch}>
            Rematch
          </button>
        </div>
      </div>
    </div>
  );
};
