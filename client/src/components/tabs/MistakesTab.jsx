import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { TimeClassSelect, Badge, themeLabel, moveLabel, Empty } from '../Bits.jsx';
import { THEMES } from '../../../../shared/review.js';
import { PIECE_NAME } from '../../../../shared/tactics.js';

export default function MistakesTab({ username, version, query }) {
  const [f, setF] = useState({ time_class: 'all', phase: '', cls: '', piece: '', theme: '', allowed: '', missed: '', pressure: '', ...query });
  useEffect(() => setF((x) => ({ ...x, ...query })), [JSON.stringify(query)]);
  const { data } = useAsync(() => api.mistakes(username, f), [username, JSON.stringify(f), version]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target ? e.target.value : e });

  return (
    <section className="panel">
      <div className="filters">
        <TimeClassSelect value={f.time_class} onChange={set('time_class')} />
        <select value={f.cls} onChange={set('cls')}>
          <option value="">All errors</option>
          <option value="blunder">Blunders</option>
          <option value="mistake">Mistakes</option>
          <option value="miss">Misses</option>
        </select>
        <select value={f.phase} onChange={set('phase')}>
          <option value="">Any phase</option>
          <option value="opening">Opening</option>
          <option value="middlegame">Middlegame</option>
          <option value="endgame">Endgame</option>
        </select>
        <select value={f.theme || f.allowed} onChange={(e) => setF({ ...f, theme: e.target.value, allowed: '' })}>
          <option value="">Any tactic</option>
          {Object.keys(THEMES).map((t) => (
            <option key={t} value={t}>
              {THEMES[t].label}
            </option>
          ))}
        </select>
        <select value={f.piece} onChange={set('piece')}>
          <option value="">Any piece</option>
          {Object.entries(PIECE_NAME).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={!!f.missed} onChange={(e) => setF({ ...f, missed: e.target.checked ? '1' : '' })} /> Missed tactics
        </label>
        <label className="check">
          <input type="checkbox" checked={!!f.pressure} onChange={(e) => setF({ ...f, pressure: e.target.checked ? '1' : '' })} /> Low clock
        </label>
      </div>
      {data && (
        <div className="games-summary small">
          <b>{data.total}</b> positions where you went wrong. Open one, press <kbd>Retry</kbd>, and find the better move yourself.
        </div>
      )}
      <div className="mistake-list">
        {data?.items.map((m, i) => (
          <a key={i} className="mistake" href={`#/game/${m.uuid}/${m.ply}`}>
            <Badge cls={m.missed.length && m.cls !== 'blunder' && m.cls !== 'mistake' ? 'miss' : m.cls} />
            <span className="mk-move">
              <b>{moveLabel(m.ply, m.san)}</b>
              <span className="muted"> best {m.bestSan}</span>
            </span>
            <span className="mk-note small">{m.note || <span className="muted">−{Math.round(m.loss)}% win chance</span>}</span>
            <span className="mk-tags">
              {m.allowed.map((t) => (
                <span key={t} className="tag tag-bad">
                  allowed {themeLabel(t)}
                </span>
              ))}
              {m.missed.map((t) => (
                <span key={t} className="tag tag-miss">
                  missed {themeLabel(t)}
                </span>
              ))}
              <span className="tag">{m.phase}</span>
              {m.pressure && <span className="tag">low clock</span>}
            </span>
            <span className="mk-opp small muted">
              vs {m.opponent} · {new Date(m.t).toLocaleDateString()}
            </span>
          </a>
        ))}
        {data && !data.items.length && <Empty>No mistakes match — nice, or analyze more games.</Empty>}
      </div>
    </section>
  );
}
