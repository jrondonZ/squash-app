/**
 * Playable characters.
 *
 * Attributes are hand-tuned so that the well-documented playing styles of the
 * World Tour actually translate into different gameplay: a retriever really
 * does get to more balls, a shotmaker really does find the nick more often.
 *
 * All values are 0–100 and feed directly into the simulation:
 *   power     → racket head speed, so ball pace and how far it carries
 *   touch     → dying-length and drop-shot precision near the front wall
 *   speed     → acceleration and top-end court speed
 *   stamina   → drain rate under load and recovery between rallies
 *   deception → how late the shot shape is committed, delaying the opponent's read
 *   accuracy  → tightness to the side wall and error rate under pressure
 *   volley    → how early the ball can be taken out of the air
 *   retrieval → lunge reach and the ability to dig out the back corners
 *
 * NOTE ON LIKENESS: these are real athletes. Names and career facts are used
 * here the way a fan project uses them; the avatars are procedurally generated
 * and are not likenesses. Shipping this commercially would need PSA and player
 * licensing. See README.
 */

export type Handedness = 'right' | 'left';
export type Tour = 'mens' | 'womens';

export interface Character {
  id: string;
  name: string;
  shortName: string;
  nickname: string;
  country: string;
  countryCode: string;
  tour: Tour;
  handed: Handedness;
  /** Career-high world ranking, for the player-select card. */
  careerHigh: number;
  /** Broadcast-style one-liner used by the commentary team on introduction. */
  bio: string;
  /** Signature shot the AI favours and the commentators call out by name. */
  signatureShot: 'nick' | 'drop' | 'boast' | 'kill' | 'lob' | 'volley' | 'flick';
  /** Kit colours, used to skin the 3D model. */
  kit: { primary: string; secondary: string; accent: string };
  attributes: {
    power: number;
    touch: number;
    speed: number;
    stamina: number;
    deception: number;
    accuracy: number;
    volley: number;
    retrieval: number;
  };
  /** AI temperament: higher means more willing to go short and take risks. */
  aggression: number;
  /** How often the AI holds the ball to wrong-foot the opponent, 0–1. */
  holdFrequency: number;
  /** How readily this character appeals for a let, 0–1. Some players never do. */
  appealTendency: number;
}

export const ROSTER: Character[] = [
  {
    id: 'farag',
    name: 'Ali Farag',
    shortName: 'Farag',
    nickname: 'The Professor',
    country: 'Egypt',
    countryCode: 'EG',
    tour: 'mens',
    handed: 'right',
    careerHigh: 1,
    bio: 'Harvard engineering graduate turned world number one. Moves like the court owes him nothing and takes the ball impossibly early.',
    signatureShot: 'volley',
    kit: { primary: '#0a2a5e', secondary: '#f4f6fb', accent: '#e8b21c' },
    attributes: {
      power: 78,
      touch: 92,
      speed: 90,
      stamina: 88,
      deception: 86,
      accuracy: 95,
      volley: 96,
      retrieval: 87,
    },
    aggression: 0.58,
    holdFrequency: 0.45,
    appealTendency: 0.35,
  },
  {
    id: 'elias',
    name: 'Diego Elias',
    shortName: 'Elias',
    nickname: 'The Puma',
    country: 'Peru',
    countryCode: 'PE',
    tour: 'mens',
    handed: 'right',
    careerHigh: 1,
    bio: 'South America\'s first world number one. Unhurried to the point of insolence, with the softest hands in the game.',
    signatureShot: 'drop',
    kit: { primary: '#c8102e', secondary: '#ffffff', accent: '#111318' },
    attributes: {
      power: 80,
      touch: 97,
      speed: 86,
      stamina: 84,
      deception: 95,
      accuracy: 92,
      volley: 88,
      retrieval: 90,
    },
    aggression: 0.62,
    holdFrequency: 0.72,
    appealTendency: 0.3,
  },
  {
    id: 'asal',
    name: 'Mostafa Asal',
    shortName: 'Asal',
    nickname: 'The Raging Bull',
    country: 'Egypt',
    countryCode: 'EG',
    tour: 'mens',
    handed: 'right',
    careerHigh: 1,
    bio: 'Enormous, physical and utterly relentless. Fills the court and hits the ball harder than anyone on tour.',
    signatureShot: 'kill',
    kit: { primary: '#111318', secondary: '#e02020', accent: '#f2f4f8' },
    attributes: {
      power: 98,
      touch: 82,
      speed: 84,
      stamina: 93,
      deception: 80,
      accuracy: 84,
      volley: 89,
      retrieval: 92,
    },
    aggression: 0.82,
    holdFrequency: 0.4,
    appealTendency: 0.75,
  },
  {
    id: 'coll',
    name: 'Paul Coll',
    shortName: 'Coll',
    nickname: 'Superman',
    country: 'New Zealand',
    countryCode: 'NZ',
    tour: 'mens',
    handed: 'right',
    careerHigh: 1,
    bio: 'The fittest athlete in the sport. Retrieves what should not be retrievable, often horizontally.',
    signatureShot: 'lob',
    kit: { primary: '#0b1020', secondary: '#00c2a8', accent: '#ffffff' },
    attributes: {
      power: 82,
      touch: 80,
      speed: 93,
      stamina: 99,
      deception: 70,
      accuracy: 87,
      volley: 82,
      retrieval: 99,
    },
    aggression: 0.42,
    holdFrequency: 0.28,
    appealTendency: 0.4,
  },
  {
    id: 'elshorbagy',
    name: 'Mohamed ElShorbagy',
    shortName: 'ElShorbagy',
    nickname: 'The Beast',
    country: 'England',
    countryCode: 'GB',
    tour: 'mens',
    handed: 'right',
    careerHigh: 1,
    bio: 'A decade at the top and still the loudest presence on any court. Pace, aggression and a straight drive that never leaves the paint.',
    signatureShot: 'kill',
    kit: { primary: '#1d2b64', secondary: '#f5f7fa', accent: '#d92662' },
    attributes: {
      power: 94,
      touch: 85,
      speed: 85,
      stamina: 90,
      deception: 82,
      accuracy: 90,
      volley: 92,
      retrieval: 86,
    },
    aggression: 0.78,
    holdFrequency: 0.44,
    appealTendency: 0.6,
  },
  {
    id: 'momen',
    name: 'Tarek Momen',
    shortName: 'Momen',
    nickname: 'The Viper',
    country: 'Egypt',
    countryCode: 'EG',
    tour: 'mens',
    handed: 'right',
    careerHigh: 3,
    bio: 'World champion with the fastest hands on tour. Strikes from nowhere and is gone before you have moved.',
    signatureShot: 'flick',
    kit: { primary: '#12403c', secondary: '#a8e063', accent: '#f7f9f4' },
    attributes: {
      power: 84,
      touch: 90,
      speed: 92,
      stamina: 85,
      deception: 93,
      accuracy: 89,
      volley: 94,
      retrieval: 85,
    },
    aggression: 0.7,
    holdFrequency: 0.66,
    appealTendency: 0.3,
  },
  {
    id: 'makin',
    name: 'Joel Makin',
    shortName: 'Makin',
    nickname: 'The Welsh Wall',
    country: 'Wales',
    countryCode: 'GB-WLS',
    tour: 'mens',
    handed: 'right',
    careerHigh: 5,
    bio: 'A physical examination in human form. Grinds rallies past the fifty-shot mark and looks fresher at the end than the start.',
    signatureShot: 'lob',
    kit: { primary: '#00693e', secondary: '#ffffff', accent: '#c8102e' },
    attributes: {
      power: 86,
      touch: 76,
      speed: 87,
      stamina: 97,
      deception: 66,
      accuracy: 86,
      volley: 80,
      retrieval: 95,
    },
    aggression: 0.34,
    holdFrequency: 0.22,
    appealTendency: 0.5,
  },
  {
    id: 'ashour',
    name: 'Ramy Ashour',
    shortName: 'Ashour',
    nickname: 'The Artist',
    country: 'Egypt',
    countryCode: 'EG',
    tour: 'mens',
    handed: 'right',
    careerHigh: 1,
    bio: 'Three-time world champion and the most naturally gifted player the sport has produced. Legend character.',
    signatureShot: 'nick',
    kit: { primary: '#2b0f54', secondary: '#ffd166', accent: '#f5f0ff' },
    attributes: {
      power: 90,
      touch: 99,
      speed: 95,
      stamina: 72,
      deception: 99,
      accuracy: 93,
      volley: 95,
      retrieval: 88,
    },
    aggression: 0.86,
    holdFrequency: 0.85,
    appealTendency: 0.25,
  },
  {
    id: 'sherbini',
    name: 'Nour El Sherbini',
    shortName: 'El Sherbini',
    nickname: 'The Warrior Princess',
    country: 'Egypt',
    countryCode: 'EG',
    tour: 'womens',
    handed: 'right',
    careerHigh: 1,
    bio: 'The most decorated women\'s player of her generation. Timing so clean the ball seems to leave the racket early.',
    signatureShot: 'drop',
    kit: { primary: '#7a1f4d', secondary: '#ffd8e8', accent: '#ffffff' },
    attributes: {
      power: 86,
      touch: 96,
      speed: 90,
      stamina: 89,
      deception: 92,
      accuracy: 95,
      volley: 93,
      retrieval: 90,
    },
    aggression: 0.64,
    holdFrequency: 0.6,
    appealTendency: 0.3,
  },
  {
    id: 'gohar',
    name: 'Nouran Gohar',
    shortName: 'Gohar',
    nickname: 'The Terminator',
    country: 'Egypt',
    countryCode: 'EG',
    tour: 'womens',
    handed: 'right',
    careerHigh: 1,
    bio: 'Hits through opponents rather than around them. The heaviest ball in the women\'s game by a distance.',
    signatureShot: 'kill',
    kit: { primary: '#0d1b2a', secondary: '#ff6b35', accent: '#f8f9fa' },
    attributes: {
      power: 97,
      touch: 84,
      speed: 88,
      stamina: 92,
      deception: 76,
      accuracy: 90,
      volley: 91,
      retrieval: 88,
    },
    aggression: 0.8,
    holdFrequency: 0.35,
    appealTendency: 0.45,
  },
  {
    id: 'hammamy',
    name: 'Hania El Hammamy',
    shortName: 'El Hammamy',
    nickname: 'The Hurricane',
    country: 'Egypt',
    countryCode: 'EG',
    tour: 'womens',
    handed: 'right',
    careerHigh: 2,
    bio: 'Explosive off the T and merciless in the front court. Turns defence into attack in a single step.',
    signatureShot: 'volley',
    kit: { primary: '#14213d', secondary: '#fca311', accent: '#e5e5e5' },
    attributes: {
      power: 90,
      touch: 88,
      speed: 96,
      stamina: 90,
      deception: 82,
      accuracy: 88,
      volley: 92,
      retrieval: 91,
    },
    aggression: 0.74,
    holdFrequency: 0.42,
    appealTendency: 0.4,
  },
  {
    id: 'sobhy',
    name: 'Amanda Sobhy',
    shortName: 'Sobhy',
    nickname: 'The Stars and Stripes',
    country: 'United States',
    countryCode: 'US',
    tour: 'womens',
    handed: 'right',
    careerHigh: 3,
    bio: 'The highest-ranked American in history. Attacks the ball early and takes it in short at every opportunity.',
    signatureShot: 'nick',
    kit: { primary: '#0a3161', secondary: '#ffffff', accent: '#b31942' },
    attributes: {
      power: 92,
      touch: 87,
      speed: 86,
      stamina: 86,
      deception: 80,
      accuracy: 87,
      volley: 90,
      retrieval: 85,
    },
    aggression: 0.76,
    holdFrequency: 0.4,
    appealTendency: 0.45,
  },
  {
    id: 'kennedy',
    name: 'Georgina Kennedy',
    shortName: 'Kennedy',
    nickname: 'Gina',
    country: 'England',
    countryCode: 'GB',
    tour: 'womens',
    handed: 'right',
    careerHigh: 4,
    bio: 'Harvard-schooled and endlessly inventive. Volleys everything and disguises the drop until the last instant.',
    signatureShot: 'volley',
    kit: { primary: '#012169', secondary: '#ffffff', accent: '#c8102e' },
    attributes: {
      power: 82,
      touch: 92,
      speed: 91,
      stamina: 88,
      deception: 90,
      accuracy: 89,
      volley: 95,
      retrieval: 88,
    },
    aggression: 0.68,
    holdFrequency: 0.58,
    appealTendency: 0.35,
  },
  {
    id: 'david',
    name: 'Nicol David',
    shortName: 'David',
    nickname: 'The Duchess',
    country: 'Malaysia',
    countryCode: 'MY',
    tour: 'womens',
    handed: 'right',
    careerHigh: 1,
    bio: 'One hundred and eight consecutive months at world number one. Nothing gets past her. Legend character.',
    signatureShot: 'lob',
    kit: { primary: '#010066', secondary: '#ffcc00', accent: '#cc0001' },
    attributes: {
      power: 80,
      touch: 91,
      speed: 94,
      stamina: 98,
      deception: 78,
      accuracy: 96,
      volley: 88,
      retrieval: 98,
    },
    aggression: 0.44,
    holdFrequency: 0.3,
    appealTendency: 0.2,
  },
];

export const characterById = (id: string): Character =>
  ROSTER.find((c) => c.id === id) ?? ROSTER[0];

export const rosterByTour = (tour: Tour): Character[] =>
  ROSTER.filter((c) => c.tour === tour);

/** Overall rating shown on the select screen — a simple weighted mean. */
export const overallRating = (c: Character): number => {
  const a = c.attributes;
  return Math.round(
    (a.power * 0.14 +
      a.touch * 0.15 +
      a.speed * 0.14 +
      a.stamina * 0.13 +
      a.deception * 0.11 +
      a.accuracy * 0.15 +
      a.volley * 0.09 +
      a.retrieval * 0.09) /
      1.0,
  );
};
