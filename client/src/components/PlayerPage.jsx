import { useEffect, useRef, useState } from 'react';
import { api, flagEmoji, ago } from '../lib/api.js';
import LineChart from './LineChart.jsx';
import GamesTab from './tabs/GamesTab.jsx';
import WeaknessTab from './tabs/WeaknessTab.jsx';
import MistakesTab from './tabs/MistakesTab.jsx';
import OpeningsTab from './tabs/OpeningsTab.jsx';
import ProgressTab from './tabs/ProgressTab.jsx';

const MODES = [
  { key: 'chess_rapid', label: 'Rapid', tc: 'rapid' },
  { key: 'chess_blitz', label: 'Blitz', tc: 'blitz' },
  { key: 'chess_bullet', label: 'Bullet', tc: 'bullet' },
  { key: 'chess_daily', label: 'Daily', tc: 'daily' },
];
const TABS = [
  ['games', 'Games'],
  ['weaknesses', 'Weaknesses'],
  ['mistakes', 'Mistakes'],
  ['openings', 'Openings'],
  ['progress', 'Progress'],
];

export default function PlayerPage({ username, tab, query }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [sync, setSync] = useState(null);
  const [batch, setBatch] = useState({ running: false });
  const [chartTc, setChartTc] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [version, setVersion] = useState(0); // bump to refresh tabs after sync/batch
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    (async () => {
      try {
        const d = await api.player(username);
        if (!alive.current) return;
        setData(d);
        setBatch(d.batch);
        localStorage.setItem('lastUsername', d.profile.username);
        setSync({ ...d.sync, running: true });
        const s = await api.sync(username, 'recent');
        if (!alive.current) return;
        setSync(s);
        setVersion((v) => v + 1);
      } catch (e) {
        alive.current && setError(e.message);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [username]);

  // Poll while a background sync or batch analysis is running.
  useEffect(() => {
    if (!sync?.running && !batch?.running) return;
    const t = setInterval(async () => {
      const [s, b] = await Promise.all([api.syncStatus(username), api.batchStatus(username)]);
      if (!alive.current) return;
      if ((sync?.running && !s.running) || (batch?.running && b.done !== batch.done)) setVersion((v) => v + 1);
      setSync(s);
      setBatch(b);
    }, 2500);
    return () => clearInterval(t);
  }, [sync?.running, batch?.running, batch?.done, username]);

  const activeModes = MODES.filter((m) => data?.stats?.[m.key]);
  const tc = chartTc || activeModes[0]?.tc;
  useEffect(() => {
    if (tc) api.ratings(username, tc).then(setRatings).catch(() => setRatings([]));
  }, [username, tc, version]);

  if (error && !data)
    return (
      <div className="center-msg">
        <div className="error big">{error}</div>
        <a className="btn" href="#/">
          Back
        </a>
      </div>
    );
  if (!data) return <div className="center-msg muted">Loading {username}…</div>;

  const { profile, stats } = data;
  const startBatch = async (count) => setBatch(await api.batch(username, { count, depth: 12 }));
  const syncAll = async () => setSync({ ...(await api.sync(username, 'all')), running: true });

  return (
    <div className="player-page">
      <section className="player-head">
        <div className="who">
          <img className="avatar" src={profile.avatar || ''} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
          <div>
            <h1>
              {profile.title && <span className="title-badge">{profile.title}</span>}
              {profile.username} <span className="flag">{flagEmoji(profile.country)}</span>
            </h1>
            <div className="muted small">
              {profile.name && <>{profile.name} · </>}joined {new Date(profile.joined * 1000).getFullYear()} · online {ago(profile.last_online * 1000)} ·{' '}
              <a href={profile.url} target="_blank" rel="noreferrer">
                chess.com ↗
              </a>
            </div>
          </div>
        </div>
        <div className="ratings">
          {activeModes.map((m) => {
            const s = stats[m.key];
            return (
              <button key={m.key} className={`rating ${tc === m.tc ? 'on' : ''}`} onClick={() => setChartTc(m.tc)}>
                <span className="rating-label">{m.label}</span>
                <span className="rating-value">{s.last?.rating ?? '—'}</span>
                <span className="rating-best">best {s.best?.rating ?? '—'}</span>
              </button>
            );
          })}
          {stats?.tactics?.highest && (
            <div className="rating">
              <span className="rating-label">Puzzles</span>
              <span className="rating-value">{stats.tactics.highest.rating}</span>
              <span className="rating-best">highest</span>
            </div>
          )}
        </div>
      </section>

      <section className="status-strip">
        <div className="status-item">
          <span className="dot-live" data-on={sync?.running ? '1' : '0'} />
          {sync?.running ? (
            <span>Syncing Chess.com… {sync.done}/{sync.total || '?'} months</span>
          ) : (
            <span>
              {sync?.synced ?? 0}/{sync?.months ?? 0} months stored locally
              {sync?.error && <span className="error"> · {sync.error}</span>}
            </span>
          )}
          {!sync?.running && sync && sync.synced < sync.months && (
            <button className="link-btn" onClick={syncAll}>
              Download full history
            </button>
          )}
        </div>
        <div className="status-item grow">
          {batch?.running ? (
            <>
              <span>
                Analyzing games with Stockfish… {batch.done}/{batch.total}
              </span>
              <div className="mini-progress">
                <div style={{ width: `${(100 * batch.done) / Math.max(1, batch.total)}%` }} />
              </div>
              <button className="link-btn" onClick={async () => setBatch(await api.cancelBatch(username))}>
                Stop
              </button>
            </>
          ) : (
            <>
              <span className="muted">Weakness stats use analyzed games.</span>
              <button className="btn sm" onClick={() => startBatch(25)}>
                Analyze 25 newest
              </button>
              <button className="btn sm ghost" onClick={() => startBatch(100)}>
                100
              </button>
            </>
          )}
        </div>
      </section>

      {ratings.length > 1 && (
        <section className="panel chart-panel">
          <div className="panel-head">
            <h3>{MODES.find((m) => m.tc === tc)?.label} rating</h3>
            <span className="muted small">{ratings.length} points from stored games</span>
          </div>
          <LineChart points={ratings.map((p) => ({ x: p.t, y: p.r, label: new Date(p.t).toLocaleDateString() }))} height={150} />
        </section>
      )}

      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <a key={k} href={`#/player/${encodeURIComponent(username)}/${k}`} className={tab === k ? 'on' : ''}>
            {label}
          </a>
        ))}
      </nav>

      {tab === 'games' && <GamesTab username={username} version={version} />}
      {tab === 'weaknesses' && <WeaknessTab username={username} version={version} onAnalyze={startBatch} batch={batch} />}
      {tab === 'mistakes' && <MistakesTab username={username} version={version} query={query} />}
      {tab === 'openings' && <OpeningsTab username={username} version={version} />}
      {tab === 'progress' && <ProgressTab username={username} version={version} />}
    </div>
  );
}
