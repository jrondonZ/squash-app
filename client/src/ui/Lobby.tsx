import { useEffect, useState } from 'react';

import { createRoom, joinRoom, type RoomInfo } from '../net/api';

/**
 * The online lobby.
 *
 * Room codes rather than accounts: one player creates a room, reads the code
 * out, the other types it in. The host owns the simulation, so whoever creates
 * the room is the authority for the match that follows.
 */

export interface LobbyProps {
  characterId: string;
  onReady: (info: RoomInfo, role: 'host' | 'guest') => void;
  onBack: () => void;
}

export const Lobby = ({ characterId, onReady, onBack }: LobbyProps) => {
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Remember the display name between sessions; it is the only thing we store.
    const saved = localStorage.getItem('glasscourt:name');
    if (saved) setName(saved);
  }, []);

  const persistName = (value: string) => {
    setName(value);
    localStorage.setItem('glasscourt:name', value);
  };

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await createRoom({ hostName: name || 'Player 1', characterId });
      setRoom(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoin = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await joinRoom(code.trim().toUpperCase(), {
        guestName: name || 'Player 2',
        characterId,
      });
      onReady(info, 'guest');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That room could not be found.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="panel panel-raised w-full max-w-md p-6">
        <div className="eyebrow mb-1">Online versus</div>
        <h2 className="display mb-5 text-2xl">Find an opponent</h2>

        <label className="mb-1.5 block text-[0.68rem] text-arena-400">Your name</label>
        <input
          value={name}
          onChange={(e) => persistName(e.target.value)}
          placeholder="Player"
          maxLength={24}
          className="mb-4 w-full rounded-lg border border-arena-600 bg-arena-900 px-3 py-2 text-sm outline-none focus:border-volt-500"
        />

        <div className="mb-4 flex gap-1.5">
          {(['create', 'join'] as const).map((option) => (
            <button
              key={option}
              onClick={() => {
                setTab(option);
                setError(null);
              }}
              className={`btn flex-1 px-3 py-1.5 text-[0.7rem] ${
                tab === option ? 'btn-primary' : 'btn-ghost'
              }`}
            >
              {option === 'create' ? 'Create room' : 'Join room'}
            </button>
          ))}
        </div>

        {tab === 'create' ? (
          room ? (
            <div className="text-center">
              <div className="eyebrow mb-2">Room code</div>
              <div className="display mb-1 text-5xl tracking-[0.3em] text-volt-400">
                {room.code}
              </div>
              <p className="mb-5 text-xs text-arena-400">
                Give this to your opponent. The match starts when they join.
              </p>
              <div className="mb-4 flex items-center justify-center gap-2 text-xs text-arena-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-volt-500" />
                Waiting for an opponent…
              </div>
              <button className="btn btn-primary w-full" onClick={() => onReady(room, 'host')}>
                Enter the court
              </button>
            </div>
          ) : (
            <button
              className="btn btn-primary w-full"
              onClick={handleCreate}
              disabled={busy}
            >
              {busy ? 'Creating…' : 'Create a room'}
            </button>
          )
        ) : (
          <>
            <label className="mb-1.5 block text-[0.68rem] text-arena-400">Room code</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD"
              maxLength={6}
              className="display mb-4 w-full rounded-lg border border-arena-600 bg-arena-900 px-3 py-2 text-center text-2xl tracking-[0.3em] outline-none focus:border-volt-500"
            />
            <button
              className="btn btn-primary w-full"
              onClick={handleJoin}
              disabled={busy || code.trim().length < 4}
            >
              {busy ? 'Joining…' : 'Join'}
            </button>
          </>
        )}

        {error && <p className="mt-3 text-center text-xs text-danger">{error}</p>}

        <button className="btn btn-ghost mt-4 w-full" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
};
