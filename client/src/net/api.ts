/**
 * Rails API client.
 *
 * The backend is deliberately thin: it hands out room codes, relays messages
 * between the two peers, and stores finished matches for the ladder. It never
 * simulates anything — the physics lives entirely in the browser, which is what
 * keeps the game playable at 60 Hz and the server cheap to run.
 */

const API_BASE = '/api';

export interface RoomInfo {
  code: string;
  hostName: string;
  guestName: string | null;
  hostCharacter: string;
  guestCharacter: string | null;
  seed: string;
  status: 'waiting' | 'ready' | 'playing' | 'finished';
}

export interface MatchRecord {
  id: number;
  playerOne: string;
  playerTwo: string;
  characterOne: string;
  characterTwo: string;
  games: [number, number];
  gameScores: Array<[number, number]>;
  winner: 0 | 1;
  durationSeconds: number;
  totalRallies: number;
  longestRally: number;
  playedAt: string;
}

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...init,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body; the status code is all we have.
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
};

export const createRoom = (payload: { hostName: string; characterId: string }) =>
  request<RoomInfo>('/rooms', {
    method: 'POST',
    body: JSON.stringify({ host_name: payload.hostName, host_character: payload.characterId }),
  });

export const joinRoom = (code: string, payload: { guestName: string; characterId: string }) =>
  request<RoomInfo>(`/rooms/${code}/join`, {
    method: 'POST',
    body: JSON.stringify({ guest_name: payload.guestName, guest_character: payload.characterId }),
  });

export const fetchRoom = (code: string) => request<RoomInfo>(`/rooms/${code}`);

export const recordMatch = (record: Omit<MatchRecord, 'id' | 'playedAt'>) =>
  request<MatchRecord>('/matches', {
    method: 'POST',
    body: JSON.stringify({ match: record }),
  });

export const fetchRecentMatches = (limit = 20) =>
  request<MatchRecord[]>(`/matches?limit=${limit}`);

export interface LadderEntry {
  characterId: string;
  played: number;
  won: number;
  winRate: number;
  gamesWon: number;
  gamesLost: number;
}

export const fetchLadder = () => request<LadderEntry[]>('/ladder');

export { ApiError };
