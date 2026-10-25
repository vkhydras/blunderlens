// REST client for the local server (which caches everything in SQLite).
async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && v !== 'all' && p.set(k, v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
const P = (u) => `/player/${encodeURIComponent(u)}`;

export const api = {
  players: () => call('GET', '/players'),
  player: (u, refresh) => call('GET', `${P(u)}${refresh ? '?refresh=1' : ''}`),
  sync: (u, scope) => call('POST', `${P(u)}/sync${qs({ scope })}`),
  syncStatus: (u) => call('GET', `${P(u)}/sync`),
  games: (u, f) => call('GET', `${P(u)}/games${qs(f)}`),
  ratings: (u, tc) => call('GET', `${P(u)}/ratings${qs({ time_class: tc })}`),
  batch: (u, opts) => call('POST', `${P(u)}/batch`, opts),
  batchStatus: (u) => call('GET', `${P(u)}/batch`),
  cancelBatch: (u) => call('DELETE', `${P(u)}/batch`),
  insights: (u, tc) => call('GET', `${P(u)}/insights${qs({ time_class: tc })}`),
  openings: (u, tc) => call('GET', `${P(u)}/openings${qs({ time_class: tc })}`),
  progress: (u, tc) => call('GET', `${P(u)}/progress${qs({ time_class: tc })}`),
  mistakes: (u, f) => call('GET', `${P(u)}/mistakes${qs(f)}`),
  game: (uuid) => call('GET', `/game/${encodeURIComponent(uuid)}`),
  importPgn: (pgn) => call('POST', '/game', { pgn }),
};

export const DRAWS = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient']);

export function resultFor(g, username) {
  const white = g.white.toLowerCase() === username.toLowerCase();
  const r = white ? g.white_result : g.black_result;
  return r === 'win' ? 'win' : DRAWS.has(r) ? 'draw' : 'loss';
}

export function formatTimeControl(tc) {
  if (!tc) return '';
  if (tc.includes('/')) return `${Math.round(Number(tc.split('/')[1]) / 86400)}d`;
  const [base, inc] = tc.split('+').map(Number);
  const mins = base >= 60 ? `${base / 60}` : `${base}s`;
  return inc ? `${mins}+${inc}` : `${mins}′`;
}

export function flagEmoji(countryUrl) {
  const code = (countryUrl || '').split('/').pop();
  if (!code || code.length !== 2 || code.startsWith('X')) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export const ago = (t) => {
  const s = (Date.now() - t) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
};
