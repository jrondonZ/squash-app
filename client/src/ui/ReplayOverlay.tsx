import { useEffect, useRef, useState } from 'react';

import type { MatchEngine } from '../game/MatchEngine';
import { peakSpeed, type ReplayMarker } from '../engine/replay';

/**
 * The replay deck — the fourth dimension made controllable.
 *
 * The same recorder feeds three things that look different but are the same
 * mechanism: the automatic replay after a big rally, the referee's official
 * video review, and this scrubber, which lets you drag the match backwards and
 * forwards through time and orbit the camera while it is stopped.
 */

const SPEEDS = [
  { label: '⅛', value: 0.125 },
  { label: '¼', value: 0.25 },
  { label: '½', value: 0.5 },
  { label: '1×', value: 1 },
];

const MARKER_STYLE: Record<ReplayMarker['kind'], string> = {
  hit: 'bg-volt-500',
  bounce: 'bg-warn',
  wall: 'bg-arena-300',
  decision: 'bg-danger',
  end: 'bg-danger',
};

export const ReplayOverlay = ({ engine }: { engine: MatchEngine }) => {
  // The replay state lives on the engine and mutates outside React, so poll it
  // at a rate the eye cares about rather than subscribing per frame.
  const [, tick] = useState(0);
  const scrubbing = useRef(false);

  useEffect(() => {
    const handle = setInterval(() => tick((n) => n + 1), 60);
    return () => clearInterval(handle);
  }, []);

  const replay = engine.replay;
  if (!replay.active || !replay.clip) return null;

  const { clip } = replay;
  const isReview = replay.isReview;

  const onScrub = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    engine.scrubTo((event.clientX - rect.left) / rect.width);
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Broadcast letterbox, so a replay never reads as live play. */}
      <div className="absolute inset-x-0 top-0 h-14 bg-arena-950/85" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-arena-950/85" />

      {/* Label. */}
      <div className="absolute left-1/2 top-4 -translate-x-1/2 text-center">
        <div className="flex items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${isReview ? 'animate-ring bg-danger' : 'bg-volt-500'}`}
          />
          <span
            className={`display text-lg tracking-[0.2em] ${
              isReview ? 'text-danger' : 'text-volt-400'
            }`}
          >
            {replay.label}
          </span>
        </div>
        {isReview && (
          <p className="mt-0.5 text-xs text-arena-300">
            Referee is reviewing the decision
          </p>
        )}
      </div>

      {/* The verdict, once it lands. */}
      {replay.reviewVerdict && (
        <div className="animate-call absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="panel panel-raised border-2 border-danger/60 px-8 py-4 text-center">
            <div className="display text-2xl text-danger">{replay.reviewVerdict}</div>
          </div>
        </div>
      )}

      {/* Deck. */}
      <div className="pointer-events-auto absolute bottom-6 left-1/2 w-[min(46rem,92vw)] -translate-x-1/2">
        <div className="panel panel-raised px-4 py-3">
          {/* Scrub bar with event markers. */}
          <div
            className="group relative mb-3 h-8 cursor-pointer"
            onPointerDown={(e) => {
              scrubbing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              onScrub(e);
            }}
            onPointerMove={(e) => scrubbing.current && onScrub(e)}
            onPointerUp={(e) => {
              scrubbing.current = false;
              e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-arena-700" />
            <div
              className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-volt-500"
              style={{ width: `${replay.progress * 100}%` }}
            />

            {/* Every hit, bounce and decision in the clip. */}
            {clip.markers.map((marker, i) => (
              <span
                key={i}
                title={marker.label}
                className={`absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded-full ${
                  MARKER_STYLE[marker.kind]
                }`}
                style={{ left: `${marker.t * 100}%` }}
              />
            ))}

            {/* Playhead. */}
            <span
              className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-arena-100 shadow-lg"
              style={{ left: `${replay.progress * 100}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <button
                className="btn btn-ghost px-3 py-1.5 text-[0.7rem]"
                onClick={() => engine.toggleReplayPause()}
              >
                {replay.paused ? 'Play' : 'Pause'}
              </button>
              {SPEEDS.map((speed) => (
                <button
                  key={speed.value}
                  onClick={() => engine.setReplaySpeed(speed.value)}
                  className={`btn px-2.5 py-1.5 text-[0.7rem] ${
                    Math.abs(replay.speed - speed.value) < 0.01 ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  {speed.label}
                </button>
              ))}
            </div>

            {/* Broadcast statistics pulled straight from the clip. */}
            <div className="flex gap-4 text-[0.7rem] text-arena-400">
              <span>
                Peak <span className="tabular text-arena-100">{peakSpeed(clip).toFixed(0)}</span>{' '}
                km/h
              </span>
              <span>
                <span className="tabular text-arena-100">{clip.duration.toFixed(1)}</span>s
              </span>
            </div>

            {!isReview && (
              <button className="btn btn-primary px-4 py-1.5 text-[0.7rem]" onClick={() => engine.exitReplay()}>
                Resume
              </button>
            )}
          </div>

          <p className="mt-2 text-[0.68rem] text-arena-500">
            Drag the timeline to scrub. The ball's flight path is drawn from the recorded
            simulation, not an approximation.
          </p>
        </div>
      </div>
    </div>
  );
};
