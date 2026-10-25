// Browser version of client/src/lib/api.js: the same calls and return shapes
// as the local REST API, but Chess.com is fetched directly from the browser
// and everything is kept in memory for this tab (see store.js).
import { Chess } from 'chess.js';
import { DRAWS } from '../client/src/lib/api.js';
import { insights, openings, progress, mistakes } from '../server/insights.js';
import { openingName } from './chesscom.js';
import { players, archives, games, analyses, gamesOf } from './store.js';
import { analyze, stored } from './engine.js';

export { DRAWS, resultFor, formatTimeControl, flagEmoji, ago } from '../client/src/lib/api.js';

const BASE = 'https://api.chess.com/pub';
const PROFILE_TTL = 30 * 60 * 1000;
const CURRENT_MONTH_TTL = 5 * 60 * 1000;
const lower = (u) => u.toLowerCase();

async function get(url, tries = 3) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw Object.assign(new Error('Player not found on Chess.com'), { status: 404 });
  if (res.status === 429 && tries > 1) {
    await new Promise((r) => setTimeout(r, 1500));
    return get(url, tries - 1);
  }
  if (!res.ok) throw new Error(`Chess.com API error ${res.status}`);
  return res.json();
}

const playerUrl = (u) => `${BASE}/player/${encodeURIComponent(u)}`;

async function getPlayer(username, { force = false } = {}) {
  const u = lower(username);
  const have = players.get(u);
  if (have && !force && Date.now() - have.fetchedAt < PROFILE_TTL) return have;
  const [profile, stats, { archives: list }] = await Promise.all([get(playerUrl(u)), get(`${playerUrl(u)}/stats`), get(`${playerUrl(u)}/games/archives`)]);
  const p = { profile, stats, archives: list, fetchedAt: Date.now() };
  players.set(u, p);
  return p;
}

// ---------- archive sync ----------

const syncJobs = new Map();

function isCurrentMonth(url) {
  const [y, m] = url.split('/').slice(-2).map(Number);
  const now = new Date();
  return y === now.getUTCFullYear() && m === now.getUTCMonth() + 1;
}

function syncStatus(username) {
  const u = lower(username);
  const list = players.get(u)?.archives || [];
  const done = archives.get(u) || new Map();
  const { promise, ...job } = syncJobs.get(u) || { running: false };
  return { ...job, months: list.length, synced: list.filter((a) => done.has(a)).length };
}

function putGame(g) {
  if (!g.uuid) return;
  games.set(g.uuid, {
    uuid: g.uuid,
    url: g.url,
    end_time: g.end_time,
    time_class: g.time_class,
    time_control: g.time_control,
    rules: g.rules,
    rated: g.rated ? 1 : 0,
    white: g.white.username,
    black: g.black.username,
    white_l: lower(g.white.username),
    black_l: lower(g.black.username),
    white_rating: g.white.rating,
    black_rating: g.black.rating,
    white_result: g.white.result,
    black_result: g.black.result,
    eco_url: g.eco || null,
    accuracies: g.accuracies || null,
    pgn: g.pgn || null,
    source: 'chesscom',
  });
}

// scope 'recent': newest months until ~150 games are loaded; 'all': everything.
function startSync(username, scope = 'recent') {
  const u = lower(username);
  const existing = syncJobs.get(u);
  if (existing?.running) return existing.promise;
  const job = { running: true, done: 0, total: 0, added: 0, error: null };
  syncJobs.set(u, job);
  if (!archives.has(u)) archives.set(u, new Map());
  const done = archives.get(u);
  job.promise = (async () => {
    try {
      const { archives: list } = await getPlayer(u);
      const newestFirst = list.slice().reverse();
      const stale = (url) => {
        const a = done.get(url);
        return !a || (!a.complete && Date.now() - a.fetched_at > CURRENT_MONTH_TTL);
      };
      job.total = scope === 'all' ? newestFirst.filter(stale).length : Math.min(newestFirst.length, 3);
      let have = 0;
      for (const [i, url] of newestFirst.entries()) {
        if (scope === 'recent' && have >= 150 && i >= 1) break;
        if (stale(url)) {
          const { games: month } = await get(url);
          month.forEach(putGame);
          done.set(url, { fetched_at: Date.now(), complete: !isCurrentMonth(url), games: month.length });
          job.added += month.length;
          job.done++;
          have += month.length;
        } else have += done.get(url).games;
      }
    } catch (e) {
      job.error = e.message;
    } finally {
      job.running = false;
    }
    return job;
  })();
  return job.promise;
}

// ---------- games ----------

function listGames(u, f) {
  const mine = (g) => (g.white_l === u ? g.white_result : g.black_result);
  const isDraw = (g) => DRAWS.has(mine(g));
  const q = f.q?.toLowerCase();
  const rows = gamesOf(u)
    .filter((g) => !f.time_class || f.time_class === 'all' || g.time_class === f.time_class)
    .filter((g) => f.color !== 'white' || g.white_l === u)
    .filter((g) => f.color !== 'black' || g.black_l === u)
    .filter((g) => f.result !== 'win' || mine(g) === 'win')
    .filter((g) => f.result !== 'draw' || isDraw(g))
    .filter((g) => f.result !== 'loss' || (mine(g) !== 'win' && !isDraw(g)))
    .filter((g) => f.analyzed !== '1' || analyses.has(g.uuid))
    .filter((g) => f.analyzed !== '0' || !analyses.has(g.uuid))
    .filter((g) => !q || (g.white_l === u ? g.black_l : g.white_l).includes(q) || (g.eco_url || '').toLowerCase().includes(q.replace(/\s+/g, '-')))
    .sort((a, b) => b.end_time - a.end_time);
  const wins = rows.filter((g) => mine(g) === 'win').length;
  const draws = rows.filter(isDraw).length;
  const offset = Number(f.offset) || 0;
  const limit = Math.min(200, Number(f.limit) || 50);
  return {
    total: rows.length,
    wins,
    draws,
    losses: rows.length - wins - draws,
    analyzed: rows.filter((g) => analyses.has(g.uuid)).length,
    games: rows.slice(offset, offset + limit).map((g) => {
      const a = analyses.get(g.uuid);
      return { ...g, has_pgn: g.pgn ? 1 : 0, acc_w: a?.acc_w ?? null, acc_b: a?.acc_b ?? null, depth: a?.depth ?? null, opening: openingName(g.eco_url) };
    }),
  };
}

function ratings(u, tc) {
  const rows = gamesOf(u)
    .filter((g) => g.time_class === tc && g.rules === 'chess' && g.rated)
    .sort((a, b) => a.end_time - b.end_time)
    .map((g) => ({ t: g.end_time * 1000, r: g.white_l === u ? g.white_rating : g.black_rating }));
  const step = Math.max(1, Math.ceil(rows.length / 400));
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

// ---------- batch analysis ----------

const batches = new Map();

function startBatch(username, { count = 50, depth = 12, timeClass } = {}) {
  const u = lower(username);
  if (batches.get(u)?.running) return;
  const todo = gamesOf(u)
    .filter((g) => g.rules === 'chess' && g.pgn && !analyses.has(g.uuid))
    .filter((g) => !timeClass || timeClass === 'all' || g.time_class === timeClass)
    .sort((a, b) => b.end_time - a.end_time)
    .slice(0, Math.min(2000, Number(count)));
  const job = { running: true, cancelled: false, done: 0, total: todo.length, errors: 0 };
  batches.set(u, job);
  (async () => {
    for (const g of todo) {
      if (job.cancelled) break;
      try {
        await analyze(g.uuid, { depth: Number(depth), multipv: 2, priority: 1, job });
        if (!job.cancelled) job.done++;
      } catch {
        job.errors++;
      }
    }
    job.running = false;
  })();
}

function batchStatus(u) {
  const j = batches.get(lower(u));
  return j ? { running: j.running, done: j.done, total: j.total, errors: j.errors } : { running: false };
}

// ---------- PGN import ----------

async function importPgn(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const h = chess.getHeaders();
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pgn.trim()));
  const uuid = 'pgn-' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  if (!games.has(uuid)) {
    const date = (h.UTCDate || h.Date || '').replace(/\./g, '-');
    const t = Date.parse(date) ? Math.floor(Date.parse(date) / 1000) : Math.floor(Date.now() / 1000);
    const res = h.Result || '*';
    const wr = res === '1-0' ? 'win' : res === '0-1' ? 'lose' : res === '1/2-1/2' ? 'agreed' : '';
    const br = res === '0-1' ? 'win' : res === '1-0' ? 'lose' : wr;
    games.set(uuid, {
      uuid, url: h.Link || null, end_time: t, time_class: null, time_control: h.TimeControl || null, rules: 'chess', rated: 0,
      white: h.White || 'White', black: h.Black || 'Black', white_l: lower(h.White || 'white'), black_l: lower(h.Black || 'black'),
      white_rating: Number(h.WhiteElo) || null, black_rating: Number(h.BlackElo) || null, white_result: wr, black_result: br,
      eco_url: null, accuracies: null, pgn, source: 'pgn',
    });
  }
  return { uuid };
}

// ---------- the API ----------

const later = (fn) => Promise.resolve().then(fn);

export const api = {
  players: () =>
    later(() =>
      [...players.entries()].map(([u, p]) => ({ username: p.profile.username, avatar: p.profile.avatar, games: gamesOf(u).length })),
    ),
  player: async (u, refresh) => ({ ...(await getPlayer(u, { force: !!refresh })), sync: syncStatus(u), batch: batchStatus(u) }),
  sync: async (u, scope = 'recent') => {
    const p = startSync(u, scope);
    if (scope !== 'all') await p;
    return syncStatus(u);
  },
  syncStatus: (u) => later(() => syncStatus(u)),
  games: (u, f = {}) => later(() => listGames(lower(u), f)),
  ratings: (u, tc) => later(() => ratings(lower(u), tc || 'rapid')),
  batch: (u, opts) => later(() => (startBatch(u, opts), batchStatus(u))),
  batchStatus: (u) => later(() => batchStatus(u)),
  cancelBatch: (u) =>
    later(() => {
      const j = batches.get(lower(u));
      if (j) j.cancelled = true;
      return batchStatus(u);
    }),
  insights: (u, tc) => later(() => insights(u, { timeClass: tc })),
  openings: (u, tc) => later(() => openings(u, { timeClass: tc })),
  progress: (u, tc) => later(() => progress(u, { timeClass: tc })),
  mistakes: (u, f = {}) => later(() => mistakes(u, { ...f, timeClass: f.time_class })),
  game: (uuid) =>
    later(() => {
      const g = games.get(uuid);
      if (!g) throw new Error('Game not loaded. This online version keeps games in memory only. Open the player again to reload them.');
      return { game: { ...g, opening: openingName(g.eco_url) }, analysis: stored(uuid) };
    }),
  importPgn,
};
