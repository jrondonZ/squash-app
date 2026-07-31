import { useEffect, useState } from 'react';

import type { HudState, MatchEngine } from '../game/MatchEngine';
import type { Character } from '../data/roster';
import { RULES } from '../engine/constants';

/**
 * The broadcast overlay.
 *
 * Laid out the way a squash world feed is: score bug top-left, referee calls
 * centre where your eye already is, conditioning and commentary along the
 * bottom. Everything here is driven by the HUD snapshot the match engine pushes
 * a few times a second — never by the 60 Hz simulation directly.
 */

const flag = (code: string): string =>
  code
    .split('-')[0]
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

const CALL_TONE: Record<string, string> = {
  Stroke: 'text-volt-400 border-volt-500/50',
  'Yes let': 'text-warn border-warn/40',
  Let: 'text-warn border-warn/40',
  'No let': 'text-arena-200 border-arena-500/50',
  Down: 'text-danger border-danger/50',
  Out: 'text-danger border-danger/50',
  'Not up': 'text-danger border-danger/50',
  Fault: 'text-danger border-danger/50',
  'Foot fault': 'text-danger border-danger/50',
};

// ---------------------------------------------------------------------------

const ScoreBug = ({
  hud,
  characters,
}: {
  hud: HudState;
  characters: [Character, Character];
}) => (
  <div className="panel panel-raised w-[19rem] overflow-hidden">
    <div className="flex items-center justify-between border-b border-arena-700/60 px-3 py-1.5">
      <span className="eyebrow">Game {hud.gameIndex + 1}</span>
      <span className="eyebrow tabular">
        {Math.floor(hud.elapsed / 60)}:{String(Math.floor(hud.elapsed % 60)).padStart(2, '0')}
      </span>
    </div>

    {([0, 1] as const).map((index) => {
      const serving = hud.server === index;
      return (
        <div
          key={index}
          className={`flex items-center gap-2.5 px-3 py-2 ${
            index === 0 ? 'border-b border-arena-700/40' : ''
          } ${serving ? 'bg-volt-500/8' : ''}`}
        >
          {/* Service indicator — the ball sits with whoever is serving. */}
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              serving ? 'bg-volt-500' : 'bg-transparent'
            }`}
            aria-label={serving ? 'Serving' : undefined}
          />
          <span className="text-base leading-none">{flag(characters[index].countryCode)}</span>
          <span className="display flex-1 truncate text-sm text-arena-100">
            {characters[index].shortName}
          </span>

          {/* Games won this match. */}
          <span className="flex gap-1">
            {Array.from({ length: RULES.gamesToWinMatch }).map((_, g) => (
              <span
                key={g}
                className={`h-1.5 w-3 rounded-sm ${
                  g < hud.games[index] ? 'bg-volt-500' : 'bg-arena-700'
                }`}
              />
            ))}
          </span>

          <span className="display tabular w-9 text-right text-2xl leading-none text-arena-100">
            {hud.scores[index]}
          </span>
        </div>
      );
    })}

    {/* Completed games, as a broadcast strip. */}
    {hud.completedGames.length > 0 && (
      <div className="flex gap-2 border-t border-arena-700/40 px-3 py-1.5">
        {hud.completedGames.map((game, i) => (
          <span key={i} className="tabular font-mono text-[0.68rem] text-arena-400">
            {game[0]}-{game[1]}
          </span>
        ))}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------

const RefereeCall = ({ hud }: { hud: HudState }) => {
  const [visible, setVisible] = useState<{ call: string; detail: string } | null>(null);

  useEffect(() => {
    if (!hud.lastCall) return;
    setVisible(hud.lastCall);
    // Calls are announcements, not permanent furniture.
    const timer = setTimeout(() => setVisible(null), 3600);
    return () => clearTimeout(timer);
  }, [hud.lastCall]);

  if (!visible) return null;

  const tone = CALL_TONE[visible.call] ?? 'text-arena-100 border-arena-500/50';

  return (
    <div className="animate-call pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2 text-center">
      <div className={`panel panel-raised border-2 px-7 py-3 ${tone}`}>
        <div className="eyebrow mb-0.5 text-arena-400">Referee</div>
        <div className="display text-3xl leading-none">{visible.call}</div>
      </div>
      <p className="mx-auto mt-2 max-w-md text-xs text-arena-300">{visible.detail}</p>
    </div>
  );
};

// ---------------------------------------------------------------------------

const Conditioning = ({
  hud,
  characters,
}: {
  hud: HudState;
  characters: [Character, Character];
}) => (
  <div className="panel w-56 px-3 py-2.5">
    <div className="eyebrow mb-2">Conditioning</div>
    {([0, 1] as const).map((index) => {
      const stamina = hud.stamina[index];
      // Colour shifts as the legs go — the same signal the commentators react to.
      const tone = stamina > 60 ? 'bg-good' : stamina > 32 ? 'bg-warn' : 'bg-danger';
      return (
        <div key={index} className="mb-2 last:mb-0">
          <div className="mb-1 flex justify-between text-[0.68rem] text-arena-300">
            <span>{characters[index].shortName}</span>
            <span className="tabular">{Math.round(stamina)}%</span>
          </div>
          <div className="meter h-1">
            <span className={tone} style={{ width: `${Math.max(2, stamina)}%` }} />
          </div>
        </div>
      );
    })}

    <div className="mt-3 border-t border-arena-700/50 pt-2">
      <div className="flex justify-between text-[0.68rem] text-arena-400">
        <span>Ball</span>
        <span className="tabular">{hud.ballTemperature.toFixed(0)}°C</span>
      </div>
      <div className="mt-1 flex justify-between text-[0.68rem] text-arena-400">
        <span>Rally</span>
        <span className="tabular">{hud.rallyShots} shots</span>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------

const Momentum = ({
  momentum,
  characters,
}: {
  momentum: number;
  characters: [Character, Character];
}) => {
  // Momentum runs -1 … +1; map it onto a bar that fills from the centre out.
  const magnitude = Math.abs(momentum) * 50;
  const leading = momentum >= 0 ? 0 : 1;

  return (
    <div className="panel w-56 px-3 py-2.5">
      <div className="eyebrow mb-2">Momentum</div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-arena-700/60">
        <span className="absolute left-1/2 top-0 h-full w-px bg-arena-500" />
        <span
          className="absolute top-0 h-full bg-volt-500 transition-[width,left] duration-500"
          style={{
            width: `${magnitude}%`,
            left: momentum >= 0 ? `${50 - magnitude}%` : '50%',
          }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[0.68rem] text-arena-400">
        <span>{characters[0].shortName}</span>
        <span className="text-arena-200">{characters[leading].shortName}</span>
        <span>{characters[1].shortName}</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const SPEAKER_LABEL: Record<string, string> = {
  pbp: 'Commentary',
  colour: 'Analyst',
  referee: 'Referee',
};

const CommentaryTicker = ({ hud }: { hud: HudState }) => {
  if (hud.commentary.length === 0) return null;
  const [latest, ...rest] = hud.commentary;

  return (
    <div className="panel max-w-2xl px-4 py-2.5">
      <div key={latest.id} className="animate-call flex gap-3">
        <span
          className={`eyebrow shrink-0 pt-0.5 ${
            latest.speaker === 'referee' ? 'text-volt-500' : ''
          }`}
        >
          {SPEAKER_LABEL[latest.speaker] ?? latest.speaker}
        </span>
        <p className="text-sm leading-snug text-arena-100">{latest.text}</p>
      </div>
      {rest.slice(0, 2).map((line) => (
        <div key={line.id} className="mt-1.5 flex gap-3 opacity-45">
          <span className="eyebrow shrink-0 pt-0.5">
            {SPEAKER_LABEL[line.speaker] ?? line.speaker}
          </span>
          <p className="truncate text-xs text-arena-300">{line.text}</p>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------

const ServePrompt = ({ hud, isLocalServer }: { hud: HudState; isLocalServer: boolean }) => {
  if (hud.phase !== 'preServe') return null;

  return (
    <div className="pointer-events-none absolute bottom-32 left-1/2 -translate-x-1/2 text-center">
      <div className="panel px-5 py-2">
        <p className="text-sm text-arena-200">
          {isLocalServer ? (
            <>
              <span className="kbd">Space</span> to serve from the{' '}
              <span className="text-volt-400">
                {hud.serveSide === 1 ? 'right' : 'left'}
              </span>{' '}
              box
            </>
          ) : (
            'Waiting for the serve…'
          )}
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

export interface HudProps {
  engine: MatchEngine;
  characters: [Character, Character];
  onPause: () => void;
  onReplay: () => void;
}

export const Hud = ({ engine, characters, onPause, onReplay }: HudProps) => {
  const [hud, setHud] = useState<HudState | null>(null);

  useEffect(() => engine.onHud(setHud), [engine]);

  if (!hud) return null;

  const isLocalServer =
    engine.settings.mode === 'local' || hud.server === engine.settings.localPlayer;

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <div className="vignette absolute inset-0" />

      {/* Top-left: the score bug. */}
      <div className="absolute left-5 top-5">
        <ScoreBug hud={hud} characters={characters} />
      </div>

      {/* Top-right: controls and match state. */}
      <div className="pointer-events-auto absolute right-5 top-5 flex flex-col items-end gap-2">
        <div className="flex gap-2">
          <button className="btn btn-ghost px-3 py-1.5 text-[0.7rem]" onClick={onReplay}>
            Replay
          </button>
          <button className="btn btn-ghost px-3 py-1.5 text-[0.7rem]" onClick={onPause}>
            Menu
          </button>
        </div>
        <Conditioning hud={hud} characters={characters} />
        <Momentum momentum={hud.momentum} characters={characters} />

        {/* Video reviews left — a real PSA mechanic worth surfacing. */}
        <div className="panel flex w-56 items-center justify-between px-3 py-2">
          <span className="eyebrow">Reviews</span>
          <span className="flex gap-2">
            {([0, 1] as const).map((i) => (
              <span key={i} className="flex items-center gap-1 text-[0.68rem] text-arena-300">
                {characters[i].shortName.slice(0, 3)}
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    hud.reviewsRemaining[i] > 0 ? 'bg-volt-500' : 'bg-arena-600'
                  }`}
                />
              </span>
            ))}
          </span>
        </div>
      </div>

      <RefereeCall hud={hud} />
      <ServePrompt hud={hud} isLocalServer={isLocalServer} />

      {/* Bottom: the commentary team. */}
      <div className="absolute bottom-5 left-5 right-5 flex items-end justify-between gap-4">
        <CommentaryTicker hud={hud} />
        <ControlsLegend mode={engine.settings.mode} />
      </div>
    </div>
  );
};

const ControlsLegend = ({ mode }: { mode: string }) => (
  <div className="panel hidden shrink-0 px-3 py-2 lg:block">
    <div className="eyebrow mb-1.5">Controls</div>
    <div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-[0.68rem] text-arena-300">
      <span className="flex gap-0.5">
        <span className="kbd">W</span>
        <span className="kbd">A</span>
        <span className="kbd">S</span>
        <span className="kbd">D</span>
      </span>
      <span>Move</span>
      <span>
        <span className="kbd">Space</span>
      </span>
      <span>Swing — hold for power</span>
      <span>
        <span className="kbd">Q</span>
      </span>
      <span>Touch: drop, or lob pulling back</span>
      <span>
        <span className="kbd">E</span>
      </span>
      <span>Attack: kill or volley</span>
      <span>
        <span className="kbd">R</span>
      </span>
      <span>Boast</span>
      <span>
        <span className="kbd">Shift</span>
      </span>
      <span>Lunge</span>
      <span>
        <span className="kbd">T</span>
      </span>
      <span>Appeal — "let please"</span>
      <span>
        <span className="kbd">Y</span>
      </span>
      <span>Video review</span>
      {mode === 'local' && (
        <>
          <span className="col-span-2 mt-1 border-t border-arena-700/50 pt-1 text-arena-500">
            Player two: arrows, <span className="kbd">/</span> swing,{' '}
            <span className="kbd">.</span> touch, <span className="kbd">,</span> attack
          </span>
        </>
      )}
    </div>
  </div>
);
