import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { api } from '../lib/api.js';
import { evaluate } from '../lib/engine.js';
import { useLiveEngine } from '../lib/hooks.js';
import { CLASSES, ERROR_CLASSES, parseGame, positionEval, buildReview, explainMove, formatEval, uciToSan } from '../../../shared/review.js';
import BoardView, { PlayerBar } from './board/BoardView.jsx';
import EvalGraph from './board/EvalGraph.jsx';
import MoveList from './board/MoveList.jsx';
import EngineLines from './board/EngineLines.jsx';
import { Badge } from './Bits.jsx';
import { imageToFen, withTurn } from '../lib/boardImage.js';
import { positionProblem } from '../../../shared/legal.js';

const START = new Chess().fen();
// Live results this deep give a first rating straight away; deeper results
// keep replacing it, so the rating firms up while the engine thinks.
const MIN_DEPTH = 10;
const PIECE_NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen' };

// Castling rights that the piece placement still allows (king and rook at home).
function castlingFor(c) {
  const at = (sq, type, color) => c.get(sq)?.type === type && c.get(sq)?.color === color;
  return (
    [at('e1', 'k', 'w') && at('h1', 'r', 'w') && 'K', at('e1', 'k', 'w') && at('a1', 'r', 'w') && 'Q', at('e8', 'k', 'b') && at('h8', 'r', 'b') && 'k', at('e8', 'k', 'b') && at('a8', 'r', 'b') && 'q']
      .filter(Boolean)
      .join('') || '-'
  );
}

// Replays moves (uci) from a FEN, keeping the ones that are still legal.
function replay(fen, list) {
  const c = new Chess(fen);
  const out = [];
  for (const m of list) {
    let mv;
    try {
      mv = c.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
    } catch {
      break;
    }
    out.push({ san: mv.san, uci: m.uci, from: mv.from, to: mv.to, fen: c.fen() });
  }
  return out;
}

// Analysis board: play moves for both sides; every move is rated as soon as
// Stockfish has looked at the position, and the best reply is shown for
// whoever is to move.
export default function LivePage() {
  const saved = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('liveBoard')) || {};
    } catch {
      return {};
    }
  }, []);
  const [startFen, setStartFen] = useState(saved.startFen || START);
  const [moves, setMoves] = useState(saved.moves || []);
  const [ply, setPly] = useState(saved.moves?.length || 0);
  const [results, setResults] = useState({});
  const [orientation, setOrientation] = useState('white');
  const [autoFlip, setAutoFlip] = useState(false);
  const [showBest, setShowBest] = useState(true);
  const [fenInput, setFenInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [reading, setReading] = useState(false);
  const [fromImage, setFromImage] = useState(null); // FEN read from a pasted screenshot
  const [retracting, setRetracting] = useState(false); // dragging pieces back in time
  const [uncapture, setUncapture] = useState(null); // piece type to put back on the vacated square
  const [retracted, setRetracted] = useState(0);
  const pending = useRef(new Set());

  useEffect(() => {
    try {
      localStorage.setItem('liveBoard', JSON.stringify({ startFen, moves }));
    } catch {}
  }, [startFen, moves]);

  const fens = useMemo(() => [startFen, ...moves.map((m) => m.fen)], [startFen, moves]);
  const fen = fens[ply];

  // Deepening analysis of the current position; feeds the classification too.
  const live = useLiveEngine(fen, { depth: 26, delay: 30 });
  useEffect(() => {
    if (!live || live.result.depth < MIN_DEPTH || live.result.lines.length < 1) return;
    setResults((r) => (r[live.fen] && r[live.fen].depth >= live.result.depth ? r : { ...r, [live.fen]: { ...live.result, bestmove: live.result.lines[0].pv[0] } }));
  }, [live]);

  // Any earlier position without an eval (e.g. moves made quickly, or taken
  // back) gets one from the pool: a quick pass for an instant rating, then a
  // deeper one that replaces it.
  useEffect(() => {
    const keep = (f) => (r) => r && !r.error && setResults((x) => (x[f] && x[f].depth >= r.depth ? x : { ...x, [f]: r }));
    fens.slice(0, ply + 1).forEach((f) => {
      if (results[f] || pending.current.has(f) || f === fen || new Chess(f).isGameOver()) return;
      pending.current.add(f);
      evaluate(f, MIN_DEPTH, 3)
        .then(keep(f))
        .then(() => evaluate(f, 18, 3, 1)) // deeper pass, behind quick ratings
        .then(keep(f))
        .finally(() => pending.current.delete(f));
    });
  }, [fens, ply, results, fen]);

  const game = useMemo(() => {
    const chess = new Chess(startFen);
    for (const m of moves) chess.move(m.san);
    return parseGame(chess.pgn());
  }, [startFen, moves]);
  const review = useMemo(() => buildReview(game, game.fens.map((f) => results[f] || null)), [game, results]);
  const evals = useMemo(() => game.fens.map((f) => positionEval(f, results[f])), [game, results]);

  const m = ply ? review.moves[ply - 1] : null;
  const chess = new Chess(fen);
  const turn = chess.turn();
  const liveEval = live?.result.lines.length ? positionEval(fen, live.result) : evals[ply];

  const play = (uci) => {
    const c = new Chess(fen);
    let mv;
    try {
      mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      return false;
    }
    const entry = { san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), from: mv.from, to: mv.to, fen: c.fen() };
    if (moves[ply]?.uci === entry.uci) setPly(ply + 1);
    else {
      setMoves([...moves.slice(0, ply), entry]);
      setPly(ply + 1);
    }
    if (autoFlip) setOrientation((o) => (o === 'white' ? 'black' : 'white'));
    return true;
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') setPly((p) => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setPly((p) => Math.min(moves.length, p + 1));
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [moves.length]);

  const load = (text = fenInput.trim(), { keep = false } = {}) => {
    setInputError('');
    try {
      if (/^[rnbqkpRNBQKP1-8/]+ [wb] /.test(text)) {
        const problem = positionProblem(text);
        if (problem) {
          setInputError(`Can't analyse this position: ${problem}. Fix it and press Load.`);
          return false;
        }
        setStartFen(text);
        setMoves([]);
        setPly(0);
      } else {
        const c = new Chess();
        c.loadPgn(text);
        const hist = c.history({ verbose: true });
        setStartFen(hist[0]?.before || c.fen());
        setMoves(hist.map((h) => ({ san: h.san, uci: h.from + h.to + (h.promotion || ''), from: h.from, to: h.to, fen: h.after })));
        setPly(hist.length);
      }
      if (!keep) {
        setFenInput('');
        setFromImage(null);
      }
      return true;
    } catch (e) {
      setInputError(keep ? 'Read the board, but the position is not legal. Fix the FEN in the box and press Load.' : 'Not a valid FEN or PGN.');
      return false;
    }
  };

  // Paste a screenshot (Ctrl+V anywhere on this page): read the board from it.
  useEffect(() => {
    const onPaste = async (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      setInputError('');
      setReading(true);
      try {
        let { fen: read, flipped } = await imageToFen(item.getAsFile());
        // A screenshot doesn't say whose turn it is: if one king is in check,
        // that side must be to move; otherwise the side at the bottom.
        const bottom = flipped ? 'b' : 'w';
        read = withTurn(read, bottom);
        if (positionProblem(read)) read = withTurn(read, bottom === 'w' ? 'b' : 'w');
        setRetracted(0);
        setFenInput(read);
        setFromImage(read);
        setOrientation(flipped ? 'black' : 'white');
        load(read, { keep: true });
      } catch (err) {
        setInputError(err.message);
      } finally {
        setReading(false);
      }
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, []);
  const setTurn = (turn) => {
    const next = withTurn(startFen, turn).replace(/ (\S+) (\d+) (\d+)$/, ' - $2 $3');
    const problem = positionProblem(next);
    if (problem) return setInputError(`${problem}.`);
    setInputError('');
    if (fromImage) {
      setFromImage(next);
      setFenInput(next);
    }
    setStartFen(next);
    setMoves([]);
    setPly(0);
  };

  // Take back a move: the piece on `from` goes back to `to`, optionally with a
  // captured piece reappearing on `from`. The taken-back move becomes the first
  // move of the line so it gets rated like any other.
  const retract = (uci) => {
    const from = uci.slice(0, 2), to = uci.slice(2, 4);
    const now = new Chess(startFen);
    const piece = now.get(from);
    if (!piece || piece.color === now.turn()) return false;
    if (piece.type === 'p' && (to[1] === (piece.color === 'w' ? '1' : '8') || (uncapture && to[0] === from[0]) || (!uncapture && to[0] !== from[0]))) {
      setInputError(uncapture ? 'A pawn captures diagonally.' : 'A pawn moves straight unless it captured; pick the captured piece first.');
      return false;
    }
    const before = new Chess(startFen);
    before.remove(from);
    before.put(piece, to);
    if (uncapture) before.put({ type: uncapture, color: piece.color === 'w' ? 'b' : 'w' }, from);
    const [placement, , , , , full] = before.fen().split(' ');
    // The move number only goes up after Black's move.
    const preFen = `${placement} ${piece.color} ${castlingFor(before)} - 0 ${piece.color === 'b' ? Math.max(1, Number(full) - 1) : full}`;
    const problem = positionProblem(preFen);
    if (problem) {
      setInputError(`That doesn't give a legal earlier position: ${problem}.`);
      return false;
    }
    const [first] = replay(preFen, [{ uci: to + from }]);
    if (!first) {
      setInputError(`${PIECE_NAMES[piece.type] || 'King'} can't move ${to}→${from}.`);
      return false;
    }
    setInputError('');
    setStartFen(preFen);
    setMoves([first, ...replay(first.fen, moves)]);
    setPly(0);
    setRetracted((n) => n + 1);
    setUncapture(null);
    return true;
  };
  const toggleRetract = () => {
    if (retracting) {
      setRetracting(false);
      setPly(Math.min(moves.length, retracted));
    } else {
      setRetracting(true);
      setRetracted(0);
      setUncapture(null);
      setPly(0);
    }
  };
  const reset = () => {
    setRetracting(false);
    setStartFen(START);
    setMoves([]);
    setPly(0);
  };
  const openReview = async () => {
    const { uuid } = await api.importPgn(pgnOf(startFen, moves));
    location.hash = `#/game/${uuid}`;
  };

  const arrows = [];
  const top = live?.result.lines[0]?.pv[0];
  if (showBest && top) arrows.push({ startSquare: top.slice(0, 2), endSquare: top.slice(2, 4), color: 'rgba(242,169,59,0.9)' });
  if (m?.best && ERROR_CLASSES.has(m.cls)) arrows.push({ startSquare: m.best.slice(0, 2), endSquare: m.best.slice(2, 4), color: 'rgba(52,211,153,0.7)' });

  const side = (c) => (c === 'w' ? 'White' : 'Black');
  const bar = (c) => (
    <PlayerBar name={side(c)} color={c} active={turn === c} extra={review.accuracy[c] != null && <span className="pacc">{review.accuracy[c]}</span>} />
  );
  const ex = m?.cls ? explainMove(m) : null;
  const bestSan = top ? uciToSan(fen, top) : null;

  return (
    <div className="review-layout live-layout">
      <aside className="col col-left">
        <section className="panel-tight">
          <h4>Live board</h4>
          <p className="muted small">Make moves for both sides. Each move is rated as soon as Stockfish has searched the new position, and the orange arrow shows the best move for the side to move.</p>
          <div className="stack">
            <label className="check small">
              <input type="checkbox" checked={showBest} onChange={(e) => setShowBest(e.target.checked)} /> Show best move for side to move
            </label>
            <label className="check small">
              <input type="checkbox" checked={autoFlip} onChange={(e) => setAutoFlip(e.target.checked)} /> Flip board after each move
            </label>
          </div>
        </section>
        <section className="panel-tight">
          <EvalGraph evals={evals} moves={review.moves} ply={ply} onSelect={(p) => setPly(Math.min(p, moves.length))} />
          <table className="counts compact">
            <tbody>
              {['brilliant', 'great', 'best', 'inaccuracy', 'mistake', 'miss', 'blunder'].map((k) => (
                <tr key={k} className={!review.counts.w[k] && !review.counts.b[k] ? 'zero' : ''}>
                  <td className="cnt">{review.counts.w[k] || 0}</td>
                  <td className="cls-name">
                    <Badge cls={k} size="sm" /> <span style={{ color: CLASSES[k].color }}>{CLASSES[k].label}</span>
                  </td>
                  <td className="cnt">{review.counts.b[k] || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="panel-tight">
          <h4>Start from position</h4>
          <textarea rows={3} placeholder="Paste a FEN, PGN or a screenshot of a board…" value={fenInput} onChange={(e) => setFenInput(e.target.value)} />
          {reading && <div className="muted small">Reading the board…</div>}
          {inputError && <div className="error small">{inputError}</div>}
          {!moves.length && !retracting && (
            <div className="btn-row">
              <span className="muted small">To move:</span>
              {['w', 'b'].map((t) => (
                <button key={t} className={`btn sm ${startFen.split(' ')[1] === t ? '' : 'ghost'}`} onClick={() => setTurn(t)}>
                  {t === 'w' ? 'White' : 'Black'}
                </button>
              ))}
            </div>
          )}
          {retracting && (
            <div className="retract-box">
              <div className="small">
                Drag a {startFen.split(' ')[1] === 'w' ? 'black' : 'white'} piece back to the square it came from.
                {retracted > 0 && ` ${retracted} move${retracted > 1 ? 's' : ''} taken back.`}
              </div>
              <div className="btn-row">
                <span className="muted small">It captured:</span>
                {[null, 'p', 'n', 'b', 'r', 'q'].map((t) => (
                  <button key={t || 'none'} className={`btn sm ${uncapture === t ? '' : 'ghost'}`} onClick={() => setUncapture(t)}>
                    {t ? PIECE_NAMES[t] : 'Nothing'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="btn-row">
            <button className="btn sm" disabled={!fenInput.trim()} onClick={() => load()}>
              Load
            </button>
            <button className={`btn sm ${retracting ? '' : 'ghost'}`} disabled={!retracting && ply > 0} onClick={toggleRetract} title="Go back from this position by moving pieces back">
              {retracting ? 'Done' : 'Take back a move'}
            </button>
            <button className="btn sm ghost" disabled={!moves.length} onClick={openReview}>
              Full review ›
            </button>
          </div>
        </section>
      </aside>

      <section className="col col-center">
        <BoardView
          fen={fen}
          orientation={orientation}
          arrows={arrows}
          lastMove={ply ? moves[ply - 1] : null}
          cls={m?.cls}
          evaluation={liveEval}
          onMove={retracting ? retract : play}
          retract={retracting}
          top={bar(orientation === 'white' ? 'b' : 'w')}
          bottom={bar(orientation === 'white' ? 'w' : 'b')}
        />
        <div className="nav">
          <button className="btn icon" onClick={() => setPly(0)}>
            ⏮
          </button>
          <button className="btn icon" onClick={() => setPly(Math.max(0, ply - 1))}>
            ‹
          </button>
          <button className="btn icon" onClick={() => setPly(Math.min(moves.length, ply + 1))}>
            ›
          </button>
          <button className="btn icon" onClick={() => setPly(moves.length)}>
            ⏭
          </button>
        </div>
        <EngineLines fen={fen} live={live} onPlay={play} />
      </section>

      <aside className="col col-right">
        <div className="btn-row live-controls">
          <button className="btn sm" onClick={() => ply && (setMoves(moves.slice(0, ply - 1)), setPly(ply - 1))}>
            Undo
          </button>
          <button className="btn sm" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            Flip
          </button>
          <button className="btn sm ghost" onClick={reset}>
            New game
          </button>
        </div>
        <section className="panel-tight move-card" style={m?.cls ? { '--c': CLASSES[m.cls].color } : undefined}>
          {m ? (
            m.cls ? (
              <>
                <div className="mc-head">
                  <Badge cls={m.cls} size="lg" />
                  <div>
                    <div className="mc-title">
                      {side(m.color)}: {ex.title}
                    </div>
                    <div className="muted small">eval {formatEval(evals[ply])}</div>
                  </div>
                </div>
                {ex.lines.map((l, i) => (
                  <div key={i} className="mc-text">
                    {l}
                  </div>
                ))}
                {ex.advice && <div className="mc-advice">{ex.advice}</div>}
              </>
            ) : (
              <div className="muted">Rating {m.san}…</div>
            )
          ) : (
            <div className="muted">Make a move to start.</div>
          )}
          {!chess.isGameOver() && (
            <div className="next-best">
              <span className="muted small">Best for {side(turn)} now</span>
              <b>{bestSan ? `${bestSan}  ${formatEval(liveEval)}` : '…'}</b>
            </div>
          )}
          {chess.isGameOver() && <div className="next-best">{chess.isCheckmate() ? `Checkmate — ${side(turn === 'w' ? 'b' : 'w')} wins` : 'Draw'}</div>}
        </section>
        <section className="panel-tight moves-panel">
          <MoveList
            moves={moves.map((mv, i) => ({ san: mv.san, cls: review.moves[i]?.cls }))}
            ply={ply}
            onSelect={setPly}
            startMove={Number(startFen.split(' ')[5])}
            blackFirst={startFen.split(' ')[1] === 'b'}
          />
        </section>
      </aside>
    </div>
  );
}

function pgnOf(startFen, moves) {
  const c = new Chess(startFen);
  for (const m of moves) c.move(m.san);
  c.setHeader('Event', 'Live board');
  c.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
  return c.pgn();
}
