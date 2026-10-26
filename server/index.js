// HTTP API + WebSocket server. Chess.com data, engine results and reviews are
// cached in SQLite (data/chess.db).
import http from 'node:http';
import os from 'node:os';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Engine } from './engine.js';
import { Pool } from './pool.js';
import { db, q } from './db.js';
import { getPlayer, startSync, syncStatus, fetchLatest, openingName } from './chesscom.js';
import { createAnalyzer, importPgn } from './analyzer.js';
import { insights, openings, progress, mistakes } from './insights.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3001);
const ENGINE_PATH = process.env.STOCKFISH_PATH || join(ROOT, 'engine/stockfish/stockfish-linux-x86-64-universal');
const CPUS = os.availableParallelism?.() ?? os.cpus().length;
// A Stockfish 19 process holds ~450 MB (mostly the networks, whatever its
// thread count). Too many of them on a machine short of RAM get swapped out,
// and then every search crawls, so the pool is sized by memory as well as by
// cores: one engine per ~3 GB of RAM, at most 6 threads each. Several engines
// on separate positions review a game much faster than one with many threads.
const MEM_GB = os.totalmem() / 2 ** 30;
const POOL_SIZE = Number(process.env.POOL_SIZE || Math.max(1, Math.min(8, Math.floor(CPUS / 3), Math.floor(MEM_GB / 3))));
const LIVE_THREADS = Number(process.env.LIVE_THREADS || Math.max(1, Math.min(8, Math.floor(CPUS / 4))));
// Use every hardware thread: the review pool gets what live analysis doesn't.
const POOL_THREADS = Number(process.env.POOL_THREADS || Math.max(1, Math.min(6, Math.floor((CPUS - LIVE_THREADS) / POOL_SIZE))));

if (!existsSync(ENGINE_PATH)) {
  console.error(`Stockfish not found at ${ENGINE_PATH}. Set STOCKFISH_PATH.`);
  process.exit(1);
}

const pool = await new Pool(ENGINE_PATH, { size: POOL_SIZE, threads: POOL_THREADS }).init();
const analyzer = createAnalyzer(pool);

// ---------- batch analysis (one job per player) ----------

const batches = new Map();

function startBatch(username, { count = 50, depth = 12, timeClass } = {}) {
  const u = username.toLowerCase();
  if (batches.get(u)?.running) return batches.get(u);
  const params = [u, u];
  let sql = `SELECT g.uuid FROM games g LEFT JOIN analyses a ON a.uuid = g.uuid
    WHERE (g.white_l = ? OR g.black_l = ?) AND g.rules = 'chess' AND g.pgn IS NOT NULL AND a.uuid IS NULL`;
  if (timeClass && timeClass !== 'all') {
    sql += ' AND g.time_class = ?';
    params.push(timeClass);
  }
  sql += ' ORDER BY g.end_time DESC LIMIT ?';
  params.push(Math.min(2000, Number(count)));
  const todo = db.prepare(sql).all(...params).map((r) => r.uuid);
  const job = { running: true, cancelled: false, done: 0, total: todo.length, errors: 0, startedAt: Date.now() };
  batches.set(u, job);
  (async () => {
    for (const uuid of todo) {
      if (job.cancelled) break;
      try {
        await analyzer.analyze(uuid, { depth: Number(depth), multipv: 2, priority: 1, job });
        if (!job.cancelled) job.done++;
      } catch {
        job.errors++;
      }
    }
    job.running = false;
  })();
  return job;
}

const batchStatus = (u) => {
  const j = batches.get(u.toLowerCase());
  return j ? { running: j.running, done: j.done, total: j.total, errors: j.errors } : { running: false };
};

// ---------- REST ----------

const DRAWS = ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'];

function listGames(u, f) {
  const me = `(CASE WHEN g.white_l = :u THEN g.white_result ELSE g.black_result END)`;
  const where = ['(g.white_l = :u OR g.black_l = :u)'];
  const p = { u };
  if (f.time_class && f.time_class !== 'all') (where.push('g.time_class = :tc'), (p.tc = f.time_class));
  if (f.color === 'white') where.push('g.white_l = :u');
  if (f.color === 'black') where.push('g.black_l = :u');
  if (f.result === 'win') where.push(`${me} = 'win'`);
  if (f.result === 'draw') where.push(`${me} IN (${DRAWS.map((d) => `'${d}'`).join(',')})`);
  if (f.result === 'loss') where.push(`${me} != 'win' AND ${me} NOT IN (${DRAWS.map((d) => `'${d}'`).join(',')})`);
  if (f.analyzed === '1') where.push('a.uuid IS NOT NULL');
  if (f.analyzed === '0') where.push('a.uuid IS NULL');
  if (f.q) (where.push(`(CASE WHEN g.white_l = :u THEN g.black_l ELSE g.white_l END LIKE :q OR g.eco_url LIKE :q2)`), (p.q = `%${f.q.toLowerCase()}%`), (p.q2 = `%${f.q.replace(/\s+/g, '-')}%`));
  const from = `FROM games g LEFT JOIN analyses a ON a.uuid = g.uuid WHERE ${where.join(' AND ')}`;
  const agg = db.prepare(`SELECT COUNT(*) total,
      SUM(${me} = 'win') wins,
      SUM(${me} IN (${DRAWS.map((d) => `'${d}'`).join(',')})) draws,
      SUM(a.uuid IS NOT NULL) analyzed ${from}`).get(p);
  const rows = db
    .prepare(`SELECT g.uuid, g.url, g.end_time, g.time_class, g.time_control, g.rules, g.rated, g.white, g.black, g.white_rating, g.black_rating,
        g.white_result, g.black_result, g.eco_url, g.accuracies, g.pgn IS NOT NULL has_pgn, a.acc_w, a.acc_b, a.depth
      ${from} ORDER BY g.end_time DESC LIMIT :limit OFFSET :offset`)
    .all({ ...p, limit: Math.min(200, Number(f.limit) || 50), offset: Number(f.offset) || 0 });
  return {
    total: agg.total,
    wins: agg.wins || 0,
    draws: agg.draws || 0,
    losses: agg.total - (agg.wins || 0) - (agg.draws || 0),
    analyzed: agg.analyzed || 0,
    games: rows.map((r) => ({ ...r, opening: openingName(r.eco_url), accuracies: r.accuracies ? JSON.parse(r.accuracies) : null })),
  };
}

function ratings(u, tc) {
  const rows = db
    .prepare(`SELECT end_time t, CASE WHEN white_l = ? THEN white_rating ELSE black_rating END r FROM games
      WHERE (white_l = ? OR black_l = ?) AND time_class = ? AND rules = 'chess' AND rated = 1 ORDER BY end_time`)
    .all(u, u, u, tc);
  const step = Math.max(1, Math.ceil(rows.length / 400));
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1).map((r) => ({ t: r.t * 1000, r: r.r }));
}

const routes = [
  ['GET', /^\/api\/players$/, () => q.listPlayers.all().map((p) => ({ username: JSON.parse(p.profile).username, avatar: JSON.parse(p.profile).avatar, games: p.games }))],
  ['GET', /^\/api\/player\/([^/]+)$/, async ([u], query) => ({ ...(await getPlayer(u, { force: query.refresh === '1' })), sync: syncStatus(u), batch: batchStatus(u) })],
  ['POST', /^\/api\/player\/([^/]+)\/sync$/, async ([u], query) => {
    const scope = query.scope || 'recent';
    const p = startSync(u, scope);
    if (scope !== 'all') await p;
    return syncStatus(u);
  }],
  ['GET', /^\/api\/player\/([^/]+)\/sync$/, ([u]) => syncStatus(u)],
  ['POST', /^\/api\/player\/([^/]+)\/latest$/, ([u]) => fetchLatest(u)],
  ['GET', /^\/api\/player\/([^/]+)\/games$/, ([u], query) => listGames(u.toLowerCase(), query)],
  ['GET', /^\/api\/player\/([^/]+)\/ratings$/, ([u], query) => ratings(u.toLowerCase(), query.time_class || 'rapid')],
  ['POST', /^\/api\/player\/([^/]+)\/batch$/, ([u], query, body) => (startBatch(u, body), batchStatus(u))],
  ['GET', /^\/api\/player\/([^/]+)\/batch$/, ([u]) => batchStatus(u)],
  ['DELETE', /^\/api\/player\/([^/]+)\/batch$/, ([u]) => {
    const j = batches.get(u.toLowerCase());
    if (j) j.cancelled = true;
    return batchStatus(u);
  }],
  ['GET', /^\/api\/player\/([^/]+)\/insights$/, ([u], query) => insights(u, { timeClass: query.time_class })],
  ['GET', /^\/api\/player\/([^/]+)\/openings$/, ([u], query) => openings(u, { timeClass: query.time_class })],
  ['GET', /^\/api\/player\/([^/]+)\/progress$/, ([u], query) => progress(u, { timeClass: query.time_class })],
  ['GET', /^\/api\/player\/([^/]+)\/mistakes$/, ([u], query) => mistakes(u, { ...query, timeClass: query.time_class })],
  ['GET', /^\/api\/game\/([^/]+)$/, ([uuid]) => {
    const g = q.getGame.get(uuid);
    if (!g) throw Object.assign(new Error('Game not found'), { status: 404 });
    const a = analyzer.stored(uuid);
    return { game: { ...g, accuracies: g.accuracies ? JSON.parse(g.accuracies) : null, opening: openingName(g.eco_url) }, analysis: a };
  }],
  ['POST', /^\/api\/game$/, (_, __, body) => ({ uuid: importPgn(body.pgn) })],
  ['GET', /^\/api\/health$/, () => ({ ok: true, engine: pool.engineName, pool: POOL_SIZE })],
];

async function handleApi(req, res, url) {
  const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
  if (!route) return send(res, 404, { error: 'Not found' });
  try {
    let body = {};
    if (req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    }
    const params = url.pathname.match(route[1]).slice(1).map(decodeURIComponent);
    send(res, 200, await route[2](params, Object.fromEntries(url.searchParams), body));
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
}

const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

// ---------- static (production build) ----------

const DIST = join(ROOT, 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  let file = join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404);
    return res.end('Run `npm run build` first, or use `npm run dev`.');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// ---------- websocket: reviews, live analysis, move checks ----------

const wss = new WebSocketServer({ server, path: '/ws' });

// One live engine shared by every tab, started up front so it is warm when a
// position arrives. The newest request wins: a running search is stopped and
// the latest queued position is analysed next.
const live = { engine: null, running: false, current: null, queued: null };
const liveReady = new Engine(ENGINE_PATH, { threads: LIVE_THREADS, hash: 128 }).init().then((e) => (live.engine = e));

function runLive(req) {
  live.queued = req;
  if (live.running) return live.current && live.engine.stop();
  live.running = true;
  (async () => {
    await liveReady;
    while (live.queued) {
      const next = (live.current = live.queued);
      live.queued = null;
      const { reqId, fen, depth = 22, multipv = 3, send } = next;
      const result = await live.engine.analyze(fen, {
        depth,
        multipv,
        onInfo: (info) => !live.queued && send({ type: 'liveInfo', reqId, result: info }),
      });
      if (!live.queued) send({ type: 'liveDone', reqId, result });
      live.current = null;
    }
  })().finally(() => (live.running = false));
}

wss.on('connection', (ws) => {
  const reviews = new Map();
  const sendMsg = (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

  async function review({ reqId, uuid, depth = 16, force = false }) {
    const have = analyzer.stored(uuid);
    if (have && !force && have.depth >= depth) return sendMsg({ type: 'reviewDone', reqId, ...have });
    const job = { cancelled: false };
    reviews.set(reqId, job);
    try {
      const out = await analyzer.analyze(uuid, { depth, multipv: 3, priority: 0, job, onProgress: (p) => sendMsg({ type: 'reviewProgress', reqId, ...p }) });
      if (out) sendMsg({ type: 'reviewDone', reqId, ...out, depth });
    } catch (e) {
      sendMsg({ type: 'reviewError', reqId, error: e.message });
    }
    reviews.delete(reqId);
  }

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'review') review(msg);
    else if (msg.type === 'cancelReview') reviews.get(msg.reqId) && (reviews.get(msg.reqId).cancelled = true);
    else if (msg.type === 'live') runLive({ ...msg, ws, send: sendMsg });
    else if (msg.type === 'liveStop') live.current?.ws === ws && live.engine.stop();
    else if (msg.type === 'evaluate') {
      const result = await pool.evaluate(msg.fen, { depth: msg.depth || 16, multipv: msg.multipv || 1, priority: msg.priority === 1 ? 1 : 0 });
      sendMsg({ type: 'evaluateResult', reqId: msg.reqId, result });
    }
  });

  ws.on('close', () => {
    for (const job of reviews.values()) job.cancelled = true;
    if (live.queued?.ws === ws) live.queued = null;
    if (live.current?.ws === ws) live.engine.stop();
  });
});

server.listen(PORT, () => {
  console.log(`Chess analyzer server on http://localhost:${PORT}`);
  console.log(`${pool.engineName}: pool ${POOL_SIZE} × ${POOL_THREADS} threads, live ${LIVE_THREADS} threads`);
});

// Ctrl+C, or `node --watch` restarting: don't leave Stockfish processes behind.
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    pool.quit();
    live.engine?.quit();
    process.exit(0);
  });
