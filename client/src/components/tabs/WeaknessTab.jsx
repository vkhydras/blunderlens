import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { TimeClassSelect, Meter, GameLink, moveLabel, themeLabel, Empty, Badge } from '../Bits.jsx';
import { PIECE_NAME } from '../../../../shared/tactics.js';

export default function WeaknessTab({ username, version, onAnalyze, batch }) {
  const [tc, setTc] = useState('all');
  const { data, loading } = useAsync(() => api.insights(username, tc), [username, tc, version]);

  if (loading && !data) return <div className="muted pad">Crunching your games…</div>;
  if (!data || data.games < 3)
    return (
      <Empty>
        <h3>Analyze some games first</h3>
        <p className="muted">Weakness stats need Stockfish reviews. {data?.games ? `${data.games} analyzed so far.` : ''}</p>
        {!batch?.running && (
          <button className="btn primary" onClick={() => onAnalyze(50)}>
            Analyze my 50 newest games
          </button>
        )}
      </Empty>
    );

  const { summary, profile, focus, phases, tactics, pressure, conversion, defense, pieces, bands, colors, timeClasses } = data;
  const mistakesLink = (filter) => `#/player/${encodeURIComponent(username)}/mistakes?${new URLSearchParams(filter)}`;

  return (
    <div className="weakness">
      <div className="toolbar">
        <TimeClassSelect value={tc} onChange={setTc} />
        <span className="muted small">
          Based on {data.games} analyzed games · {summary.moves} of your moves
        </span>
      </div>

      <div className="kpis">
        <Kpi label="Avg accuracy" value={summary.acc} unit="%" />
        <Kpi label="Score" value={summary.score} unit="%" sub={`${summary.wins}W ${summary.losses}L ${summary.draws}D`} />
        <Kpi label="Blunders / game" value={summary.blundersPerGame} bad={summary.blundersPerGame >= 1} />
        <Kpi label="Mistakes / game" value={summary.mistakesPerGame} bad={summary.mistakesPerGame >= 1.5} />
        <Kpi label="Missed wins / game" value={summary.missesPerGame} />
        <Kpi label="Tactics found" value={tactics.pct} unit="%" sub={`${tactics.found}/${tactics.opportunities}`} />
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h3>Skill profile</h3>
          </div>
          {profile.map((p) => (
            <div key={p.key} className="skill" title={p.desc}>
              <span className="skill-label">{p.label}</span>
              <Meter value={p.score} />
              <span className="skill-val">{p.score ?? '—'}</span>
              <span className="skill-n muted small">n={p.n}</span>
            </div>
          ))}
          <p className="muted tiny">Hover a row for how it's measured. Moves in already-decided positions are excluded from error stats.</p>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>What to work on</h3>
          </div>
          {focus.length ? (
            focus.map((f, i) => (
              <div key={i} className={`focus focus-${f.severity}`}>
                <div className="focus-title">{f.title}</div>
                <div className="focus-detail">{f.detail}</div>
                {f.examples?.length > 0 && (
                  <div className="examples">
                    {f.examples.map((ex, j) => (
                      <GameLink key={j} ex={ex}>
                        {ex.cls && <Badge cls={ex.cls} size="xs" />} {moveLabel(ex.ply, ex.san)} <span className="muted">vs {ex.opponent}</span>
                      </GameLink>
                    ))}
                    {f.filter && (
                      <a className="game-link more" href={mistakesLink(f.filter)}>
                        all →
                      </a>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="muted">No clear weak spot yet — analyze more games for sharper results.</p>
          )}
        </section>
      </div>

      <div className="grid-3">
        <section className="panel">
          <h3>By phase</h3>
          <table className="stat-table">
            <thead>
              <tr>
                <th />
                <th>Accuracy</th>
                <th>Errors/100</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(phases).map(([k, v]) => (
                <tr key={k}>
                  <td className="cap">
                    <a href={mistakesLink({ phase: k })}>{k}</a>
                  </td>
                  <td>{v.acc ?? '—'}</td>
                  <td>{v.errorsPer100 ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="mt">Clock</h3>
          <table className="stat-table">
            <tbody>
              <tr>
                <td>Normal</td>
                <td>{pressure.normal.acc ?? '—'}%</td>
                <td>{pressure.normal.errorsPer100 ?? '—'} err/100</td>
              </tr>
              <tr>
                <td>
                  <a href={mistakesLink({ pressure: 1 })}>Low time</a>
                </td>
                <td>{pressure.low.acc ?? '—'}%</td>
                <td>{pressure.low.errorsPer100 ?? '—'} err/100</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h3>Tactics you had</h3>
          {Object.keys(tactics.byTheme).length ? (
            Object.entries(tactics.byTheme)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([t, v]) => (
                <div key={t} className="skill">
                  <span className="skill-label">{themeLabel(t)}</span>
                  <Meter value={(100 * v.found) / v.total} />
                  <span className="skill-val small">
                    {v.found}/{v.total}
                  </span>
                </div>
              ))
          ) : (
            <p className="muted small">No tactical chances detected yet.</p>
          )}
          <h3 className="mt">Tactics you allowed</h3>
          {Object.entries(tactics.allowed).length ? (
            <div className="chips">
              {Object.entries(tactics.allowed)
                .sort((a, b) => b[1] - a[1])
                .map(([t, n]) => (
                  <a key={t} className="chip" href={mistakesLink({ allowed: t })}>
                    {themeLabel(t)} <b>{n}</b>
                  </a>
                ))}
            </div>
          ) : (
            <p className="muted small">Nothing yet.</p>
          )}
        </section>

        <section className="panel">
          <h3>Results</h3>
          <table className="stat-table">
            <tbody>
              <tr>
                <td>Converted wins</td>
                <td>
                  {conversion.converted}/{conversion.chances}
                </td>
                <td>{conversion.pct ?? '—'}%</td>
              </tr>
              <tr>
                <td>Saved lost games</td>
                <td>
                  {defense.saved}/{defense.chances}
                </td>
                <td>{defense.pct ?? '—'}%</td>
              </tr>
              <tr>
                <td>As White</td>
                <td>{colors.w.games} g</td>
                <td>{colors.w.score ?? '—'}% · {colors.w.acc ?? '—'} acc</td>
              </tr>
              <tr>
                <td>As Black</td>
                <td>{colors.b.games} g</td>
                <td>{colors.b.score ?? '—'}% · {colors.b.acc ?? '—'} acc</td>
              </tr>
              {Object.entries(timeClasses).map(([k, v]) => (
                <tr key={k}>
                  <td className="cap">{k}</td>
                  <td>{v.games} g</td>
                  <td>
                    {v.score}% · {v.acc ?? '—'} acc
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h3>Errors by piece moved</h3>
          {Object.entries(pieces)
            .filter(([, v]) => v.moves)
            .map(([p, v]) => (
              <div key={p} className="skill">
                <span className="skill-label cap">
                  <a href={mistakesLink({ piece: p })}>{PIECE_NAME[p]}</a>
                </span>
                <Meter value={v.rate} max={Math.max(10, ...Object.values(pieces).map((x) => x.rate || 0))} tone="bad" />
                <span className="skill-val small">{v.rate ?? 0}</span>
                <span className="skill-n muted small">/100 moves</span>
              </div>
            ))}
        </section>
        <section className="panel">
          <h3>Against opponent strength</h3>
          <table className="stat-table">
            <thead>
              <tr>
                <th>Opponent</th>
                <th>Games</th>
                <th>Score</th>
                <th>Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {bands
                .filter((b) => b.games)
                .map((b) => (
                  <tr key={b.label}>
                    <td>{b.label}</td>
                    <td>{b.games}</td>
                    <td>{b.score}%</td>
                    <td>{b.acc ?? '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit = '', sub, bad }) {
  return (
    <div className={`kpi ${bad ? 'kpi-bad' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">
        {value ?? '—'}
        {value !== null && value !== undefined && <small>{unit}</small>}
      </div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}
