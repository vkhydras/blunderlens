// Turns raw Stockfish results into a game review: move classes, accuracy,
// phases, tactics, critical moments and opening info. Shared by the server
// (which stores reviews) and the browser (which renders them live).
//
// Win-probability and accuracy formulas follow Lichess
// (https://lichess.org/page/accuracy). Classification thresholds are ours.
import { Chess } from 'chess.js';
import openings from './openings.js';
import { lineThemes, hangingPieces, materialDiff, pieceLabel, THEMES } from './tactics.js';

export const REVIEW_VERSION = 4;

// Same colours and symbols as Chess.com's Game Review so the labels read the same.
export const CLASSES = {
  brilliant: { label: 'Brilliant', symbol: '!!', color: '#1baca6' },
  great: { label: 'Great', symbol: '!', color: '#5c8bb0' },
  best: { label: 'Best', symbol: '★', color: '#81b64c' },
  excellent: { label: 'Excellent', symbol: '👍', color: '#81b64c' },
  good: { label: 'Good', symbol: '✓', color: '#95b776' },
  book: { label: 'Book', symbol: '📖', color: '#a88865' },
  inaccuracy: { label: 'Inaccuracy', symbol: '?!', color: '#f7c631' },
  mistake: { label: 'Mistake', symbol: '?', color: '#ffa459' },
  miss: { label: 'Miss', symbol: '✕', color: '#ff7769' },
  blunder: { label: 'Blunder', symbol: '??', color: '#fa412d' },
};
export const ERROR_CLASSES = new Set(['inaccuracy', 'mistake', 'miss', 'blunder']);
export const SERIOUS = new Set(['mistake', 'miss', 'blunder']);
export { THEMES };

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');
const other = (c) => (c === 'w' ? 'b' : 'w');

// ---------- parsing ----------

const clockToSec = (c) => {
  if (!c) return null;
  const parts = c.split(':').map(Number);
  return parts.reduce((s, x) => s * 60 + x, 0);
};

export function parseGame(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders();
  const moves = chess.history({ verbose: true });
  const clocks = [...pgn.matchAll(/\[%clk ([\d:.]+)\]/g)].map((m) => m[1]);
  const fens = [moves.length ? moves[0].before : chess.fen(), ...moves.map((m) => m.after)];
  const tc = headers.TimeControl || '';
  const base = tc && !tc.includes('/') ? Number(tc.split('+')[0]) || null : null;
  return {
    headers,
    base,
    fens,
    moves: moves.map((m, i) => ({
      san: m.san,
      uci: m.from + m.to + (m.promotion || ''),
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured || null,
      before: m.before,
      after: m.after,
      clock: clocks[i] || null,
    })),
  };
}

// ---------- evaluation helpers ----------

// Normalises one engine result for `fen`. Finished positions get exact values.
export function positionEval(fen, result) {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) return { cp: null, mate: 0, winner: other(chess.turn()), lines: [], depth: 99 };
  if (chess.isDraw() || chess.isStalemate()) return { cp: 0, mate: null, lines: [], depth: 99 };
  if (!result || !result.lines?.length) return null;
  const top = result.lines[0];
  return { cp: top.cp, mate: top.mate, lines: result.lines, best: result.bestmove || top.pv[0], depth: result.depth };
}

// Probability (0–100) that White wins.
export function winPct(e) {
  if (!e) return 50;
  if (e.mate !== null && e.mate !== undefined) {
    if (e.mate === 0) return e.winner === 'w' ? 100 : 0;
    return e.mate > 0 ? 100 : 0;
  }
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * e.cp)) - 1);
}

export function formatEval(e) {
  if (!e) return '…';
  if (e.mate !== null && e.mate !== undefined) {
    if (e.mate === 0) return e.winner === 'w' ? '1-0' : '0-1';
    return `${e.mate > 0 ? '+' : '-'}M${Math.abs(e.mate)}`;
  }
  const v = e.cp / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

export function pvToSan(fen, pv, max = 12) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, max)) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      out.push({ san: m.san, color: m.color, moveNumber: Number(m.before.split(' ')[5]) });
    } catch {
      break;
    }
  }
  return out;
}

export const uciToSan = (fen, uci) => (uci ? pvToSan(fen, [uci], 1)[0]?.san ?? uci : null);

export const moveAccuracy = (loss) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669 + 1));

// ---------- phases ----------

function phaseOf(fen, ply) {
  const board = fen.split(' ')[0];
  const majorsMinors = (board.match(/[nbrqNBRQ]/g) || []).length;
  if (majorsMinors <= 6) return 'endgame';
  if (ply < 24 && majorsMinors >= 12) return 'opening';
  return 'middlegame';
}

// ---------- opening ----------

function openingInfo(game) {
  let lastBookPly = 0;
  let named = null;
  for (let i = 1; i < game.fens.length; i++) {
    const entry = openings[epd(game.fens[i])];
    if (entry === undefined) break;
    lastBookPly = i;
    if (entry) named = { eco: entry[0], name: entry[1] };
  }
  const info = { ...(named || { eco: null, name: null }), lastBookPly };
  const dev = game.moves[lastBookPly];
  if (dev) {
    const chess = new Chess(game.fens[lastBookPly]);
    const book = chess
      .moves({ verbose: true })
      .filter((m) => openings[epd(m.after)] !== undefined)
      .map((m) => m.san);
    if (book.length) info.deviation = { ply: lastBookPly, san: dev.san, color: dev.color, book: book.slice(0, 5) };
  }
  return info;
}

// ---------- sacrifices ----------

function atRisk(fen, owner) {
  return hangingPieces(new Chess(fen), owner).reduce((m, p) => Math.max(m, p.loss), 0);
}

// The move itself puts ≥ 2 points en prise beyond what it captured and what
// was already hanging.
function sacrifice(move) {
  const gained = move.captured ? { p: 1, n: 3, b: 3, r: 5, q: 9 }[move.captured] : 0;
  const after = atRisk(move.after, move.color);
  let before = 0;
  try {
    const f = move.before.split(' ');
    f[1] = other(move.color);
    f[3] = '-';
    before = atRisk(f.join(' '), move.color);
  } catch {}
  const net = after - gained - before;
  return net >= 2 ? net : 0;
}

// ---------- review ----------

// `results[i]` is the raw engine result for game.fens[i] (or null if pending).
export function buildReview(game, results, { depth = null, engine = null } = {}) {
  const evals = game.fens.map((f, i) => positionEval(f, results[i]));
  const opening = openingInfo(game);
  const moves = [];

  for (let i = 0; i < game.moves.length; i++) {
    const m = game.moves[i];
    const me = m.color;
    const before = evals[i];
    const after = evals[i + 1];
    const clockSec = clockToSec(m.clock);
    const entry = {
      ply: i + 1,
      san: m.san,
      uci: m.uci,
      color: me,
      piece: m.piece,
      phase: phaseOf(m.before, i),
      clock: clockSec,
      pressure: game.base && clockSec !== null ? clockSec < Math.max(20, game.base * 0.1) : false,
      cls: null,
    };
    moves.push(entry);
    if (i < opening.lastBookPly) {
      entry.cls = 'book';
      entry.loss = 0;
      continue;
    }
    if (!before || !after) continue;

    const pov = (e) => (me === 'w' ? winPct(e) : 100 - winPct(e));
    const sameSearch = before.lines.find((l) => l.pv[0] === m.uci);
    const afterScore = sameSearch && before.depth >= (after.depth || 0) && after.mate !== 0 ? sameSearch : after;
    const wpBefore = pov(before);
    const wpAfter = pov(afterScore);
    const loss = Math.max(0, wpBefore - wpAfter);
    const isBest = before.best === m.uci || (after.mate === 0 && after.winner === me);
    const second = before.lines[1];
    const wpSecond = second ? pov(second) : null;

    let cls;
    if (isBest) cls = 'best';
    else if (loss <= 2) cls = 'excellent';
    else if (loss <= 5) cls = 'good';
    else if (loss <= 10) cls = 'inaccuracy';
    else if (loss <= 20) cls = 'mistake';
    else cls = 'blunder';
    // Already lost: a bigger margin of defeat isn't a blunder.
    if ((cls === 'blunder' || cls === 'mistake') && wpBefore < 10) cls = 'inaccuracy';

    const evidence = {};
    if (loss <= 2) {
      const prev = game.moves[i - 1];
      const recapture = prev?.captured && prev.to === m.to;
      const sac = sacrifice(m);
      if (sac && wpAfter >= 50 && wpBefore <= 80) {
        cls = 'brilliant';
        evidence.sacrificed = sac;
      } else if (isBest && wpSecond !== null && wpBefore - wpSecond >= 20 && !recapture && wpBefore < 95) {
        cls = 'great';
        evidence.onlyMove = Math.round(wpBefore - wpSecond);
      }
    } else if (cls !== 'blunder' && SERIOUS.has(moves[i - 1]?.cls) && wpBefore >= 60) {
      cls = 'miss';
    }

    Object.assign(entry, {
      cls,
      loss: round1(loss),
      wpBefore: round1(wpBefore),
      wpAfter: round1(wpAfter),
      best: before.best,
      bestSan: uciToSan(m.before, before.best),
      evidence,
    });

    // Tactical opportunity: the best line wins material (net of any trade the
    // opponent just started) or mates, and it was clearly better than plan B.
    const bestLine = lineThemes(m.before, before.lines[0]?.pv || []);
    const baseline = i > 0 ? materialDiff(new Chess(game.moves[i - 1].before), me) : materialDiff(new Chess(m.before), me);
    const netGain = materialDiff(new Chess(m.before), me) + bestLine.gain - baseline;
    const forcing = before.mate ? (before.mate > 0 ? 'w' : 'b') === me : false;
    if ((netGain >= 2 || bestLine.mates || forcing) && wpBefore > 5 && wpBefore < 97 && (wpSecond === null || wpBefore - wpSecond >= 10)) {
      entry.opportunity = {
        found: loss <= 5,
        themes: themesOf(bestLine, netGain),
        line: bestLine.sans,
        notes: bestLine.tactics.map((t) => t.text).slice(0, 2),
      };
    }

    if (ERROR_CLASSES.has(cls)) {
      const reply = lineThemes(m.after, after.lines?.[0]?.pv || []);
      const hangBefore = new Set(hangingPieces(new Chess(m.before), me).map((p) => p.sq));
      const hangingNow = hangingPieces(new Chess(m.after), me).filter((p) => !hangBefore.has(p.sq));
      const replyMove = after.lines?.[0]?.pv?.[0];
      const hung = hangingNow.find((p) => replyMove?.slice(2, 4) === p.sq);
      const allowedThemes = themesOf(reply, reply.gain);
      if (hung && !allowedThemes.includes('hanging')) allowedThemes.unshift('hanging');
      entry.allowed = {
        themes: allowedThemes,
        line: reply.sans,
        notes: [...(hung ? [`leaves your ${pieceLabel(hung.type, hung.sq)} undefended`] : []), ...reply.tactics.map((t) => t.text)].slice(0, 2),
      };
    }
  }

  const accuracy = { w: gameAccuracy(evals, moves, 'w'), b: gameAccuracy(evals, moves, 'b') };
  const phaseAcc = { w: {}, b: {} };
  const counts = { w: {}, b: {} };
  for (const c of ['w', 'b']) {
    for (const ph of ['opening', 'middlegame', 'endgame']) {
      const xs = moves.filter((m) => m.color === c && m.phase === ph && m.cls && m.cls !== 'book');
      phaseAcc[c][ph] = xs.length ? round1(xs.reduce((s, m) => s + moveAccuracy(m.loss), 0) / xs.length) : null;
    }
  }
  moves.forEach((m) => m.cls && (counts[m.color][m.cls] = (counts[m.color][m.cls] || 0) + 1));

  const critical = moves
    .filter((m) => m.cls && m.loss >= 8 && m.cls !== 'book')
    .sort((a, b) => b.loss - a.loss)
    .slice(0, 5)
    .map((m) => m.ply)
    .sort((a, b) => a - b);

  return { version: REVIEW_VERSION, depth, engine, result: game.headers.Result, opening, accuracy, phaseAcc, counts, critical, moves };
}

function themesOf(line, gain) {
  const t = [...new Set(line.tactics.map((x) => x.type))];
  if (line.mates && !t.includes('mate')) t.unshift('mate');
  if (gain >= 2 && !t.length) t.push('material');
  return t;
}

const round1 = (x) => Math.round(x * 10) / 10;

function stdev(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

// Lichess-style: mean of volatility-weighted mean and harmonic mean.
function gameAccuracy(evals, moves, color) {
  if (evals.some((e) => !e)) return null;
  const wps = evals.map(winPct);
  const n = moves.length;
  const win = Math.max(2, Math.min(8, Math.floor(n / 10)));
  let wSum = 0;
  let wAcc = 0;
  let harm = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (moves[i].color !== color) continue;
    const start = Math.max(0, Math.min(i - Math.floor(win / 2), wps.length - win));
    const weight = Math.max(0.5, Math.min(12, stdev(wps.slice(start, start + win))));
    const loss = color === 'w' ? wps[i] - wps[i + 1] : wps[i + 1] - wps[i];
    const acc = moveAccuracy(Math.max(0, loss));
    wSum += weight;
    wAcc += acc * weight;
    harm += 1 / Math.max(acc, 1);
    count++;
  }
  return count ? round1((wAcc / wSum + count / harm) / 2) : null;
}

// ---------- explanation ----------

// Plain-language explanation of one reviewed move, grounded entirely in the
// engine lines and detected tactics stored in `m`.
export function explainMove(m) {
  if (!m?.cls) return null;
  const { label } = CLASSES[m.cls];
  const out = { title: '', lines: [], advice: null };
  switch (m.cls) {
    case 'book':
      out.title = `${m.san} is a book move`;
      break;
    case 'best':
      out.title = `${m.san} is the engine's top choice`;
      break;
    case 'brilliant':
      out.title = `${m.san} is brilliant`;
      out.lines.push(`It offers ${m.evidence?.sacrificed ?? 'some'} points of material and the position still holds.`);
      break;
    case 'great':
      out.title = `${m.san} is a great move`;
      out.lines.push(`The next best move was ${m.evidence?.onlyMove}% worse in win chance — this was the only good option.`);
      break;
    case 'excellent':
    case 'good':
      out.title = `${m.san} is ${m.cls === 'excellent' ? 'an excellent' : 'a good'} move`;
      if (m.bestSan && m.bestSan !== m.san) out.lines.push(`${m.bestSan} was slightly stronger.`);
      break;
    default:
      out.title = `${m.san} is ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;
      out.lines.push(`Win chance ${Math.round(m.wpBefore)}% → ${Math.round(m.wpAfter)}%.`);
      if (m.allowed?.line?.length) {
        const why = m.allowed.notes.length ? ` — ${m.allowed.notes.join('; ')}` : '';
        out.lines.push(`It allows ${m.allowed.line.slice(0, 3).join(' ')}${why}.`);
      }
      if (m.cls === 'miss' || (m.opportunity && !m.opportunity.found)) {
        const why = m.opportunity?.notes?.length ? ` — ${m.opportunity.notes.join('; ')}` : '';
        out.lines.push(`You missed ${m.bestSan}${why}.`);
      } else if (m.bestSan) out.lines.push(`Best was ${m.bestSan}.`);
      const theme = m.allowed?.themes?.[0] || m.opportunity?.themes?.[0];
      if (theme) out.advice = THEMES[theme]?.advice;
  }
  if (m.opportunity?.found && !ERROR_CLASSES.has(m.cls)) {
    out.lines.push(`You found the tactic${m.opportunity.notes.length ? `: ${m.opportunity.notes[0]}` : ''}.`);
  }
  return out;
}
