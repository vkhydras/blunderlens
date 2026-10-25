import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { TimeClassSelect, Empty } from '../Bits.jsx';

export default function OpeningsTab({ username, version }) {
  const [tc, setTc] = useState('all');
  const { data } = useAsync(() => api.openings(username, tc), [username, tc, version]);
  if (!data) return <div className="muted pad">Loading…</div>;
  if (!data.length) return <Empty>Analyze some games to see your opening results.</Empty>;
  return (
    <div>
      <div className="toolbar">
        <TimeClassSelect value={tc} onChange={setTc} />
        <span className="muted small">From analyzed games. "Win chance after" is your Stockfish win chance around move 12.</span>
      </div>
      <div className="grid-2">
        {['w', 'b'].map((c) => (
          <section key={c} className="panel">
            <h3>As {c === 'w' ? 'White' : 'Black'}</h3>
            <table className="stat-table openings">
              <thead>
                <tr>
                  <th>Opening</th>
                  <th>Games</th>
                  <th>Results</th>
                  <th>Accuracy</th>
                  <th>Win chance after</th>
                </tr>
              </thead>
              <tbody>
                {data
                  .filter((o) => o.color === c)
                  .slice(0, 15)
                  .map((o) => (
                    <tr key={o.name} title={o.variations.map(([v, n]) => `${v} (${n})`).join('\n')}>
                      <td>
                        <div>{o.name}</div>
                        {o.commonDeviation && <div className="muted tiny">you usually leave book with {o.commonDeviation.san}</div>}
                        <div className="recent-dots">
                          {o.recent.map((g) => (
                            <a key={g.uuid} href={`#/game/${g.uuid}`} className={`rdot res-${g.result}`} title={`vs ${g.opponent}`} />
                          ))}
                        </div>
                      </td>
                      <td>{o.games}</td>
                      <td>
                        <WDL o={o} />
                      </td>
                      <td>{o.openingAcc ?? '—'}</td>
                      <td className={o.winChanceAfter < 45 ? 'loss' : o.winChanceAfter > 55 ? 'win' : ''}>{o.winChanceAfter ?? '—'}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}

function WDL({ o }) {
  const t = o.games || 1;
  return (
    <div className="wdl" title={`${o.wins}W ${o.draws}D ${o.losses}L`}>
      <span className="bar">
        <span className="w" style={{ flex: o.wins / t }} />
        <span className="d" style={{ flex: o.draws / t }} />
        <span className="l" style={{ flex: o.losses / t }} />
      </span>
      <em>{o.score}%</em>
    </div>
  );
}
