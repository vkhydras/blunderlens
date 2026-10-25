import { useEffect, useState } from 'react';
import { api, resultFor, formatTimeControl } from '../../lib/api.js';
import { TimeClassSelect, Empty, NewestGameButton } from '../Bits.jsx';

const PAGE = 50;

export default function GamesTab({ username, version }) {
  const [f, setF] = useState({ time_class: 'all', result: 'all', color: 'all', analyzed: 'all', q: '' });
  const [data, setData] = useState(null);
  const [extra, setExtra] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      const d = await api.games(username, { ...f, limit: PAGE }).catch(() => null);
      if (!alive) return;
      setData(d);
      setExtra([]);
      setLoading(false);
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [username, f, version]);

  const more = async () => {
    const d = await api.games(username, { ...f, limit: PAGE, offset: PAGE + extra.length });
    setExtra((x) => [...x, ...d.games]);
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const rows = data ? [...data.games, ...extra] : [];

  return (
    <section className="panel">
      <div className="filters">
        <TimeClassSelect value={f.time_class} onChange={set('time_class')} />
        <select value={f.result} onChange={set('result')}>
          <option value="all">All results</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="draw">Draws</option>
        </select>
        <select value={f.color} onChange={set('color')}>
          <option value="all">Both colors</option>
          <option value="white">As White</option>
          <option value="black">As Black</option>
        </select>
        <select value={f.analyzed} onChange={set('analyzed')}>
          <option value="all">Analyzed or not</option>
          <option value="1">Analyzed</option>
          <option value="0">Not analyzed</option>
        </select>
        <input placeholder="Opponent or opening…" value={f.q} onChange={set('q')} />
        <NewestGameButton username={username} />
      </div>
      {data && (
        <div className="games-summary small">
          <b>{data.total.toLocaleString()}</b> games · <span className="win">{data.wins} W</span> · <span className="loss">{data.losses} L</span> ·{' '}
          <span className="draw">{data.draws} D</span> · {data.analyzed} analyzed
        </div>
      )}
      <div className="game-list">
        {rows.map((g) => (
          <GameRow key={g.uuid} g={g} username={username} />
        ))}
        {!loading && data && !rows.length && <Empty>No games match these filters.</Empty>}
      </div>
      {data && rows.length < data.total && (
        <div className="center pad">
          <button className="btn" onClick={more}>
            Show more
          </button>
        </div>
      )}
    </section>
  );
}

function GameRow({ g, username }) {
  const white = g.white.toLowerCase() === username.toLowerCase();
  const res = resultFor(g, username);
  const opp = white ? { name: g.black, r: g.black_rating } : { name: g.white, r: g.white_rating };
  const myR = white ? g.white_rating : g.black_rating;
  const acc = g.acc_w !== null && g.acc_w !== undefined ? (white ? g.acc_w : g.acc_b) : g.accuracies ? (white ? g.accuracies.white : g.accuracies.black) : null;
  const ours = g.acc_w !== null && g.acc_w !== undefined;
  const canReview = g.rules === 'chess' && g.has_pgn;
  return (
    <a className={`game-row ${canReview ? '' : 'disabled'}`} href={canReview ? `#/game/${g.uuid}` : undefined}>
      <span className={`res res-${res}`}>{res === 'win' ? 'W' : res === 'loss' ? 'L' : 'D'}</span>
      <span className="g-side">
        <span className={`piece-dot ${white ? 'w' : 'b'}`} />
      </span>
      <span className="g-opp">
        <b>{opp.name}</b> <span className="muted">{opp.r}</span>
        <span className="g-open muted small">{g.opening || (g.rules !== 'chess' ? g.rules : '')}</span>
      </span>
      <span className="g-tc muted small">
        {formatTimeControl(g.time_control)} {g.time_class}
      </span>
      <span className="g-rating small muted">{myR}</span>
      <span className={`g-acc ${ours ? 'ours' : ''}`} title={ours ? 'Our Stockfish accuracy' : 'Chess.com accuracy'}>
        {acc !== null && acc !== undefined ? acc.toFixed(1) : '—'}
      </span>
      <span className="g-date small muted">{new Date(g.end_time * 1000).toLocaleDateString()}</span>
      <span className="g-go">{canReview ? '→' : ''}</span>
    </a>
  );
}
