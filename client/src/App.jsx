import { useEffect, useState } from 'react';
import Home from './components/Home.jsx';
import PlayerPage from './components/PlayerPage.jsx';
import AnalysisPage from './components/AnalysisPage.jsx';
import LivePage from './components/LivePage.jsx';

// Routes: #/  ·  #/player/<user>/<tab>?<query>  ·  #/game/<uuid>/<ply>  ·  #/live
export function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(query)) };
}

export default function App() {
  const { parts, query } = useRoute();
  const [page, a, b] = parts;
  const lastUser = localStorage.getItem('lastUsername');

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <svg viewBox="0 0 24 24" className="brand-mark" aria-hidden="true">
            <circle cx="10" cy="10" r="6.5" />
            <path d="M15 15l6 6" />
            <path d="M7.5 12.5l2-3 2 1.5 1.5-3" />
          </svg>
          <span>
            Blunder<b>Lens</b>
          </span>
        </a>
        <nav className="topnav">
          <a href="#/live" className={page === 'live' ? 'on' : ''}>
            Live board
          </a>
          {lastUser && (
            <>
              <a href={`#/player/${encodeURIComponent(lastUser)}/games`} className={page === 'player' && a?.toLowerCase() === lastUser.toLowerCase() ? 'on' : ''}>
                {lastUser}
              </a>
              <a href={`#/player/${encodeURIComponent(lastUser)}/weaknesses`} className={page === 'player' && b === 'weaknesses' ? 'on' : ''}>
                Weaknesses
              </a>
            </>
          )}
        </nav>
      </header>
      <main className={page === 'game' || page === 'live' ? 'main-full' : ''}>
        {page === 'player' && a ? (
          <PlayerPage key={a.toLowerCase()} username={a} tab={b || 'games'} query={query} />
        ) : page === 'live' ? (
          <LivePage />
        ) : page === 'game' && a ? (
          <AnalysisPage key={a} uuid={a} initialPly={b ? Number(b) : null} />
        ) : (
          <Home />
        )}
      </main>
    </div>
  );
}
