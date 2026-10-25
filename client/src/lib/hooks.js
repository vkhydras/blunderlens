import { useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { analyzeLive } from './engine.js';

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
