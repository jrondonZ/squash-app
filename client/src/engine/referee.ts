import { CONDUCT_LADDER, RULES, type ConductPenalty } from './constants';
import { clamp01, type Rng } from './math';
import {
  decideInterference,
  severityOf,
  type InterferenceDecision,
  type InterferenceObservation,
} from './interference';
import type { RallyOutcome } from './types';

/**
 * The referee.
 *
 * Two ideas make this feel like the real thing.
 *
 * First, the referee rules on what they *saw*, not on ground truth. The on-court
 * call is made from a perturbed copy of the interference observation, with the
 * perturbation scaled by how marginal the incident was and by the referee's own
 * quality. Video review then re-rules on the unperturbed truth — so reviews
 * overturn marginal calls far more often than obvious ones, which is exactly
 * what happens on tour.
 *
 * Second, referees differ. A strict referee gives fewer strokes and warns
 * earlier for dissent; a lenient one lets more go.
 */

export interface RefereeProfile {
  id: string;
  name: string;
  /** 0 generous with strokes … 1 unforgiving. */
  strictness: number;
  /** 0 misses things … 1 sees everything. */
  accuracy: number;
  /** How quickly dissent escalates the conduct ladder, 0–1. */
  patience: number;
  /** Flavour line the commentators use when a big call goes in. */
  reputation: string;
}

export const REFEREES: RefereeProfile[] = [
  {
    id: 'central',
    name: 'Roy Gingell',
    strictness: 0.52,
    accuracy: 0.86,
    patience: 0.6,
    reputation: 'One of the most experienced officials on the tour.',
  },
  {
    id: 'strict',
    name: 'Nasser Zahran',
    strictness: 0.78,
    accuracy: 0.9,
    patience: 0.35,
    reputation: 'Runs a tight court. Players know exactly where they stand.',
  },
  {
    id: 'lenient',
    name: 'Wendy Danzey',
    strictness: 0.3,
    accuracy: 0.82,
    patience: 0.8,
    reputation: 'Lets the players play. Rarely reaches for the conduct sheet.',
  },
];

export interface RefereeState {
  profileId: string;
  /** Conduct ladder position per player. */
  conductLevel: [number, number];
  /** Reviews used this game, per player. */
  reviewsUsed: [number, number];
  /** Running count of decisions, for the stats panel. */
  decisions: { lets: number; strokes: number; noLets: number };
  /** The last decision made, so the UI and review can refer to it. */
  lastDecision: RefereeRuling | null;
}

export const createRefereeState = (profileId = 'central'): RefereeState => ({
  profileId,
  conductLevel: [0, 0],
  reviewsUsed: [0, 0],
  decisions: { lets: 0, strokes: 0, noLets: 0 },
  lastDecision: null,
});

export interface RefereeRuling {
  decision: InterferenceDecision;
  /** What the truth would have been with a perfect view. */
  truth: InterferenceDecision;
  /** Did the referee's view differ from the truth? */
  wouldBeOverturned: boolean;
  appellant: 0 | 1;
  /** Full spoken call, e.g. "Yes let". */
  spoken: string;
}

export const profileFor = (state: RefereeState): RefereeProfile =>
  REFEREES.find((r) => r.id === state.profileId) ?? REFEREES[0];

/**
 * Perturb an observation to model an imperfect viewing angle. Marginal
 * incidents get shaken harder, because that is where referees actually differ.
 */
const asSeenBy = (
  truth: InterferenceObservation,
  profile: RefereeProfile,
  rng: Rng,
): InterferenceObservation => {
  const severity = severityOf(truth);
  // Uncertainty peaks for mid-severity incidents and falls away at both ends.
  const ambiguity = 1 - Math.abs(severity - 0.5) * 2;
  const noise = (1 - profile.accuracy) * (0.35 + ambiguity * 0.65);

  const jitter = (v: number, scale = 1) => clamp01(v + rng.gaussian(0, noise * scale));

  return {
    ...truth,
    accessBlocked: jitter(truth.accessBlocked),
    swingImpeded: jitter(truth.swingImpeded),
    viewBlocked: jitter(truth.viewBlocked, 1.4),
    lineBlocked: jitter(truth.lineBlocked),
    // Effort is the hardest thing to judge from the back of the court.
    opponentClearing: jitter(truth.opponentClearing, 1.5),
    strikerEffort: jitter(truth.strikerEffort, 1.3),
    returnQuality: jitter(truth.returnQuality, 0.8),
    winningOpportunity: jitter(truth.winningOpportunity),
  };
};

/** Rule on an appeal. */
export const ruleOnAppeal = (
  state: RefereeState,
  observation: InterferenceObservation,
  appellant: 0 | 1,
  rng: Rng,
): RefereeRuling => {
  const profile = profileFor(state);

  const truth = decideInterference(observation, profile.strictness);
  const perceived = decideInterference(asSeenBy(observation, profile, rng), profile.strictness);

  if (perceived.decision === 'let') state.decisions.lets += 1;
  else if (perceived.decision === 'stroke') state.decisions.strokes += 1;
  else state.decisions.noLets += 1;

  const ruling: RefereeRuling = {
    decision: perceived,
    truth,
    wouldBeOverturned: perceived.decision !== truth.decision,
    appellant,
    spoken:
      perceived.decision === 'let'
        ? 'Yes let'
        : perceived.decision === 'stroke'
          ? `Stroke to ${appellant === 0 ? 'the striker' : 'the striker'}`
          : 'No let',
  };

  state.lastDecision = ruling;
  return ruling;
};

// ---------------------------------------------------------------------------
// Video review
// ---------------------------------------------------------------------------

export interface ReviewResult {
  granted: boolean;
  overturned: boolean;
  /** The decision that now stands. */
  finalDecision: InterferenceDecision;
  message: string;
  /** Reviews the player has left afterwards. */
  reviewsRemaining: number;
}

/**
 * PSA video review. A player has one review per game; it is retained if the
 * original decision is overturned, and lost if the call stands.
 */
export const requestReview = (
  state: RefereeState,
  ruling: RefereeRuling,
  player: 0 | 1,
): ReviewResult => {
  const used = state.reviewsUsed[player];
  const remaining = RULES.reviewsPerGame - used;

  if (remaining <= 0) {
    return {
      granted: false,
      overturned: false,
      finalDecision: ruling.decision,
      message: 'No reviews remaining. The decision stands.',
      reviewsRemaining: 0,
    };
  }

  const overturned = ruling.wouldBeOverturned;
  // A successful review is retained; an unsuccessful one is spent.
  if (!overturned) state.reviewsUsed[player] = used + 1;

  return {
    granted: true,
    overturned,
    finalDecision: overturned ? ruling.truth : ruling.decision,
    message: overturned
      ? `Decision overturned. ${ruling.truth.call}. ${ruling.truth.detail}`
      : `Original decision stands. ${ruling.decision.call}.`,
    reviewsRemaining: RULES.reviewsPerGame - state.reviewsUsed[player],
  };
};

export const resetReviews = (state: RefereeState): void => {
  state.reviewsUsed = [0, 0];
};

// ---------------------------------------------------------------------------
// Conduct
// ---------------------------------------------------------------------------

export type ConductOffence =
  | 'dissent'
  | 'audibleObscenity'
  | 'abuseOfRacket'
  | 'dangerousPlay'
  | 'excessiveSwing'
  | 'timeWasting'
  | 'delay'
  | 'coaching';

export const CONDUCT_TEXT: Record<ConductOffence, string> = {
  dissent: 'dissent',
  audibleObscenity: 'audible obscenity',
  abuseOfRacket: 'abuse of racket',
  dangerousPlay: 'dangerous play',
  excessiveSwing: 'excessive swing',
  timeWasting: 'time wasting',
  delay: 'delay',
  coaching: 'receiving coaching during play',
};

export interface ConductRuling {
  penalty: ConductPenalty;
  offence: ConductOffence;
  spoken: string;
  /** Set when the penalty awards the rally to the opponent. */
  awardsRally: boolean;
  /** Set when the penalty awards a whole game or the match. */
  awardsGame: boolean;
  awardsMatch: boolean;
}

/**
 * Apply the conduct ladder. The first offence is normally a warning; repeat
 * offences escalate to a stroke, a game and ultimately the match. A referee
 * with low patience starts higher up the ladder.
 */
export const applyConduct = (
  state: RefereeState,
  player: 0 | 1,
  offence: ConductOffence,
  playerName: string,
): ConductRuling => {
  const profile = profileFor(state);

  // Dangerous play skips the warning entirely.
  const severe = offence === 'dangerousPlay';
  const impatience = 1 - profile.patience;
  let level = state.conductLevel[player];
  if (severe) level = Math.max(level, 1);
  if (impatience > 0.6 && level === 0 && offence !== 'timeWasting') level = Math.max(level, 0);

  const penalty = CONDUCT_LADDER[Math.min(level, CONDUCT_LADDER.length - 1)];
  state.conductLevel[player] = Math.min(level + 1, CONDUCT_LADDER.length - 1);

  const name = CONDUCT_TEXT[offence];
  const spoken =
    penalty === 'warning'
      ? `Conduct warning, ${playerName}, for ${name}.`
      : penalty === 'stroke'
        ? `Conduct stroke to the opponent, ${playerName}, for ${name}.`
        : penalty === 'game'
          ? `Conduct game to the opponent, ${playerName}, for ${name}.`
          : `Conduct match, ${playerName}, for ${name}.`;

  return {
    penalty,
    offence,
    spoken,
    awardsRally: penalty === 'stroke',
    awardsGame: penalty === 'game',
    awardsMatch: penalty === 'match',
  };
};

// ---------------------------------------------------------------------------
// Routine calls
// ---------------------------------------------------------------------------

/** The referee's between-games time calls, at the seconds they are made. */
export const intervalCall = (secondsElapsed: number): string | null => {
  const remaining = Math.round(RULES.betweenGamesSeconds - secondsElapsed);
  if (remaining === 45) return 'Forty-five seconds.';
  if (remaining === 15) return 'Fifteen seconds.';
  if (remaining === 0) return 'Time.';
  return null;
};

/** Referee wording for a dead-ball outcome, spoken before the score. */
export const callFor = (outcome: RallyOutcome): string => {
  switch (outcome) {
    case 'down':
      return 'Down';
    case 'out':
      return 'Out';
    case 'notUp':
    case 'doubleBounce':
      return 'Not up';
    case 'fault':
      return 'Fault';
    case 'footFault':
      return 'Foot fault';
    case 'let':
      return 'Yes let';
    case 'stroke':
      return 'Stroke';
    case 'noLet':
      return 'No let';
    case 'carry':
      return 'Carry';
    case 'hitOpponent':
      return 'Stroke';
    case 'conduct':
      return 'Conduct';
    default:
      return '';
  }
};
