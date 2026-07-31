import type { Character } from '../data/roster';
import type { RallyOutcome, ShotType, SimEvent, WorldState } from '../engine/types';

/**
 * The commentary phrase bank.
 *
 * Written to sound like squash commentary rather than sports commentary in
 * general: specific about shots, sparing with superlatives, and happy to sit in
 * silence during a long rally the way the real thing does. The play-by-play
 * voice calls what happened; the colour voice explains why it happened, and
 * only speaks when there is something to say.
 */

export type Speaker = 'pbp' | 'colour' | 'referee';

export interface CommentaryContext {
  event: SimEvent;
  state: WorldState;
  characters: [Character, Character];
  names: [string, string];
  /** -1 … +1, positive means player 0 is on top. */
  momentum: number;
  /** Consecutive rallies won by one player. */
  streak: { player: 0 | 1; count: number } | null;
  /** Shots in the rally that just ended. */
  rallyShots: number;
  rallyDuration: number;
  /** Peak ball speed of the last shot, km/h. */
  lastSpeedKmh: number;
  averageRally: number;
  refereeName: string;
}

export interface LineTemplate {
  id: string;
  speaker: Speaker;
  /** Higher wins when two lines compete for the microphone. */
  priority: number;
  /** Seconds before this exact line may be used again. */
  cooldown: number;
  when: (ctx: CommentaryContext) => boolean;
  /** Several phrasings; one is picked deterministically per utterance. */
  say: (ctx: CommentaryContext) => string[];
}

const name = (ctx: CommentaryContext, index: 0 | 1) => ctx.names[index];
const nick = (ctx: CommentaryContext, index: 0 | 1) => ctx.characters[index].nickname;

const SHOT_NAMES: Record<ShotType, string> = {
  drive: 'straight drive',
  crossCourt: 'cross-court',
  drop: 'drop',
  lob: 'lob',
  boast: 'boast',
  volley: 'volley',
  kill: 'kill',
  nick: 'nick',
  serve: 'serve',
  flick: 'flick',
};

const OUTCOME_PHRASE: Partial<Record<RallyOutcome, string>> = {
  down: 'into the tin',
  out: 'out of court',
  notUp: 'not up',
  doubleBounce: 'a winner',
  fault: 'a fault',
  footFault: 'a foot fault',
};

// ---------------------------------------------------------------------------
// The bank
// ---------------------------------------------------------------------------

export const LINES: LineTemplate[] = [
  // ---- Referee -----------------------------------------------------------
  {
    id: 'ref-call',
    speaker: 'referee',
    priority: 100,
    cooldown: 0,
    when: (c) => c.event.type === 'refereeCall',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'refereeCall' }>;
      return [e.call];
    },
  },
  {
    id: 'ref-score',
    speaker: 'referee',
    priority: 96,
    cooldown: 0,
    when: (c) => c.event.type === 'point',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'point' }>;
      const server = c.state.rally.server;
      const receiver = server === 0 ? 1 : 0;
      const s = e.scores[server];
      const r = e.scores[receiver];
      if (s === r) return [`${s}-all`];
      return [`${s}-${r}`];
    },
  },

  // ---- Rally endings -----------------------------------------------------
  {
    id: 'winner-nick',
    speaker: 'pbp',
    priority: 82,
    cooldown: 8,
    when: (c) =>
      c.event.type === 'rallyEnd' &&
      c.event.outcome === 'doubleBounce' &&
      c.event.shot === 'nick',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      const w = name(c, e.winner);
      return [
        'Straight into the nick! Nothing you can do about that.',
        `Oh, that is glorious from ${w}. Rolls out of the nick.`,
        'Dead. Absolutely dead in the corner.',
      ];
    },
  },
  {
    id: 'winner-drop',
    speaker: 'pbp',
    priority: 76,
    cooldown: 10,
    when: (c) =>
      c.event.type === 'rallyEnd' &&
      c.event.outcome === 'doubleBounce' &&
      (c.event.shot === 'drop' || c.event.shot === 'boast'),
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      const w = name(c, e.winner);
      return [
        `${w} takes it in short, and that is too good.`,
        'Held it, held it — and dropped it. Beautiful.',
        `The hands of ${w}. Second bounce before you could blink.`,
      ];
    },
  },
  {
    id: 'winner-kill',
    speaker: 'pbp',
    priority: 76,
    cooldown: 10,
    when: (c) =>
      c.event.type === 'rallyEnd' &&
      c.event.outcome === 'doubleBounce' &&
      (c.event.shot === 'kill' || c.event.shot === 'volley'),
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      return [
        `Volleyed away by ${name(c, e.winner)}. No answer to that.`,
        'Cut it off early and buried it. That is ruthless.',
        'Taken out of the air and finished. Rally over.',
      ];
    },
  },
  {
    id: 'winner-generic',
    speaker: 'pbp',
    priority: 68,
    cooldown: 5,
    when: (c) => c.event.type === 'rallyEnd' && c.event.outcome === 'doubleBounce',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      const w = name(c, e.winner);
      const shot = e.shot ? SHOT_NAMES[e.shot] : 'winner';
      return [
        `${w} finds the ${shot}, and that is the rally.`,
        `Too good. ${w} takes it.`,
        `And ${w} gets the reward for that one.`,
      ];
    },
  },
  {
    id: 'error-tin',
    speaker: 'pbp',
    priority: 74,
    cooldown: 4,
    when: (c) => c.event.type === 'rallyEnd' && c.event.outcome === 'down',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      const loser = e.winner === 0 ? 1 : 0;
      return [
        `Into the tin. ${name(c, loser)} will not want to see that again.`,
        'Down. And that is a costly error at this stage.',
        `Tin. ${name(c, loser)} went for it and came up short.`,
      ];
    },
  },
  {
    id: 'error-out',
    speaker: 'pbp',
    priority: 74,
    cooldown: 6,
    when: (c) => c.event.type === 'rallyEnd' && c.event.outcome === 'out',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      const loser = e.winner === 0 ? 1 : 0;
      return [
        'That is out. Caught it far too cleanly.',
        `Out of court from ${name(c, loser)}. A rare mistake.`,
        'Over the line at the back. Gifted away.',
      ];
    },
  },
  {
    id: 'long-rally',
    speaker: 'colour',
    priority: 70,
    cooldown: 20,
    when: (c) => c.event.type === 'rallyEnd' && c.event.shotCount >= 25,
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      return [
        `${e.shotCount} shots. That rally will be felt in the fifth.`,
        `${Math.round(e.duration)} seconds of that. Neither of them would give an inch.`,
        `${e.shotCount} shots, and look at them both. That is the whole match in one rally.`,
      ];
    },
  },

  // ---- Referee decisions, from the commentary box -------------------------
  {
    id: 'stroke-comment',
    speaker: 'colour',
    priority: 72,
    cooldown: 12,
    when: (c) => c.event.type === 'rallyEnd' && c.event.outcome === 'stroke',
    say: (c) => [
      'That has to be a stroke. He was never getting out of the way in time.',
      'Correct call. The line to the front wall was completely blocked.',
      `A stroke, and ${c.refereeName} had no hesitation.`,
    ],
  },
  {
    id: 'nolet-comment',
    speaker: 'colour',
    priority: 70,
    cooldown: 12,
    when: (c) => c.event.type === 'rallyEnd' && c.event.outcome === 'noLet',
    say: () => [
      'No let, and that is harsh. There was contact there.',
      'The referee has decided there was no real interference. Not everyone will agree.',
      'No let. The argument is that the return was never coming back anyway.',
    ],
  },
  {
    id: 'let-comment',
    speaker: 'colour',
    priority: 55,
    cooldown: 25,
    when: (c) => c.event.type === 'rallyEnd' && c.event.outcome === 'let',
    say: () => [
      'Fair enough. Both of them wanted the same square metre.',
      'A let. They will play that one again.',
      'The traffic is building on this court.',
    ],
  },
  {
    id: 'review-start',
    speaker: 'pbp',
    priority: 90,
    cooldown: 0,
    when: (c) => c.event.type === 'reviewStart',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'reviewStart' }>;
      return [
        `${name(c, e.player)} asks for the video review. Let's have a look.`,
        `Review requested by ${name(c, e.player)}. This could be significant.`,
      ];
    },
  },
  {
    id: 'review-end',
    speaker: 'pbp',
    priority: 90,
    cooldown: 0,
    when: (c) => c.event.type === 'reviewEnd',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'reviewEnd' }>;
      return e.overturned
        ? [
            'Overturned! The review has changed the decision.',
            `The video agrees with ${name(c, e.player)}. Decision reversed.`,
          ]
        : [
            'The original decision stands. Review lost.',
            'No change. The referee got it right first time.',
          ];
    },
  },

  // ---- Score situations ---------------------------------------------------
  {
    id: 'game-ball',
    speaker: 'pbp',
    priority: 88,
    cooldown: 6,
    when: (c) => c.event.type === 'gameBallPoint' && c.event.kind === 'game',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'gameBallPoint' }>;
      return [`Game ball, ${name(c, e.player)}.`, `${name(c, e.player)} is one away from the game.`];
    },
  },
  {
    id: 'match-ball',
    speaker: 'pbp',
    priority: 94,
    cooldown: 6,
    when: (c) => c.event.type === 'gameBallPoint' && c.event.kind === 'match',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'gameBallPoint' }>;
      return [
        `Match ball, ${name(c, e.player)}. One rally from it.`,
        `This is for the match. ${name(c, e.player)} to serve.`,
      ];
    },
  },
  {
    id: 'game-end',
    speaker: 'pbp',
    priority: 95,
    cooldown: 0,
    when: (c) => c.event.type === 'gameEnd',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'gameEnd' }>;
      const w = name(c, e.winner);
      return [
        `${w} takes it, ${e.scores[0]}-${e.scores[1]}. Games ${e.games[0]}-${e.games[1]}.`,
        `That is the game to ${w}, ${e.scores[0]}-${e.scores[1]}.`,
      ];
    },
  },
  {
    id: 'match-end',
    speaker: 'pbp',
    priority: 99,
    cooldown: 0,
    when: (c) => c.event.type === 'matchEnd',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'matchEnd' }>;
      const w = name(c, e.winner);
      return [
        `And that is the match! ${w} wins it, ${e.games[0]}-${e.games[1]}.`,
        `${w} has done it. ${nick(c, e.winner)} takes the match ${e.games[0]}-${e.games[1]}.`,
      ];
    },
  },
  {
    id: 'tiebreak',
    speaker: 'colour',
    priority: 86,
    cooldown: 30,
    when: (c) =>
      c.event.type === 'point' &&
      c.state.players[0].score >= 10 &&
      c.state.players[1].score >= 10 &&
      c.state.players[0].score === c.state.players[1].score,
    say: (c) => [
      `${c.state.players[0].score}-all. Now it is about who holds their nerve.`,
      'Two clear points needed. This is where matches are decided.',
    ],
  },

  // ---- Momentum and conditioning -----------------------------------------
  {
    id: 'streak',
    speaker: 'colour',
    priority: 60,
    cooldown: 35,
    when: (c) => c.event.type === 'point' && (c.streak?.count ?? 0) >= 4,
    say: (c) => {
      const s = c.streak!;
      return [
        `That is ${s.count} in a row for ${name(c, s.player)}. The momentum has completely shifted.`,
        `${name(c, s.player)} has won ${s.count} straight. This has turned.`,
      ];
    },
  },
  {
    id: 'fatigue',
    speaker: 'colour',
    priority: 58,
    cooldown: 45,
    when: (c) =>
      c.event.type === 'point' &&
      Math.min(c.state.players[0].stamina, c.state.players[1].stamina) < 34,
    say: (c) => {
      const tired = c.state.players[0].stamina < c.state.players[1].stamina ? 0 : 1;
      return [
        `${name(c, tired)} is blowing hard. The legs are going.`,
        `Look at the recovery time there. ${name(c, tired)} is running on empty.`,
        'The pace has dropped. Both of them are into the reserves now.',
      ];
    },
  },
  {
    id: 'ball-warm',
    speaker: 'colour',
    priority: 40,
    cooldown: 120,
    when: (c) => c.event.type === 'point' && c.state.ball.temperature > 40,
    say: () => [
      'The ball is really hot now. It is sitting up off the back wall and the rallies are stretching.',
      'Warm ball, lively court. Very hard to hit a winner in these conditions.',
    ],
  },
  {
    id: 'fast-shot',
    speaker: 'colour',
    priority: 50,
    cooldown: 40,
    when: (c) => c.event.type === 'racketHit' && c.event.speed * 3.6 > 200,
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'racketHit' }>;
      return [
        `${Math.round(e.speed * 3.6)} kilometres an hour. That is serious pace.`,
        `He has absolutely leathered that. ${Math.round(e.speed * 3.6)} k.p.h.`,
      ];
    },
  },

  // ---- Openings ----------------------------------------------------------
  {
    id: 'serve-fault',
    speaker: 'pbp',
    priority: 78,
    cooldown: 8,
    when: (c) =>
      c.event.type === 'rallyEnd' &&
      (c.event.outcome === 'fault' || c.event.outcome === 'footFault'),
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'rallyEnd' }>;
      return [
        `${OUTCOME_PHRASE[e.outcome] ?? 'A fault'} — and there is no second serve in squash. Rally gone.`,
        'A fault on the serve, and that is a free point.',
      ];
    },
  },
  {
    id: 'hit-opponent',
    speaker: 'pbp',
    priority: 80,
    cooldown: 15,
    when: (c) => c.event.type === 'hitOpponent',
    say: (c) => {
      const e = c.event as Extract<SimEvent, { type: 'hitOpponent' }>;
      return e.wouldHaveBeenGood
        ? [`Straight into ${name(c, e.struck)}. That has to be a stroke.`, 'He has been hit, and he was in the way. Stroke.']
        : ['Hit by the ball, but that return was never reaching the front wall.'];
    },
  },
];

/** Openers used once at the top of the broadcast. */
export const INTRO_LINES = (
  names: [string, string],
  characters: [Character, Character],
  refereeName: string,
): Array<{ speaker: Speaker; text: string }> => [
  {
    speaker: 'pbp',
    text: `Welcome to the glass court. ${characters[0].name} of ${characters[0].country} against ${characters[1].name} of ${characters[1].country}.`,
  },
  {
    speaker: 'colour',
    text: `${characters[0].bio}`,
  },
  {
    speaker: 'colour',
    text: `And across from him, ${names[1]}. ${characters[1].bio}`,
  },
  {
    speaker: 'pbp',
    text: `${refereeName} is the referee. Best of five games, point-a-rally to eleven. Love-all, play.`,
  },
];
