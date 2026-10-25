// Reads a chess position from a screenshot (Chess.com, Lichess, this app…),
// entirely in the browser:
//  1. find the 8×8 grid: board lines are the columns/rows where brightness
//     steps both up and down along their length (light→dark and dark→light);
//  2. per square, separate the piece from the square colour and take its
//     silhouette (outline with holes filled);
//  3. compare silhouettes with open piece sets (the board's own pieces plus a
//     few Lichess sets), and split white/black by brightness.
// Site-specific piece art isn't needed because only shapes are compared.
import { Chess } from 'chess.js';

const N = 48; // square crop size
const M = 20; // silhouette grid
const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];
const LICHESS_SETS = ['cburnett', 'merida', 'alpha', 'california', 'staunty', 'maestro', 'cardinal', 'companion', 'fresca', 'kosal'];

// ---------- piece templates ----------

let templatesPromise = null;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function svgTemplates() {
  const out = [];
  // The board's own pieces (cburnett), available offline.
  try {
    const [{ defaultPieces }, { renderToStaticMarkup }] = await Promise.all([import('react-chessboard'), import('react-dom/server')]);
    for (const t of TYPES) {
      const svg = renderToStaticMarkup(defaultPieces[`w${t.toUpperCase()}`]()).replace('width="100%" height="100%"', `width="${N}" height="${N}"`);
      out.push({ set: 'board', t, src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg) });
    }
  } catch {}
  for (const set of LICHESS_SETS)
    for (const t of TYPES) out.push({ set, t, src: `https://lichess1.org/assets/piece/${set}/w${t.toUpperCase()}.svg` });
  const ctx = canvas(N, N);
  const loaded = await Promise.all(
    out.map(async (o) => {
      try {
        const img = await loadImage(o.src);
        ctx.clearRect(0, 0, N, N);
        ctx.drawImage(img, 0, 0, N, N);
        const { data } = ctx.getImageData(0, 0, N, N);
        const raw = new Uint8Array(N * N);
        for (let i = 0; i < N * N; i++) raw[i] = data[i * 4 + 3] > 128 ? 1 : 0;
        const d = describe(raw);
        return d && { set: o.set, t: o.t, ...d };
      } catch {
        return null;
      }
    }),
  );
  const ok = loaded.filter(Boolean);
  // Height relative to the set's king, so sets drawn at different scales compare.
  const kingH = Object.fromEntries(ok.filter((d) => d.t === 'k').map((d) => [d.set, d.h]));
  return ok.filter((d) => kingH[d.set]).map((d) => ({ ...d, rel: d.h / kingH[d.set] }));
}

const templates = () => (templatesPromise ||= svgTemplates());

// ---------- image helpers ----------

function canvas(w, h) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return c.getContext('2d', { willReadFrequently: true });
}

// Largest 4-connected component of `raw`, with enclosed holes filled.
function silhouette(raw) {
  const label = new Int32Array(N * N);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  const stack = [];
  for (let s = 0; s < N * N; s++) {
    if (!raw[s] || label[s]) continue;
    next++;
    let size = 0;
    stack.push(s);
    label[s] = next;
    while (stack.length) {
      const i = stack.pop();
      size++;
      const x = i % N;
      for (const j of [i - N, i + N, x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1])
        if (j >= 0 && j < N * N && raw[j] && !label[j]) (label[j] = next), stack.push(j);
    }
    if (size > bestSize) (bestSize = size), (best = next);
  }
  if (!best) return null;
  // Flood the outside from the border; whatever isn't reached is the piece.
  const outside = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) for (const s of [i, N * (N - 1) + i, i * N, i * N + N - 1]) if (label[s] !== best && !outside[s]) (outside[s] = 1), stack.push(s);
  while (stack.length) {
    const i = stack.pop();
    const x = i % N;
    for (const j of [i - N, i + N, x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1])
      if (j >= 0 && j < N * N && !outside[j] && label[j] !== best) (outside[j] = 1), stack.push(j);
  }
  const mask = new Uint8Array(N * N);
  let area = 0;
  for (let i = 0; i < N * N; i++) if (!outside[i]) (mask[i] = 1), area++;
  return { mask, area };
}

// Silhouette normalised to its bounding box, plus its proportions.
function describe(raw) {
  const s = silhouette(raw);
  if (!s || s.area < N * N * 0.05) return null;
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let i = 0; i < N * N; i++)
    if (s.mask[i]) {
      const x = i % N, y = (i / N) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (h < N * 0.25) return null; // coordinate letters, move dots
  const grid = new Uint8Array(M * M);
  for (let gy = 0; gy < M; gy++)
    for (let gx = 0; gx < M; gx++) grid[gy * M + gx] = s.mask[(y0 + (((gy + 0.5) * h) / M) | 0) * N + (x0 + (((gx + 0.5) * w) / M) | 0)];
  return { grid, aspect: w / h, h, mask: s.mask, area: s.area };
}

function distance(a, b) {
  let inter = 0, union = 0;
  for (let i = 0; i < M * M; i++) {
    inter += a.grid[i] & b.grid[i];
    union += a.grid[i] | b.grid[i];
  }
  return 1 - inter / union + 0.6 * Math.abs(Math.log(a.aspect / b.aspect)) + 0.8 * Math.abs(a.rel - b.rel);
}

// ---------- grid detection ----------

// For each column (or row), sqrt(sum of upward steps × sum of downward steps)
// across the given span of the other axis.
function lineProfile(gray, w, h, vertical, from, to) {
  const len = vertical ? w : h;
  const prof = new Float64Array(len);
  for (let a = 1; a < len; a++) {
    let pos = 0, neg = 0;
    for (let b = from; b < to; b++) {
      const d = vertical ? gray[b * w + a] - gray[b * w + a - 1] : gray[a * w + b] - gray[(a - 1) * w + b];
      if (d > 8) pos += d;
      else if (d < -8) neg -= d;
    }
    prof[a] = Math.sqrt(pos * neg);
  }
  return prof;
}

// Evenly spaced peaks: returns candidate {first, step, count} runs, best first.
function findRuns(prof) {
  const len = prof.length;
  let max = 0;
  for (const v of prof) max = Math.max(max, v);
  if (!max) return [];
  const peaks = [];
  for (let i = 1; i < len - 1; i++) {
    const v = prof[i] + 0.5 * Math.max(prof[i - 1], prof[i + 1]);
    if (prof[i] > 0.15 * max && prof[i] >= prof[i - 1] && prof[i] >= prof[i + 1]) peaks.push({ x: i, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  const top = peaks.slice(0, 80).sort((a, b) => a.x - b.x);
  const near = (x, tol) => top.find((p) => Math.abs(p.x - x) <= tol);
  const runs = [];
  for (let i = 0; i < top.length; i++)
    for (let j = i + 1; j < top.length; j++) {
      const step = top[j].x - top[i].x;
      if (step < 8 || step * 7 > len) continue;
      const tol = Math.max(1.5, step * 0.04);
      let k0 = 0;
      while (k0 > -9 && near(top[i].x + (k0 - 1) * step, tol)) k0--;
      if (k0 < 0 && near(top[i].x + (k0 - 1) * step, tol)) continue;
      const hits = [];
      for (let k = k0; k < k0 + 10; k++) {
        const p = near(top[i].x + k * step, tol);
        if (!p) break;
        hits.push(p);
      }
      if (hits.length < 7) continue;
      const exact = (hits[hits.length - 1].x - hits[0].x) / (hits.length - 1);
      runs.push({ first: hits[0].x, step: exact, count: hits.length, score: hits.reduce((s, p) => s + p.v, 0) / max });
    }
  runs.sort((a, b) => Math.min(b.count, 9) - Math.min(a.count, 9) || b.score - a.score);
  return runs;
}

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];

// How well the 8×8 cells at (x0,y0) alternate between two square colours:
// the share of cells on the right side of the light/dark split counts most,
// so a grid shifted by one square (one row of page background) loses.
function checkerScore(img, x0, y0, sx, sy) {
  const { data, width } = img;
  const A = [], B = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const vals = [];
      for (const [fx, fy] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88], [0.5, 0.06], [0.06, 0.5]]) {
        const x = Math.round(x0 + (c + fx) * sx), y = Math.round(y0 + (r + fy) * sy);
        vals.push(lum(data, (y * width + x) * 4));
      }
      ((r + c) % 2 ? B : A).push(median(vals));
    }
  const mA = median(A), mB = median(B);
  if (Math.abs(mA - mB) < 6) return 0;
  const mid = (mA + mB) / 2, sign = mA > mB ? 1 : -1;
  const ok = A.filter((v) => sign * (v - mid) > 0).length + B.filter((v) => sign * (v - mid) < 0).length;
  const spread = (arr, m) => arr.reduce((s, v) => s + Math.abs(v - m), 0) / arr.length;
  return ok / 64 + Math.min(1, Math.abs(mA - mB) / (8 + spread(A, mA) + spread(B, mB))) * 0.3;
}

function findBoard(img) {
  const { data, width: w, height: h } = img;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = lum(data, i * 4);
  let xs = findRuns(lineProfile(gray, w, h, true, 0, h));
  let ys = findRuns(lineProfile(gray, w, h, false, 0, w));
  if (!xs.length || !ys.length) return null;
  // Re-measure each axis only across the other axis' board span.
  const span = (r) => [Math.max(0, Math.floor(r.first - 2 * r.step)), Math.min(r.first + r.step * (r.count + 1), (r === xs[0] ? w : h) - 1) | 0];
  const [y0, y1] = span(ys[0]);
  const [x0, x1] = span(xs[0]);
  xs = findRuns(lineProfile(gray, w, h, true, y0, y1)).slice(0, 4).concat(xs.slice(0, 2));
  ys = findRuns(lineProfile(gray, w, h, false, x0, x1)).slice(0, 4).concat(ys.slice(0, 2));
  let best = null;
  const origins = (r, len) => {
    const out = [];
    for (let j = -2; j < r.count; j++) {
      const o = r.first + j * r.step;
      if (o >= -r.step * 0.15 && o + 8 * r.step <= len + r.step * 0.15) out.push(Math.max(0, o));
    }
    return out;
  };
  for (const rx of xs)
    for (const ry of ys) {
      if (Math.abs(rx.step - ry.step) > Math.max(rx.step, ry.step) * 0.06) continue;
      for (const ox of origins(rx, w))
        for (const oy of origins(ry, h)) {
          const sx = Math.min(rx.step, (w - ox) / 8), sy = Math.min(ry.step, (h - oy) / 8);
          const s = checkerScore(img, ox, oy, sx, sy);
          if (!best || s > best.s) best = { s, x: ox, y: oy, sx, sy };
        }
    }
  return best && best.s > 0.9 ? best : null;
}

// ---------- squares ----------

function readSquares(source, board) {
  const ctx = canvas(N, N);
  const cells = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      ctx.clearRect(0, 0, N, N);
      ctx.drawImage(source, board.x + c * board.sx, board.y + r * board.sy, board.sx, board.sy, 0, 0, N, N);
      const { data } = ctx.getImageData(0, 0, N, N);
      // Square colour: median of small patches in the corners.
      const ch = [[], [], []];
      for (const [cx, cy] of [[3, 3], [N - 6, 3], [3, N - 6], [N - 6, N - 6]])
        for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) for (let k = 0; k < 3; k++) ch[k].push(data[((cy + dy) * N + cx + dx) * 4 + k]);
      const bg = ch.map(median);
      const raw = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++) raw[i] = Math.abs(data[i * 4] - bg[0]) + Math.abs(data[i * 4 + 1] - bg[1]) + Math.abs(data[i * 4 + 2] - bg[2]) > 54 ? 1 : 0;
      const d = describe(raw);
      if (!d) {
        cells.push(null);
        continue;
      }
      // Piece colour from its interior: the silhouette shrunk by 2px so the
      // outline drops out, leaving mostly fill (light or dark).
      const ls = [];
      const inside = (i) => d.mask[i] && d.mask[i - 2] && d.mask[i + 2] && d.mask[i - 2 * N] && d.mask[i + 2 * N];
      for (let i = 2 * N; i < N * N - 2 * N; i++) if (inside(i)) ls.push(lum(data, i * 4));
      if (!ls.length) for (let i = 0; i < N * N; i++) if (d.mask[i]) ls.push(lum(data, i * 4));
      ls.sort((a, b) => a - b);
      // Median and upper quartile together: detailed white pieces (a king's
      // crown) can be half dark lines, black ones can carry white details.
      cells.push({ ...d, r, c, light: (ls[ls.length >> 1] + ls[Math.floor(ls.length * 0.75)]) / 2 });
    }
  return cells;
}

// Two brightness groups (1-D k-means): white pieces and black pieces.
function splitColours(cells) {
  const v = cells.map((p) => p.light).sort((a, b) => a - b);
  let t = 128;
  for (let it = 0; it < 10; it++) {
    const lo = v.filter((x) => x < t), hi = v.filter((x) => x >= t);
    if (!lo.length || !hi.length) break;
    t = (lo.reduce((s, x) => s + x, 0) / lo.length + hi.reduce((s, x) => s + x, 0) / hi.length) / 2;
  }
  // Only one colour on the board is rare; then fall back to mid-grey.
  if (v[v.length - 1] - v[0] < 60) t = 128;
  return t;
}

export async function imageToFen(blob) {
  const bitmap = await createImageBitmap(blob);
  const ctx = canvas(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  const board = findBoard(ctx.getImageData(0, 0, bitmap.width, bitmap.height));
  if (!board) throw new Error("Couldn't find a chessboard in that image. Try a screenshot of just the board.");

  const [tpl, cells] = [await templates(), readSquares(bitmap, board)];
  const pieces = cells.filter(Boolean);
  if (!pieces.length) throw new Error('Found a board, but no pieces on it.');
  if (!tpl.length) throw new Error('Piece shapes could not be loaded.');

  const maxH = Math.max(...pieces.map((p) => p.h));
  const split = splitColours(pieces);
  for (const p of pieces) {
    p.rel = p.h / maxH;
    p.colour = p.light >= split ? 'w' : 'b';
    p.cost = Object.fromEntries(TYPES.map((t) => [t, Math.min(...tpl.filter((d) => d.t === t).map((d) => distance(p, d)))]));
    p.t = TYPES.reduce((a, b) => (p.cost[a] <= p.cost[b] ? a : b));
  }

  // Orientation: white's king (or pawns) in the top half means black is at the bottom.
  const avgRow = (colour, t) => {
    const ps = pieces.filter((p) => p.colour === colour && (!t || p.t === t));
    return ps.length ? ps.reduce((s, p) => s + p.r, 0) / ps.length : null;
  };
  const wk = avgRow('w', 'k') ?? avgRow('w'), bk = avgRow('b', 'k') ?? avgRow('b');
  const flipped = wk !== null && bk !== null && wk < bk;

  // Rules a real position obeys: one king each, no pawns on the back ranks.
  const second = (p, banned) => TYPES.filter((t) => !banned.includes(t)).reduce((a, b) => (p.cost[a] <= p.cost[b] ? a : b));
  for (const p of pieces) if ((p.r === 0 || p.r === 7) && p.t === 'p') p.t = second(p, ['p']);
  // Two kings read as the same colour: the brighter one is white's.
  const kings = pieces.filter((p) => p.t === 'k').sort((a, b) => a.cost.k - b.cost.k);
  if (kings.length >= 2 && kings.every((k) => k.colour === kings[0].colour)) {
    const [a, b] = kings;
    [a.colour, b.colour] = a.light >= b.light ? ['w', 'b'] : ['b', 'w'];
  }
  for (const colour of ['w', 'b']) {
    const mine = pieces.filter((p) => p.colour === colour);
    if (!mine.length) continue;
    const king = mine.reduce((a, b) => (a.cost.k - (a.t === 'k' ? 1 : 0) <= b.cost.k - (b.t === 'k' ? 1 : 0) ? a : b));
    for (const p of mine) if (p !== king && p.t === 'k') p.t = second(p, ['k', ...(p.r === 0 || p.r === 7 ? ['p'] : [])]);
    king.t = 'k';
  }

  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const p of pieces) {
    const r = flipped ? 7 - p.r : p.r, c = flipped ? 7 - p.c : p.c;
    grid[r][c] = p.colour === 'w' ? p.t.toUpperCase() : p.t;
  }
  const placement = grid.map((row) => row.map((x) => x || '1').join('').replace(/1+/g, (m) => m.length)).join('/');
  const at = (sq) => grid[8 - Number(sq[1])][sq.charCodeAt(0) - 97];
  const castling =
    [at('e1') === 'K' && at('h1') === 'R' && 'K', at('e1') === 'K' && at('a1') === 'R' && 'Q', at('e8') === 'k' && at('h8') === 'r' && 'k', at('e8') === 'k' && at('a8') === 'r' && 'q']
      .filter(Boolean)
      .join('') || '-';
  return { fen: `${placement} w ${castling} - 0 1`, flipped };
}

// Same position with the other side to move (castling/en passant kept as is).
export const withTurn = (fen, turn) => fen.replace(/^(\S+) [wb] /, `$1 ${turn} `);

export const validFen = (fen) => {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
};
