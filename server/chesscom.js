// Chess.com Published-Data API → SQLite. Finished months are fetched once and
// never again; only the current month and the profile/stats are refreshed.
import net from 'node:net';
import { q, tx } from './db.js';

// This connection has no IPv6 and slow TLS handshakes; Node's default 250 ms
// per-address "happy eyeballs" timeout makes every request fail.
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);

const BASE = 'https://api.chess.com/pub';
const UA = 'chess-analyzer-local/1.0 (personal game review tool)';
const PROFILE_TTL = 30 * 60 * 1000;
const CURRENT_MONTH_TTL = 5 * 60 * 1000;

async function request(url, headers = {}, tries = 3) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
  if (res.status === 404) throw Object.assign(new Error('Player not found on Chess.com'), { status: 404 });
  if (res.status === 429 && tries > 1) {
    await new Promise((r) => setTimeout(r, 1500));
    return request(url, headers, tries - 1);
  }
  if (!res.ok && res.status !== 304) throw new Error(`Chess.com API error ${res.status}`);
  return res;
}

const get = async (url) => (await request(url)).json();

const player = (u) => `${BASE}/player/${encodeURIComponent(u.toLowerCase())}`;

// Downloads one archive month, but only if it changed since it was stored:
// with the saved ETag an unchanged month is an empty 304 instead of the whole
// month again. Returns { games, added } or null when nothing changed.
async function fetchMonth(u, url) {
  const known = q.getArchive.get(u, url);
  const res = await request(url, known?.etag ? { 'If-None-Match': known.etag } : {});
  if (res.status === 304) {
    q.touchArchive.run(Date.now(), u, url);
    return null;
  }
  const { games } = await res.json();
  let added = 0;
  tx(() => {
    for (const g of games) {
      if (g.uuid && !q.hasGame.get(g.uuid)) added++;
      putGame(g);
    }
    q.putArchive.run(u, url, Date.now(), isCurrentMonth(url) ? 0 : 1, games.length, res.headers.get('etag'));
  });
  return { games, added };
}

export async function getPlayer(username, { force = false } = {}) {
  const u = username.toLowerCase();
  const row = q.getPlayer.get(u);
  if (row && !force && Date.now() - row.fetched_at < PROFILE_TTL) return decode(row);
  try {
    const [profile, stats, { archives }] = await Promise.all([get(player(u)), get(`${player(u)}/stats`), get(`${player(u)}/games/archives`)]);
    q.putPlayer.run(u, JSON.stringify(profile), JSON.stringify(stats), JSON.stringify(archives), Date.now());
    return decode(q.getPlayer.get(u));
  } catch (e) {
    if (row && e.status !== 404) return { ...decode(row), stale: true };
    throw e;
  }
}

function decode(row) {
  return { profile: JSON.parse(row.profile), stats: JSON.parse(row.stats), archives: JSON.parse(row.archives), fetchedAt: row.fetched_at };
}

// ---------- archive sync ----------

const jobs = new Map(); // username → { running, done, total, added, error }

export function syncStatus(username) {
  const u = username.toLowerCase();
  const p = q.getPlayer.get(u);
  const archives = p ? JSON.parse(p.archives) : [];
  const stored = new Map(q.getArchives.all(u).map((a) => [a.url, a]));
  const { promise, ...job } = jobs.get(u) || { running: false };
  return {
    ...job,
    months: archives.length,
    synced: archives.filter((a) => stored.get(a)?.complete || isCurrentMonth(a)).filter((a) => stored.has(a)).length,
  };
}

function monthOf(url) {
  const [y, m] = url.split('/').slice(-2).map(Number);
  return { y, m };
}
function isCurrentMonth(url) {
  const { y, m } = monthOf(url);
  const now = new Date();
  return y === now.getUTCFullYear() && m === now.getUTCMonth() + 1;
}

// scope 'recent': newest months until ~150 games are stored; 'all': everything.
export function startSync(username, scope = 'recent') {
  const u = username.toLowerCase();
  const existing = jobs.get(u);
  if (existing?.running) return existing.promise;
  const job = { running: true, done: 0, total: 0, added: 0, error: null };
  jobs.set(u, job);
  job.promise = (async () => {
    try {
      const { archives } = await getPlayer(u);
      const stored = new Map(q.getArchives.all(u).map((a) => [a.url, a]));
      const newestFirst = archives.slice().reverse();
      const stale = (url) => {
        const a = stored.get(url);
        return !a || (!a.complete && Date.now() - a.fetched_at > CURRENT_MONTH_TTL);
      };
      // 'recent' walks back from the newest month and stops once ~150 games
      // are stored; 'all' fetches every month not stored yet.
      job.total = scope === 'all' ? newestFirst.filter(stale).length : Math.min(newestFirst.length, 3);
      let have = 0;
      for (const [i, url] of newestFirst.entries()) {
        if (scope === 'recent' && have >= 150 && i >= 1) break;
        if (stale(url)) {
          const r = await fetchMonth(u, url);
          job.added += r?.added || 0;
          job.done++;
          have += r ? r.games.length : stored.get(url).games;
        } else have += stored.get(url).games;
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

// Checks only the current month (no profile or archive-list requests), and
// only downloads it if it changed since last time. Falls back to the archive
// list when this month has no games yet. Returns the newest stored game.
export async function fetchLatest(username) {
  const u = username.toLowerCase();
  if (!q.getPlayer.get(u)) await getPlayer(u);
  const now = new Date();
  const url = `${player(u)}/games/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  let r;
  try {
    r = await fetchMonth(u, url);
  } catch (e) {
    if (e.status !== 404) throw e;
    r = { games: [], added: 0 };
  }
  const row = q.getPlayer.get(u);
  const archives = JSON.parse(row.archives);
  if (r?.games.length && !archives.includes(url)) {
    archives.push(url);
    q.putPlayer.run(u, row.profile, row.stats, JSON.stringify(archives), row.fetched_at);
  } else if (r && !r.games.length) {
    // New month without games yet: the newest game is in an older month.
    const { archives: list } = await get(`${player(u)}/games/archives`);
    q.putPlayer.run(u, row.profile, row.stats, JSON.stringify(list), row.fetched_at);
    if (list.length && list.at(-1) !== url) r = await fetchMonth(u, list.at(-1));
  }
  return { uuid: q.newestGame.get(u, u)?.uuid || null, added: r?.added || 0 };
}

function putGame(g) {
  if (!g.uuid) return;
  q.putGame.run(
    g.uuid,
    g.url,
    g.end_time,
    g.time_class,
    g.time_control,
    g.rules,
    g.rated ? 1 : 0,
    g.white.username,
    g.black.username,
    g.white.username.toLowerCase(),
    g.black.username.toLowerCase(),
    g.white.rating,
    g.black.rating,
    g.white.result,
    g.black.result,
    g.eco || null,
    g.accuracies ? JSON.stringify(g.accuracies) : null,
    g.pgn || null,
    'chesscom',
  );
}

export function openingName(ecoUrl) {
  const slug = (ecoUrl || '').split('/openings/')[1];
  if (!slug) return '';
  return decodeURIComponent(slug)
    .replace(/-\d+\..*$/, '')
    .replace(/-/g, ' ');
}
