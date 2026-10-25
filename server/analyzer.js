// Game review pipeline: a quick pass over every position, then a deeper
// second pass on the moves that matter (errors, brilliant/great candidates).
// Results are stored so a game is never analysed twice.
import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { q } from './db.js';
import { parseGame, buildReview, REVIEW_VERSION, ERROR_CLASSES } from '../shared/review.js';

export function createAnalyzer(pool) {
  async function evaluateAll(fens, idx, opts, results, onProgress, pass) {
    await Promise.all(
      idx.map((i) =>
        pool.evaluate(fens[i], opts).then((r) => {
          if (!r) return;
          results[i] = r;
          onProgress?.({ index: i, result: r, pass });
        }),
      ),
    );
  }

  // Returns { review, results }.
  async function analyze(uuid, { depth = 16, multipv = 3, priority = 0, job = null, onProgress } = {}) {
    const row = q.getGame.get(uuid);
    if (!row?.pgn) throw new Error('Game not found');
    const game = parseGame(row.pgn);
    const results = new Array(game.fens.length).fill(null);
    const all = game.fens.map((_, i) => i);
    const opts = { depth, multipv, priority, job };

    await evaluateAll(game.fens, all, opts, results, onProgress, 1);
    if (job?.cancelled) return null;

    // Pass 2: re-search the positions around important moves more deeply.
    const first = buildReview(game, results);
    const deep = new Set();
    first.moves.forEach((m, i) => {
      if (ERROR_CLASSES.has(m.cls) || m.cls === 'great' || m.cls === 'brilliant' || m.opportunity) {
        deep.add(i);
        deep.add(i + 1);
      }
    });
    const deepDepth = Math.min(24, depth + 4);
    await evaluateAll(game.fens, [...deep], { ...opts, depth: deepDepth, multipv: 3 }, results, onProgress, 2);
    if (job?.cancelled) return null;

    const review = buildReview(game, results, { depth, engine: pool.engineName });
    save(uuid, review, results, depth);
    return { review, results };
  }

  function save(uuid, review, results, depth) {
    q.putAnalysis.run(uuid, depth, pool.engineName, REVIEW_VERSION, review.accuracy.w, review.accuracy.b, JSON.stringify(review), JSON.stringify(results), Date.now());
  }

  // Stored analysis, rebuilt from cached engine results if the review rules
  // changed since it was saved (no engine work needed).
  function stored(uuid) {
    const a = q.getAnalysis.get(uuid);
    if (!a) return null;
    const results = JSON.parse(a.results);
    if (a.version === REVIEW_VERSION) return { review: JSON.parse(a.review), results, depth: a.depth };
    const game = parseGame(q.getGame.get(uuid).pgn);
    const review = buildReview(game, results, { depth: a.depth, engine: a.engine });
    save(uuid, review, results, a.depth);
    return { review, results, depth: a.depth };
  }

  return { analyze, stored };
}

export function importPgn(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const h = chess.getHeaders();
  const uuid = 'pgn-' + createHash('sha1').update(pgn.trim()).digest('hex').slice(0, 16);
  if (!q.getGame.get(uuid)) {
    const date = (h.UTCDate || h.Date || '').replace(/\./g, '-');
    const t = Date.parse(date) ? Math.floor(Date.parse(date) / 1000) : Math.floor(Date.now() / 1000);
    const res = h.Result || '*';
    const wr = res === '1-0' ? 'win' : res === '0-1' ? 'lose' : res === '1/2-1/2' ? 'agreed' : '';
    const br = res === '0-1' ? 'win' : res === '1-0' ? 'lose' : wr;
    q.putGame.run(uuid, h.Link || null, t, null, h.TimeControl || null, 'chess', 0, h.White || 'White', h.Black || 'Black',
      (h.White || 'white').toLowerCase(), (h.Black || 'black').toLowerCase(), Number(h.WhiteElo) || null, Number(h.BlackElo) || null,
      wr, br, null, null, pgn, 'pgn');
  }
  return uuid;
}
