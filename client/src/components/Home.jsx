import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function Home() {
  const [username, setUsername] = useState(() => localStorage.getItem('lastUsername') || '');
  const [players, setPlayers] = useState([]);
  const [pgn, setPgn] = useState('');
  const [pgnError, setPgnError] = useState('');

  useEffect(() => {
    api.players().then(setPlayers).catch(() => {});
  }, []);

  const go = (u) => u.trim() && (location.hash = `#/player/${encodeURIComponent(u.trim())}/games`);

  const analyzePgn = async () => {
    try {
      const { uuid } = await api.importPgn(pgn);
      location.hash = `#/game/${uuid}`;
    } catch (e) {
      setPgnError(e.message);
    }
  };

  return (
    <div className="home">
      <section className="hero">
        <p className="eyebrow">Stockfish 19 · your Chess.com games</p>
        <h1>Find the patterns behind your lost games.</h1>
        <p className="muted lead">Load a Chess.com account, let Stockfish review your games, and see exactly which mistakes keep costing you points.</p>
        <form
          className="search"
          onSubmit={(e) => {
            e.preventDefault();
            go(username);
          }}
        >
          <input autoFocus placeholder="Chess.com username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <button className="btn primary" type="submit">
            Open
          </button>
        </form>
        {players.length > 0 && (
          <div className="known">
            {players.map((p) => (
              <button key={p.username} className="known-player" onClick={() => go(p.username)}>
                {p.avatar ? <img src={p.avatar} alt="" /> : <span className="avatar-fallback">{p.username[0]}</span>}
                <span>{p.username}</span>
                <span className="muted small">{p.games.toLocaleString()} games</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <details className="panel pgn-box">
        <summary>Review a PGN instead</summary>
        <textarea rows={6} placeholder="Paste PGN…" value={pgn} onChange={(e) => setPgn(e.target.value)} />
        {pgnError && <div className="error">{pgnError}</div>}
        <button className="btn" disabled={!pgn.trim()} onClick={analyzePgn}>
          Review PGN
        </button>
      </details>

      <a className="source-link" href="https://github.com/vkhydras/blunderlens" target="_blank" rel="noreferrer">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
          />
        </svg>
        <span>Source code on GitHub</span>
        <span className="muted">↗</span>
      </a>
    </div>
  );
}
