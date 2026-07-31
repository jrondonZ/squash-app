import { useState } from 'react';

import { DIFFICULTIES, type Difficulty } from '../engine/ai';
import { REFEREES } from '../engine/referee';
import { COURT } from '../engine/constants';
import type { MatchMode } from '../game/MatchEngine';

/**
 * The front end.
 *
 * Player-versus-player is the headline because that is how squash is played;
 * everything else is arranged around it.
 */

export interface MatchOptions {
  mode: MatchMode;
  difficulty: Difficulty;
  refereeId: string;
  tinHeight: number;
  warmBall: boolean;
  commentaryEnabled: boolean;
  speechEnabled: boolean;
  soundEnabled: boolean;
  volume: number;
}

export const DEFAULT_OPTIONS: MatchOptions = {
  mode: 'local',
  difficulty: 'national',
  refereeId: 'central',
  tinHeight: COURT.tinHeightTour,
  warmBall: true,
  commentaryEnabled: true,
  speechEnabled: true,
  soundEnabled: true,
  volume: 0.75,
};

const MODES: Array<{
  id: MatchMode;
  title: string;
  blurb: string;
  badge?: string;
}> = [
  {
    id: 'local',
    title: 'Local versus',
    blurb: 'Two players, one keyboard or two gamepads. The way the game is meant to be played.',
    badge: 'PVP',
  },
  {
    id: 'online',
    title: 'Online versus',
    blurb: 'Create or join a room code and play someone else on the tour.',
    badge: 'PVP',
  },
  {
    id: 'ai',
    title: 'Single player',
    blurb: 'Take on the tour. Five difficulty tiers, from club night to world class.',
  },
  {
    id: 'spectate',
    title: 'Exhibition',
    blurb: 'Sit back and watch two professionals go at it, with full commentary.',
  },
];

const Toggle = ({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <button
    onClick={() => onChange(!checked)}
    className="flex w-full items-center justify-between gap-4 py-2 text-left"
  >
    <span>
      <span className="block text-sm text-arena-100">{label}</span>
      {hint && <span className="block text-[0.68rem] text-arena-500">{hint}</span>}
    </span>
    <span
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-volt-500' : 'bg-arena-600'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-arena-950 transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </span>
  </button>
);

export interface MainMenuProps {
  options: MatchOptions;
  onChange: (options: MatchOptions) => void;
  onStart: (mode: MatchMode) => void;
}

export const MainMenu = ({ options, onChange, onStart }: MainMenuProps) => {
  const [tab, setTab] = useState<'play' | 'rules' | 'settings'>('play');

  const set = <K extends keyof MatchOptions>(key: K, value: MatchOptions[K]) =>
    onChange({ ...options, [key]: value });

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Backdrop: a suggestion of the court, well out of focus. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-volt-500/8 blur-[120px]" />
        <div className="vignette absolute inset-0" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-8 pt-7">
        <div className="flex items-baseline gap-3">
          <span className="display text-2xl tracking-[0.2em] text-volt-500">GLASS COURT</span>
          <span className="eyebrow">World Tour</span>
        </div>
        <nav className="flex gap-1.5">
          {(['play', 'rules', 'settings'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setTab(option)}
              className={`btn px-3.5 py-1.5 text-[0.7rem] ${
                tab === option ? 'btn-primary' : 'btn-ghost'
              }`}
            >
              {option}
            </button>
          ))}
        </nav>
      </header>

      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-8 py-6">
        {tab === 'play' && (
          <div className="mx-auto max-w-4xl">
            <h1 className="display mb-1 text-5xl leading-none">
              Squash, simulated
              <span className="text-volt-500">.</span>
            </h1>
            <p className="mb-7 max-w-xl text-sm leading-relaxed text-arena-300">
              A full physical simulation on a regulation glass court — real ball
              aerodynamics, the current WSF rules including lets, strokes and video review,
              and a referee who has to decide from what they saw.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {MODES.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => onStart(mode.id)}
                  className="panel group p-4 text-left transition-all hover:panel-raised hover:border-volt-500/60"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="display text-lg">{mode.title}</span>
                    {mode.badge && (
                      <span className="rounded bg-volt-500/15 px-1.5 py-0.5 text-[0.6rem] font-bold tracking-widest text-volt-400">
                        {mode.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs leading-relaxed text-arena-400">{mode.blurb}</p>
                </button>
              ))}
            </div>

            {options.mode === 'ai' && (
              <div className="panel mt-4 p-4">
                <div className="eyebrow mb-2">Opponent standard</div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(DIFFICULTIES) as Difficulty[]).map((level) => (
                    <button
                      key={level}
                      onClick={() => set('difficulty', level)}
                      className={`btn px-3 py-1.5 text-[0.7rem] ${
                        options.difficulty === level ? 'btn-primary' : 'btn-ghost'
                      }`}
                    >
                      {DIFFICULTIES[level].label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'rules' && <RulesTab />}

        {tab === 'settings' && (
          <div className="mx-auto max-w-2xl space-y-4">
            <div className="panel p-5">
              <div className="eyebrow mb-3">Broadcast</div>
              <Toggle
                label="Commentary"
                hint="Play-by-play and analysis, reacting to the match as it unfolds."
                checked={options.commentaryEnabled}
                onChange={(v) => set('commentaryEnabled', v)}
              />
              <Toggle
                label="Spoken voices"
                hint="Uses your browser's speech synthesis for the commentators and referee."
                checked={options.speechEnabled}
                onChange={(v) => set('speechEnabled', v)}
              />
              <Toggle
                label="Sound effects"
                hint="Ball, walls, tin and crowd, all synthesised at runtime."
                checked={options.soundEnabled}
                onChange={(v) => set('soundEnabled', v)}
              />
              <div className="mt-3">
                <label className="mb-1.5 block text-[0.68rem] text-arena-400">
                  Volume — {Math.round(options.volume * 100)}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={options.volume}
                  onChange={(e) => set('volume', Number(e.target.value))}
                  className="w-full accent-[var(--color-volt-500)]"
                />
              </div>
            </div>

            <div className="panel p-5">
              <div className="eyebrow mb-3">Match conditions</div>

              <label className="mb-1.5 block text-[0.68rem] text-arena-400">Referee</label>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {REFEREES.map((referee) => (
                  <button
                    key={referee.id}
                    onClick={() => set('refereeId', referee.id)}
                    className={`btn px-3 py-1.5 text-[0.7rem] ${
                      options.refereeId === referee.id ? 'btn-primary' : 'btn-ghost'
                    }`}
                    title={referee.reputation}
                  >
                    {referee.name}
                  </button>
                ))}
              </div>
              <p className="mb-4 text-[0.68rem] leading-relaxed text-arena-500">
                {REFEREES.find((r) => r.id === options.refereeId)?.reputation}
              </p>

              <label className="mb-1.5 block text-[0.68rem] text-arena-400">Tin height</label>
              <div className="mb-4 flex gap-1.5">
                <button
                  onClick={() => set('tinHeight', COURT.tinHeightTour)}
                  className={`btn px-3 py-1.5 text-[0.7rem] ${
                    options.tinHeight === COURT.tinHeightTour ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  430 mm — tour
                </button>
                <button
                  onClick={() => set('tinHeight', COURT.tinHeightStandard)}
                  className={`btn px-3 py-1.5 text-[0.7rem] ${
                    options.tinHeight === COURT.tinHeightStandard ? 'btn-primary' : 'btn-ghost'
                  }`}
                >
                  480 mm — standard
                </button>
              </div>

              <Toggle
                label="Skip the knock-up"
                hint="Start with a warm ball. Turn this off and the first game will be a slog, exactly as it is in real life."
                checked={options.warmBall}
                onChange={(v) => set('warmBall', v)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const RulesTab = () => (
  <div className="mx-auto max-w-3xl space-y-4">
    <div className="panel p-5">
      <h3 className="display mb-2 text-lg">Scoring</h3>
      <p className="text-sm leading-relaxed text-arena-300">
        Point-a-rally to <strong className="text-arena-100">11</strong>, best of five games.
        The winner of every rally scores, whoever served. At 10-all a player must win by
        two. There is <strong className="text-arena-100">no second serve</strong> — a fault
        loses the rally outright, though if the receiver attempts to return a fault the
        service is deemed good.
      </p>
    </div>

    <div className="panel p-5">
      <h3 className="display mb-2 text-lg">Interference — let, stroke, no let</h3>
      <p className="mb-3 text-sm leading-relaxed text-arena-300">
        The striker is entitled to four things: unobstructed access to the ball, a fair
        view of it, a reasonable swing, and the freedom to play it directly to the front
        wall. Which of those was denied decides the call.
      </p>
      <dl className="space-y-2 text-sm">
        <div className="flex gap-3">
          <dt className="w-20 shrink-0 font-semibold text-volt-400">Stroke</dt>
          <dd className="text-arena-300">
            The opponent did not make every effort to clear, or blocked the line to the
            front wall, or the striker was about to hit a winner.
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-20 shrink-0 font-semibold text-warn">Let</dt>
          <dd className="text-arena-300">
            Genuine interference, the striker could have made a good return, and the
            opponent did try to clear. The rally is replayed.
          </dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-20 shrink-0 font-semibold text-arena-200">No let</dt>
          <dd className="text-arena-300">
            Minimal interference, or the striker made no real effort, or the return would
            never have been good.
          </dd>
        </div>
      </dl>
    </div>

    <div className="panel p-5">
      <h3 className="display mb-2 text-lg">Video review</h3>
      <p className="text-sm leading-relaxed text-arena-300">
        One review per game. The referee rules on what they saw from their position, which
        is not always what happened — reviews consult the recorded simulation itself. Get
        it right and you keep the review; get it wrong and it is gone.
      </p>
    </div>

    <div className="panel p-5">
      <h3 className="display mb-2 text-lg">The ball</h3>
      <p className="text-sm leading-relaxed text-arena-300">
        A double yellow dot is nearly dead when cold and lively when hot, and the
        simulation models that directly: every impact warms the rubber and raises its
        coefficient of restitution. A cold ball dies in the back corner; a hot one sits up
        off the back wall and rallies stretch out. Watch the ball temperature on the HUD.
      </p>
    </div>
  </div>
);
