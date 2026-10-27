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

      <a className="source-link muted small" href="https://github.com/vkhydras/blunderlens" target="_blank" rel="noreferrer">
        Source code on GitHub ↗
      </a>
    </div>
  );
}
