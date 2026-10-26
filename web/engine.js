// Browser version of client/src/lib/engine.js (and of the server's engine pool
// and analyzer): Stockfish 19 lite runs as single-threaded WASM, one engine
// per Web Worker, several workers in parallel. Same exports and callbacks as
// the WebSocket client, so the review page works unchanged.
import { parseGame, buildReview, REVIEW_VERSION, ERROR_CLASSES } from '../shared/review.js';
import { games, analyses } from './store.js';
import { track } from './analytics.js';

const ENGINE_URL = '/stockfish/stockfish-19-lite-single.js';
const PV_KEEP = 12;

// ---------- one engine ----------

class WasmEngine {
  constructor() {
    this.busy = false;
    this.listeners = new Set();
  }

  async init() {
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e) => {
      for (const line of String(e.data).split('\n')) if (line.trim()) this.listeners.forEach((fn) => fn(line.trim()));
    };
    const onId = (l) => l.startsWith('id name ') && (this.name = l.slice(8));
    this.listeners.add(onId);
    this.send('uci');
    await this.waitFor((l) => l === 'uciok');
    this.listeners.delete(onId);
    this.send('setoption name Hash value 32');
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
    return this;
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(match) {
    return new Promise((resolve) => {
      const fn = (l) => match(l) && (this.listeners.delete(fn), resolve(l));
      this.listeners.add(fn);
    });
  }

  // Searches `fen` and resolves with lines scored from White's point of view.
  async analyze(fen, { depth = 16, multipv = 1, onInfo } = {}) {
    this.busy = true;
    const whiteToMove = fen.split(' ')[1] === 'w';
    const lines = new Map();
    let lastDepth = 0;
    const onLine = (line) => {
      if (!line.startsWith('info ') || !line.includes(' pv ')) return;
      const info = parseInfo(line, whiteToMove);
      if (!info) return;
      if (info.multipv === 1 && info.depth > lastDepth && lines.size && onInfo) onInfo(snapshot(lines, lastDepth));
      if (info.multipv === 1) lastDepth = info.depth;
      lines.set(info.multipv, info);
    };
    this.listeners.add(onLine);
    this.send(`setoption name MultiPV value ${multipv}`);
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
    const done = await this.waitFor((l) => l.startsWith('bestmove'));
    this.listeners.delete(onLine);
    this.busy = false;
    const bestmove = done.split(' ')[1];
    const result = snapshot(lines, lastDepth);
    result.bestmove = bestmove === '(none)' ? null : bestmove;
    return result;
  }

  stop() {
    this.send('stop');
  }
}

function snapshot(lines, depth) {
  const sorted = [...lines.values()]
    .filter((l) => l.multipv <= lines.size)
    .sort((a, b) => a.multipv - b.multipv)
    .map(({ cp, mate, pv, depth }) => ({ cp, mate, pv, depth }));
  return { depth, lines: sorted };
}

function parseInfo(line, whiteToMove) {
  const t = line.split(' ');
  if (t.includes('lowerbound') || t.includes('upperbound')) return null;
  const at = (k) => t.indexOf(k);
  const sign = whiteToMove ? 1 : -1;
  const info = { depth: Number(t[at('depth') + 1]), multipv: at('multipv') >= 0 ? Number(t[at('multipv') + 1]) : 1, cp: null, mate: null, pv: t.slice(at('pv') + 1) };
  const s = at('score');
  if (s < 0) return null;
  if (t[s + 1] === 'cp') info.cp = sign * Number(t[s + 2]);
  else info.mate = sign * Number(t[s + 2]);
  return info;
}

// ---------- pool with interactive/batch priority ----------

const POOL_SIZE = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
const queues = [[], []];
const memo = new Map();
let engines = null;
let engineName = 'Stockfish';

function pool() {
  engines ??= Promise.all(Array.from({ length: POOL_SIZE }, () => new WasmEngine().init())).then((es) => {
    engineName = es[0].name || engineName;
    return es;
  });
  return engines;
}

function poolEvaluate(fen, { depth, multipv = 1, priority = 0, job = null }) {
  const key = `${fen}|${depth}|${multipv}`;
  if (memo.has(key)) return Promise.resolve(memo.get(key));
  return new Promise((resolve) => {
    queues[priority].push({ fen, depth, multipv, job, resolve, key });
    pump();
  });
}

async function pump() {
  for (const engine of await pool()) {
    if (engine.busy) continue;
    const task = next();
    if (!task) return;
    engine.busy = true;
    engine.analyze(task.fen, { depth: task.depth, multipv: task.multipv }).then((r) => {
      r.lines = r.lines.map((l) => ({ ...l, pv: l.pv.slice(0, PV_KEEP) }));
      if (memo.size > 20000) memo.delete(memo.keys().next().value);
      memo.set(task.key, r);
      task.resolve(r);
      pump();
    });
  }
}

function next() {
  for (const queue of queues) {
    let task;
    while ((task = queue.shift())) {
      if (!task.job?.cancelled) return task;
      task.resolve(null);
    }
  }
  return null;
}

// ---------- game analysis (same two passes as server/analyzer.js) ----------

async function evaluateAll(fens, idx, opts, results, onProgress, pass) {
  await Promise.all(
    idx.map((i) =>
      poolEvaluate(fens[i], opts).then((r) => {
        if (!r) return;
        results[i] = r;
        onProgress?.({ index: i, result: r, pass });
      }),
    ),
  );
}

export async function analyze(uuid, { depth = 16, multipv = 3, priority = 0, job = null, onProgress } = {}) {
  const row = games.get(uuid);
  if (!row?.pgn) throw new Error('Game not found');
  const game = parseGame(row.pgn);
  const results = new Array(game.fens.length).fill(null);
  const opts = { depth, multipv, priority, job };

  await evaluateAll(game.fens, game.fens.map((_, i) => i), opts, results, onProgress, 1);
  if (job?.cancelled) return null;

  const first = buildReview(game, results);
  const deep = new Set();
  first.moves.forEach((m, i) => {
    if (ERROR_CLASSES.has(m.cls) || m.cls === 'great' || m.cls === 'brilliant' || m.opportunity) {
      deep.add(i);
      deep.add(i + 1);
    }
  });
  // WASM is single-threaded, so the second pass goes 2 plies deeper (native: 4).
  await evaluateAll(game.fens, [...deep], { ...opts, depth: Math.min(20, depth + 2), multipv: 3 }, results, onProgress, 2);
  if (job?.cancelled) return null;

  const review = buildReview(game, results, { depth, engine: engineName });
  save(uuid, review, results, depth);
  return { review, results };
}

function save(uuid, review, results, depth) {
  analyses.set(uuid, { uuid, depth, engine: engineName, version: REVIEW_VERSION, acc_w: review.accuracy.w, acc_b: review.accuracy.b, review, results, created_at: Date.now() });
}

export function stored(uuid) {
  const a = analyses.get(uuid);
  if (!a) return null;
  if (a.version === REVIEW_VERSION) return { review: a.review, results: a.results, depth: a.depth };
  const review = buildReview(parseGame(games.get(uuid).pgn), a.results, { depth: a.depth, engine: a.engine });
  save(uuid, review, a.results, a.depth);
  return { review, results: a.results, depth: a.depth };
}

// ---------- the client/src/lib/engine.js interface ----------

export function requestReview(uuid, { depth, force = false }, { onProgress, onDone, onError }) {
  const have = stored(uuid);
  if (have && !force && have.depth >= depth) {
    queueMicrotask(() => onDone(have));
    return () => {};
  }
  const job = { cancelled: false };
  const g = games.get(uuid);
  if (g) track('Game review', { white: g.white, black: g.black, source: g.source });
  analyze(uuid, { depth, multipv: 3, priority: 0, job, onProgress })
    .then((out) => out && !job.cancelled && onDone({ ...out, depth }))
    .catch((e) => onError(e));
  return () => (job.cancelled = true);
}

// One dedicated engine for the deepening analysis of the shown position.
let live = null;
let queued = null;
let current = null;

export function analyzeLive(fen, { depth = 22, multipv = 3 } = {}, onUpdate) {
  const req = { fen, depth, multipv, onUpdate, active: true };
  runLive(req);
  return () => {
    req.active = false;
    if (queued === req) queued = null;
    if (current === req) live?.then((e) => e.stop());
  };
}

async function runLive(req) {
  live ??= new WasmEngine().init();
  const engine = await live;
  if (!req.active) return;
  queued = req;
  if (engine.busy) return engine.stop();
  while (queued) {
    const r = queued;
    queued = null;
    current = r;
    const result = await engine.analyze(r.fen, { depth: r.depth, multipv: r.multipv, onInfo: (info) => r.active && !queued && r.onUpdate(info, false) });
    current = null;
    if (r.active && !queued) r.onUpdate(result, true);
  }
}

export function evaluate(fen, depth = 16, multipv = 1, priority = 0) {
  return poolEvaluate(fen, { depth, multipv, priority });
}
