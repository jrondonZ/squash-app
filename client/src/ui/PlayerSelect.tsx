import { useMemo, useState } from 'react';

import { ROSTER, overallRating, type Character, type Tour } from '../data/roster';

/**
 * Player select.
 *
 * The attribute bars are not decoration — every value shown here is read
 * directly by the simulation, so a player with 97 touch really does hit better
 * drops and a player with 99 stamina really does last into the fifth game.
 */

const ATTRIBUTE_LABELS: Record<keyof Character['attributes'], string> = {
  power: 'Power',
  touch: 'Touch',
  speed: 'Speed',
  stamina: 'Stamina',
  deception: 'Deception',
  accuracy: 'Accuracy',
  volley: 'Volley',
  retrieval: 'Retrieval',
};

const flag = (code: string): string =>
  code
    .split('-')[0]
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));

const AttributeBar = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center gap-2">
    <span className="w-20 shrink-0 text-[0.68rem] text-arena-400">{label}</span>
    <div className="meter h-1 flex-1">
      <span
        className={value >= 92 ? 'bg-volt-500' : value >= 80 ? 'bg-arena-200' : 'bg-arena-500'}
        style={{ width: `${value}%` }}
      />
    </div>
    <span className="tabular w-6 text-right font-mono text-[0.68rem] text-arena-200">{value}</span>
  </div>
);

const CharacterCard = ({
  character,
  selected,
  accent,
  onSelect,
}: {
  character: Character;
  selected: boolean;
  accent: string;
  onSelect: () => void;
}) => (
  <button
    onClick={onSelect}
    className={`panel group relative w-full overflow-hidden p-3 text-left transition-all ${
      selected ? 'panel-raised scale-[1.02]' : 'opacity-75 hover:opacity-100'
    }`}
    style={selected ? { borderColor: accent } : undefined}
  >
    {/* Kit colours as a colour bar, so characters are identifiable at a glance. */}
    <span
      className="absolute inset-y-0 left-0 w-1"
      style={{ background: character.kit.primary }}
    />
    <div className="flex items-center gap-2.5 pl-1.5">
      <span className="text-lg leading-none">{flag(character.countryCode)}</span>
      <div className="min-w-0 flex-1">
        <div className="display truncate text-sm leading-tight">{character.shortName}</div>
        <div className="truncate text-[0.68rem] text-arena-400">{character.nickname}</div>
      </div>
      <div className="text-right">
        <div className="display tabular text-lg leading-none" style={{ color: accent }}>
          {overallRating(character)}
        </div>
        <div className="text-[0.6rem] text-arena-500">CH {character.careerHigh}</div>
      </div>
    </div>
  </button>
);

const CharacterDetail = ({ character, accent }: { character: Character; accent: string }) => (
  <div className="panel panel-raised flex h-full flex-col p-5">
    <div className="mb-1 flex items-center gap-3">
      <span className="text-3xl leading-none">{flag(character.countryCode)}</span>
      <div>
        <h3 className="display text-2xl leading-none">{character.name}</h3>
        <p className="mt-1 text-xs uppercase tracking-[0.18em]" style={{ color: accent }}>
          {character.nickname}
        </p>
      </div>
    </div>

    <p className="mt-3 text-sm leading-relaxed text-arena-300">{character.bio}</p>

    <div className="mt-4 flex flex-wrap gap-3 text-[0.68rem] text-arena-400">
      <span>
        Career high <span className="text-arena-100">#{character.careerHigh}</span>
      </span>
      <span>
        Signature <span className="text-arena-100">{character.signatureShot}</span>
      </span>
      <span>
        {character.handed === 'left' ? 'Left' : 'Right'}-handed
      </span>
    </div>

    <div className="mt-5 space-y-1.5">
      {(Object.keys(ATTRIBUTE_LABELS) as Array<keyof Character['attributes']>).map((key) => (
        <AttributeBar
          key={key}
          label={ATTRIBUTE_LABELS[key]}
          value={character.attributes[key]}
        />
      ))}
    </div>
  </div>
);

export interface PlayerSelectProps {
  initial: [string, string];
  /** Label for the second slot — an opponent, or player two. */
  secondLabel: string;
  onConfirm: (characters: [string, string]) => void;
  onBack: () => void;
}

export const PlayerSelect = ({
  initial,
  secondLabel,
  onConfirm,
  onBack,
}: PlayerSelectProps) => {
  const [tour, setTour] = useState<Tour | 'all'>('all');
  const [picks, setPicks] = useState<[string, string]>(initial);
  const [active, setActive] = useState<0 | 1>(0);

  const roster = useMemo(
    () => (tour === 'all' ? ROSTER : ROSTER.filter((c) => c.tour === tour)),
    [tour],
  );

  const characters = useMemo(
    () => picks.map((id) => ROSTER.find((c) => c.id === id) ?? ROSTER[0]) as [Character, Character],
    [picks],
  );

  const select = (id: string) => {
    setPicks((current) => {
      const next: [string, string] = [...current];
      next[active] = id;
      return next;
    });
    // Move on to the second slot automatically the first time round.
    if (active === 0) setActive(1);
  };

  const accents = ['#00d4ff', '#ff8a3d'];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-arena-950 p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="eyebrow">Select players</div>
          <h2 className="display text-3xl">The Draw</h2>
        </div>

        <div className="flex gap-1.5">
          {(['all', 'mens', 'womens'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setTour(option)}
              className={`btn px-3 py-1.5 text-[0.7rem] ${
                tour === option ? 'btn-primary' : 'btn-ghost'
              }`}
            >
              {option === 'all' ? 'All' : option === 'mens' ? "Men's" : "Women's"}
            </button>
          ))}
        </div>
      </div>

      {/* Which slot is being filled. */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        {([0, 1] as const).map((slot) => (
          <button
            key={slot}
            onClick={() => setActive(slot)}
            className={`panel flex items-center gap-3 px-4 py-2.5 text-left transition-all ${
              active === slot ? 'panel-raised' : 'opacity-60'
            }`}
            style={active === slot ? { borderColor: accents[slot] } : undefined}
          >
            <span className="eyebrow" style={{ color: accents[slot] }}>
              {slot === 0 ? 'You' : secondLabel}
            </span>
            <span className="display flex-1 truncate text-sm">{characters[slot].shortName}</span>
            <span className="tabular text-sm text-arena-400">
              {overallRating(characters[slot])}
            </span>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
            {roster.map((character) => (
              <CharacterCard
                key={character.id}
                character={character}
                selected={picks[active] === character.id}
                accent={accents[active]}
                onSelect={() => select(character.id)}
              />
            ))}
          </div>
        </div>

        <div className="hidden min-h-0 overflow-y-auto lg:block">
          <CharacterDetail character={characters[active]} accent={accents[active]} />
        </div>
      </div>

      <div className="mt-5 flex justify-between">
        <button className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button className="btn btn-primary" onClick={() => onConfirm(picks)}>
          To the court
        </button>
      </div>
    </div>
  );
};
