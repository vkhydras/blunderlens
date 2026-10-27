import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { parsePosition, isFen, changeTurn, pastedImage, readScreenshot } from '../lib/position.js';
import { positionProblem } from '../../../shared/legal.js';

export default function Home() {
  const [username, setUsername] = useState(() => localStorage.getItem('lastUsername') || '');
  const [players, setPlayers] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [orientation, setOrientation] = useState('white');

  useEffect(() => {
    api.players().then(setPlayers).catch(() => {});
  }, []);

  const go = (u) => u.trim() && (location.hash = `#/player/${encodeURIComponent(u.trim())}/games`);

  // Paste a screenshot (Ctrl+V anywhere on this page): read the board from it.
  useEffect(() => {
    const onPaste = async (e) => {
      const file = pastedImage(e);
      if (!file) return;
      e.preventDefault();
      setError('');
      setReading(true);
      try {
        const { fen, flipped } = await readScreenshot(file);
        setText(fen);
        setOrientation(flipped ? 'black' : 'white');
      } catch (err) {
        setError(err.message);
      } finally {
        setReading(false);
      }
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, []);

  const input = text.trim();
  const turn = isFen(input) ? input.split(' ')[1] : null;
  const setTurn = (t) => {
    const next = changeTurn(input, t);
    const problem = positionProblem(next);
    if (problem) return setError(`${problem}.`);
    setError('');
    setText(next);
  };

  // Hands the position to the board page, which reads it on load.
  const openBoard = () => {
    try {
      const { startFen, moves } = parsePosition(input);
      localStorage.setItem('liveBoard', JSON.stringify({ startFen, moves, orientation }));
      sessionStorage.setItem('boardFromHome', '1');
      location.hash = '#/board';
    } catch (e) {
      setError(e.message);
    }
  };
  const review = async () => {
    try {
      const { uuid } = await api.importPgn(input);
      location.hash = `#/game/${uuid}`;
    } catch {
      setError('Not a valid PGN.');
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
        <summary>Open a position or game on the board</summary>
        <p className="muted small">Paste a FEN, a PGN or a screenshot of a board, then play moves for both sides with Stockfish's suggestions.</p>
        <textarea
          rows={6}
          placeholder="Paste a FEN, PGN or a screenshot of a board…"
          value={text}
          onChange={(e) => (setText(e.target.value), setError(''))}
        />
        {reading && <div className="muted small">Reading the board…</div>}
        {error && <div className="error">{error}</div>}
        {turn && (
          <div className="btn-row">
            <span className="muted small">To move:</span>
            {['w', 'b'].map((t) => (
              <button key={t} className={`btn sm ${turn === t ? '' : 'ghost'}`} onClick={() => setTurn(t)}>
                {t === 'w' ? 'White' : 'Black'}
              </button>
            ))}
          </div>
        )}
        <div className="btn-row">
          <button className="btn primary" disabled={!input} onClick={openBoard}>
            Open on board
          </button>
          {input && !turn && (
            <button className="btn" onClick={review}>
              Full review
            </button>
          )}
        </div>
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
