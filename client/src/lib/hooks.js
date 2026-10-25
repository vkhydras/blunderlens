import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { analyzeLive, evaluate } from './engine.js';
import { parseGame, buildReview } from '../../../shared/review.js';

// Runs `fn` whenever deps change; returns { data, error, loading }.
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}

// Streams deepening Stockfish analysis for `fen`. Returns { fen, result, finished } or null.
export function useLiveEngine(fen, { enabled = true, depth = 24, multipv = 3, delay = 100 } = {}) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    setLive(null);
    if (!enabled || !fen || new Chess(fen).isGameOver()) return;
    let off = () => {};
    const t = setTimeout(() => {
      off = analyzeLive(fen, { depth, multipv }, (result, finished) => setLive({ fen, result, finished }));
    }, delay);
    return () => {
      clearTimeout(t);
      off();
    };
  }, [fen, enabled, depth, multipv]);
  return live?.fen === fen ? live : null;
}

// Live results this deep give a first rating straight away; deeper results
// replace it, so the rating firms up while the engine keeps thinking.
export const RATE_DEPTH = 10;

// Rates a line of moves played from `startFen` (a variation off a game).
// `live` is the useLiveEngine result for the position on the board; other
// positions in the line get a quick pool evaluation, then a deeper one.
// `seed` is an already known engine result for `startFen`.
// Returns the line's review (buildReview shape) or null without moves.
export function useLineReview(startFen, moves, live, seed) {
  const [results, setResults] = useState({});
  const pending = useRef(new Set());
  useEffect(() => {
    setResults(seed && startFen ? { [startFen]: seed } : {});
    pending.current = new Set();
  }, [startFen]);

  const keep = (fen, r) => r?.lines?.length && setResults((x) => (x[fen] && x[fen].depth >= r.depth ? x : { ...x, [fen]: r }));
  useEffect(() => {
    if (live && live.result.depth >= RATE_DEPTH) keep(live.fen, { ...live.result, bestmove: live.result.lines[0]?.pv[0] });
  }, [live]);

  const fens = useMemo(() => (startFen ? [startFen, ...moves.map((m) => m.fen)] : []), [startFen, moves]);
  useEffect(() => {
    for (const f of fens) {
      if (results[f] || pending.current.has(f) || f === live?.fen || f === fens.at(-1) || new Chess(f).isGameOver()) continue;
      pending.current.add(f);
      evaluate(f, RATE_DEPTH, 3)
        .then((r) => !r?.error && keep(f, r))
        .then(() => evaluate(f, 18, 3))
        .then((r) => !r?.error && keep(f, r))
        .finally(() => pending.current.delete(f));
    }
  }, [fens, results, live?.fen]);

  return useMemo(() => {
    if (!startFen || !moves.length) return null;
    const chess = new Chess(startFen);
    for (const m of moves) chess.move(m.san);
    const game = parseGame(chess.pgn());
    return buildReview(game, game.fens.map((f) => results[f] || null));
  }, [startFen, moves, results]);
}
