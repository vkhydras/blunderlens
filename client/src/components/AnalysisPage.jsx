import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { api } from '../lib/api.js';
import { requestReview, evaluate } from '../lib/engine.js';
import { useLiveEngine, useLineReview } from '../lib/hooks.js';
import { CLASSES, ERROR_CLASSES, parseGame, positionEval, buildReview, explainMove, winPct, formatEval } from '../../../shared/review.js';
import BoardView, { PlayerBar } from './board/BoardView.jsx';
import EvalGraph from './board/EvalGraph.jsx';
import MoveList, { fmtClock } from './board/MoveList.jsx';
import EngineLines from './board/EngineLines.jsx';
import { Badge, moveLabel, NewestGameButton } from './Bits.jsx';

const DEPTHS = [12, 16, 20, 24];
const SUMMARY = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const KEY = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder']);

export default function AnalysisPage({ uuid, initialPly }) {
  const [row, setRow] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.game(uuid).then(setRow).catch((e) => setError(e.message));
  }, [uuid]);
  if (error) return <div className="center-msg error">{error}</div>;
  if (!row) return <div className="center-msg muted">Loading game…</div>;
  return <Review row={row} initialPly={initialPly} />;
}

function Review({ row, initialPly }) {
  const meta = row.game;
  const game = useMemo(() => parseGame(meta.pgn), [meta.pgn]);
  const N = game.moves.length;
  const me = (localStorage.getItem('lastUsername') || '').toLowerCase();

  const [results, setResults] = useState(() => row.analysis?.results || new Array(game.fens.length).fill(null));
  const [review, setReview] = useState(row.analysis?.review || null);
  const [depth, setDepth] = useState(row.analysis?.depth || 16);
  const [running, setRunning] = useState(!row.analysis);
  const [engineError, setEngineError] = useState('');
  const [ply, setPly] = useState(() => (initialPly !== null && initialPly !== undefined ? Math.min(initialPly, N) : 0));
  const [variation, setVariation] = useState(null);
  const [retry, setRetry] = useState(null);
  const [orientation, setOrientation] = useState(meta.black_l === me ? 'black' : 'white');
  const [arrows, setArrows] = useState(true);

  const run = useCallback(
    (d, force = false) => {
      setRunning(true);
      setEngineError('');
      if (force) setReview(null);
      return requestReview(meta.uuid, { depth: d, force }, {
        onProgress: ({ index, result }) =>
          setResults((prev) => {
            const next = prev.slice();
            next[index] = result;
            return next;
          }),
        onDone: (msg) => {
          setResults(msg.results);
          setReview(msg.review);
          setDepth(msg.depth || d);
          setRunning(false);
        },
        onError: (e) => {
          setEngineError(e.message);
          setRunning(false);
        },
      });
    },
    [meta.uuid],
  );
  const cancelRef = useRef(null);
  useEffect(() => {
    if (!row.analysis) cancelRef.current = run(16);
    return () => cancelRef.current?.();
  }, []);

  // While the engine is still working, build a provisional review in the
  // browser (throttled — it runs tactic detection over the whole game).
  const [provisional, setProvisional] = useState(null);
  useEffect(() => {
    if (review) return;
    const t = setTimeout(() => setProvisional(buildReview(game, results)), 350);
    return () => clearTimeout(t);
  }, [results, review, game]);
  const rv = review || provisional;
  const evals = useMemo(() => game.fens.map((f, i) => positionEval(f, results[i])), [game, results]);
  const progress = results.filter(Boolean).length / game.fens.length;

  // ---- current position ----
  const inVar = !!variation?.moves.length;
  const retrying = !!retry;
  const fen = retrying ? game.fens[retry.ply - 1] : inVar ? variation.moves.at(-1).fen : game.fens[ply];
  const lastMove = retrying ? (retry.ply > 1 ? game.moves[retry.ply - 2] : null) : inVar ? variation.moves.at(-1) : ply ? game.moves[ply - 1] : null;
  const m = !inVar && !retrying && ply ? rv?.moves[ply - 1] : null;
  const live = useLiveEngine(fen, { enabled: !retrying });
  // Moves you play yourself are rated too, from the game position they branch off.
  const varReview = useLineReview(inVar ? game.fens[variation.base] : null, variation?.moves || [], live, results[variation?.base]);
  const vm = inVar ? varReview?.moves.at(-1) : null;
  const liveEval = live?.result.lines.length ? positionEval(fen, live.result) : null;
  const shownEval = inVar ? liveEval : evals[ply] && (!liveEval || (evals[ply].depth || 0) >= (live?.result.depth || 0)) ? evals[ply] : liveEval;

  // ---- navigation ----
  const goTo = useCallback((p) => {
    setVariation(null);
    setRetry(null);
    setPly(Math.max(0, Math.min(N, p)));
  }, [N]);
  const back = () => {
    if (retrying) return setRetry(null);
    if (inVar) {
      const moves = variation.moves.slice(0, -1);
      return setVariation(moves.length ? { ...variation, moves } : null);
    }
    goTo(ply - 1);
  };
  const forward = () => !inVar && !retrying && goTo(ply + 1);
  const jumpKey = (dir) => {
    for (let p = ply + dir; p >= 1 && p <= N; p += dir) if (KEY.has(rv?.moves[p - 1]?.cls)) return goTo(p);
  };
  const keys = useRef({});
  keys.current = { back, forward, goTo, N };
  useEffect(() => {
    const onKey = (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      const k = keys.current;
      if (e.key === 'ArrowLeft') k.back();
      else if (e.key === 'ArrowRight') k.forward();
      else if (e.key === 'ArrowUp' || e.key === 'Home') k.goTo(0);
      else if (e.key === 'ArrowDown' || e.key === 'End') k.goTo(k.N);
      else if (e.key === 'f') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // ---- moves on the board: variations and retries ----
  const tryMove = (uci) => {
    const chess = new Chess(fen);
    let mv;
    try {
      mv = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false;
    }
    const full = mv.from + mv.to + (mv.promotion || '');
    if (retrying) {
      checkRetry(full, mv.san, chess.fen());
      return true;
    }
    if (!inVar && ply < N && game.moves[ply].uci === full) {
      setPly(ply + 1);
      return true;
    }
    const entry = { san: mv.san, uci: full, fen: chess.fen(), from: mv.from, to: mv.to };
    setVariation((v) => (v?.moves.length ? { ...v, moves: [...v.moves, entry] } : { base: ply, moves: [entry] }));
    return true;
  };

  async function checkRetry(uci, san, fenAfter) {
    const target = rv.moves[retry.ply - 1];
    const before = evals[retry.ply - 1];
    const pov = (e) => (target.color === 'w' ? winPct(e) : 100 - winPct(e));
    if (uci === target.uci) return setRetry({ ...retry, status: 'same', san });
    let wp;
    const known = before?.lines.find((l) => l.pv[0] === uci);
    if (known) wp = pov(known);
    else {
      setRetry({ ...retry, status: 'checking', san });
      const r = positionEval(fenAfter, await evaluate(fenAfter, 18));
      wp = pov(r);
    }
    const loss = Math.max(0, pov(before) - wp);
    setRetry((cur) => cur && { ...cur, status: loss <= 3 ? 'right' : 'wrong', san, loss, tries: (cur.tries || 0) + 1 });
  }

  // ---- decorations ----
  const arrowList = [];
  if (arrows && !retrying) {
    if (m?.best && ERROR_CLASSES.has(m.cls)) arrowList.push({ startSquare: m.best.slice(0, 2), endSquare: m.best.slice(2, 4), color: 'rgba(52,211,153,0.85)' });
    const top = live?.result.lines[0]?.pv[0];
    if (top && (inVar || !m || !ERROR_CLASSES.has(m.cls))) arrowList.push({ startSquare: top.slice(0, 2), endSquare: top.slice(2, 4), color: 'rgba(242,169,59,0.85)' });
  }

  const players = {
    w: { name: meta.white, rating: meta.white_rating, color: 'w' },
    b: { name: meta.black, rating: meta.black_rating, color: 'b' },
  };
  const clockAt = (c) => {
    for (let i = Math.min(ply, N) - 1; i >= 0; i--) if (game.moves[i].color === c && game.moves[i].clock) return game.moves[i].clock;
    return game.base ? `${Math.floor(game.base / 60)}:${String(game.base % 60).padStart(2, '0')}` : null;
  };
  const turn = new Chess(fen).turn();
  const topC = orientation === 'white' ? 'b' : 'w';
  const botC = topC === 'w' ? 'b' : 'w';
  const bar = (c) => <PlayerBar {...players[c]} clock={clockAt(c)} active={turn === c} extra={rv?.accuracy[c] != null && <span className="pacc">{rv.accuracy[c]}</span>} />;

  const listMoves = game.moves.map((mv, i) => ({ san: mv.san, cls: rv?.moves[i]?.cls, clock: rv?.moves[i]?.clock }));

  return (
    <div className="review-layout">
      {/* ---------- left: summary ---------- */}
      <aside className="col col-left">
        <NewestGameButton username={me} current={meta.uuid} className="btn sm primary newest-btn" />
        <section className="panel-tight">
          <div className="acc-pair">
            {['w', 'b'].map((c) => (
              <div key={c} className={`acc acc-${c}`}>
                <span className="acc-name">{players[c].name}</span>
                <span className="acc-val">{rv?.accuracy[c] ?? '—'}</span>
                <span className="acc-sub">
                  {meta.accuracies?.[c === 'w' ? 'white' : 'black'] ? `chess.com ${meta.accuracies[c === 'w' ? 'white' : 'black'].toFixed(1)}` : 'accuracy'}
                </span>
              </div>
            ))}
          </div>
          {rv && (
            <div className="phase-row">
              {['opening', 'middlegame', 'endgame'].map((p) => (
                <div key={p}>
                  <span className="muted tiny cap">{p}</span>
                  <span>
                    {rv.phaseAcc.w[p] ?? '–'} <span className="muted">/</span> {rv.phaseAcc.b[p] ?? '–'}
                  </span>
                </div>
              ))}
            </div>
          )}
          {running || progress < 1 ? (
            <div className="progress">
              <div className="bar" style={{ width: `${(progress * 100).toFixed(0)}%` }} />
              <span>{progress < 1 ? `Stockfish ${(progress * 100).toFixed(0)}%` : 'Deep pass on key moves…'}</span>
            </div>
          ) : null}
          {engineError && <div className="error small">{engineError}</div>}
          <EvalGraph evals={evals} moves={rv?.moves || []} ply={ply} onSelect={goTo} />
        </section>

        <section className="panel-tight">
          <table className="counts">
            <tbody>
              {SUMMARY.map((k) => (
                <tr key={k} className={!rv?.counts.w[k] && !rv?.counts.b[k] ? 'zero' : ''}>
                  <td className="cnt">{rv?.counts.w[k] || 0}</td>
                  <td className="cls-name">
                    <Badge cls={k} size="sm" /> <span style={{ color: CLASSES[k].color }}>{CLASSES[k].label}</span>
                  </td>
                  <td className="cnt">{rv?.counts.b[k] || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {rv?.critical?.length > 0 && (
          <section className="panel-tight">
            <h4>Critical moments</h4>
            <div className="critical">
              {rv.critical.map((p) => {
                const cm = rv.moves[p - 1];
                return (
                  <button key={p} className={`crit ${ply === p ? 'on' : ''}`} onClick={() => goTo(p)}>
                    <Badge cls={cm.cls} size="xs" /> {moveLabel(p, cm.san)} <span className="muted">−{Math.round(cm.loss)}%</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="panel-tight small">
          {rv?.opening?.name && (
            <div className="opening">
              <b>{rv.opening.eco}</b> {rv.opening.name}
            </div>
          )}
          {rv?.opening?.deviation && (
            <div className="muted">
              Theory ends at {moveLabel(rv.opening.deviation.ply + 1, rv.opening.deviation.san)}
              {rv.opening.deviation.book.length ? ` (book: ${rv.opening.deviation.book.join(', ')})` : ''}
            </div>
          )}
          <div className="depth-row">
            <span className="muted">Depth {depth}</span>
            <select value="" onChange={(e) => e.target.value && (cancelRef.current = run(Number(e.target.value), true))} disabled={running}>
              <option value="">Re-analyze…</option>
              {DEPTHS.map((d) => (
                <option key={d} value={d}>
                  depth {d}
                </option>
              ))}
            </select>
            {meta.url && (
              <a href={meta.url} target="_blank" rel="noreferrer">
                chess.com ↗
              </a>
            )}
          </div>
        </section>
      </aside>

      {/* ---------- center: board ---------- */}
      <section className="col col-center">
        <BoardView
          fen={fen}
          orientation={orientation}
          arrows={arrowList}
          lastMove={lastMove}
          cls={inVar ? vm?.cls : m?.cls}
          evaluation={shownEval}
          hideEval={retrying}
          onMove={tryMove}
          top={bar(topC)}
          bottom={bar(botC)}
        />
        <div className="nav">
          <button className="btn icon" onClick={() => goTo(0)} title="Start (↑)">
            ⏮
          </button>
          <button className="btn icon" onClick={back} title="Back (←)">
            ‹
          </button>
          <button className="btn icon" onClick={forward} title="Forward (→)">
            ›
          </button>
          <button className="btn icon" onClick={() => goTo(N)} title="End (↓)">
            ⏭
          </button>
          {inVar && (
            <button className="btn sm primary" onClick={() => setVariation(null)} title="Leave your line and return to the game as it was played">
              ↩ Back to game
            </button>
          )}
          <span className="nav-sep" />
          <button className="btn sm" onClick={() => jumpKey(-1)}>
            ‹ key move
          </button>
          <button className="btn sm" onClick={() => jumpKey(1)}>
            key move ›
          </button>
          <span className="nav-sep" />
          <button className="btn icon" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))} title="Flip (f)">
            ⇅
          </button>
          <label className="check small">
            <input type="checkbox" checked={arrows} onChange={(e) => setArrows(e.target.checked)} /> arrows
          </label>
        </div>
        <EngineLines fen={fen} live={live} onPlay={tryMove} hidden={retrying} />
      </section>

      {/* ---------- right: current move + moves ---------- */}
      <aside className="col col-right">
        <MoveCard m={m} vm={vm} ply={ply} inVar={inVar} variation={variation} retry={retry} setRetry={setRetry} exitVar={() => setVariation(null)} game={game} />
        <section className="panel-tight moves-panel">
          <MoveList moves={listMoves} ply={inVar || retrying ? -1 : ply} onSelect={goTo} startMove={Number(game.fens[0].split(' ')[5])} blackFirst={game.moves[0]?.color === 'b'} result={game.headers.Result} />
        </section>
      </aside>
    </div>
  );
}

function MoveCard({ m, vm, ply, inVar, variation, retry, setRetry, exitVar, game }) {
  if (retry) {
    const target = game.moves[retry.ply - 1];
    const msg = {
      undefined: `Find a better move than ${target.san}.`,
      checking: `Checking ${retry.san}…`,
      same: `${retry.san} is the move you played. Try something else.`,
      right: `${retry.san} works! ${retry.loss > 0.5 ? `(within ${retry.loss.toFixed(1)}% of best)` : 'That is the best move.'}`,
      wrong: `${retry.san} isn't it — it gives up ${Math.round(retry.loss)}% win chance. Try again.`,
    }[retry.status];
    return (
      <section className={`panel-tight move-card retry retry-${retry.status || 'idle'}`}>
        <div className="mc-title">Retry {moveLabel(retry.ply, '')}</div>
        <div className="mc-text">{msg}</div>
        <div className="mc-actions">
          {retry.status === 'right' ? null : (
            <button className="btn sm" onClick={() => setRetry(null)}>
              Show answer
            </button>
          )}
          <button className="btn sm ghost" onClick={() => setRetry(null)}>
            Back to game
          </button>
        </div>
      </section>
    );
  }
  if (inVar) {
    const ex = vm?.cls ? explainMove(vm) : null;
    return (
      <section className="panel-tight move-card" style={vm?.cls ? { '--c': CLASSES[vm.cls].color } : undefined}>
        {ex ? (
          <div className="mc-head">
            <Badge cls={vm.cls} size="lg" />
            <div>
              <div className="mc-title">{ex.title}</div>
              {vm.wpAfter !== undefined && <div className="muted small">win chance {Math.round(vm.color === 'w' ? vm.wpAfter : 100 - vm.wpAfter)}% for White</div>}
            </div>
          </div>
        ) : (
          <div className="mc-title">Rating {variation.moves.at(-1).san}…</div>
        )}
        {ex?.lines.map((l, i) => (
          <div key={i} className="mc-text">
            {l}
          </div>
        ))}
        <div className="mc-text muted small">
          Your line from move {Math.floor(variation.base / 2) + Number(game.fens[0].split(' ')[5])}: {variation.moves.map((x) => x.san).join(' ')}
        </div>
        <div className="mc-actions">
          <button className="btn sm primary" onClick={exitVar}>
            ↩ Back to game
          </button>
        </div>
      </section>
    );
  }
  if (!ply) return <section className="panel-tight move-card muted">Starting position. Use ← → or click a move. Drag pieces to explore your own lines.</section>;
  if (!m?.cls) return <section className="panel-tight move-card muted">Analyzing this move…</section>;
  const ex = explainMove(m);
  return (
    <section className="panel-tight move-card" style={{ '--c': CLASSES[m.cls].color }}>
      <div className="mc-head">
        <Badge cls={m.cls} size="lg" />
        <div>
          <div className="mc-title">{ex.title}</div>
          <div className="muted small">
            {m.wpAfter !== undefined && `win chance ${Math.round(m.color === 'w' ? m.wpAfter : 100 - m.wpAfter)}% for White`}
            {m.clock !== null && m.clock !== undefined && ` · ${fmtClock(m.clock)} left`}
          </div>
        </div>
      </div>
      {ex.lines.map((l, i) => (
        <div key={i} className="mc-text">
          {l}
        </div>
      ))}
      {ex.advice && <div className="mc-advice">{ex.advice}</div>}
      {ERROR_CLASSES.has(m.cls) && (
        <div className="mc-actions">
          <button className="btn sm primary" onClick={() => setRetry({ ply })}>
            Retry this move
          </button>
        </div>
      )}
    </section>
  );
}
