// Board-geometry tactic detectors. Stockfish tells us *that* a line wins;
// these explain *why* (fork, pin, skewer, discovered attack, hanging piece).
import { Chess } from 'chess.js';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
export const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const THEMES = {
  mate: { label: 'Checkmate', advice: 'Look at every check first — forcing moves can end the game.' },
  fork: { label: 'Fork', advice: 'Check for squares where one enemy piece (often a knight or queen) can attack two of yours at once.' },
  pin: { label: 'Pin', advice: 'Watch lines between your pieces and your king or queen — a piece in front of them may not be able to move.' },
  skewer: { label: 'Skewer', advice: 'Keep your king and queen off open lines where a long-range piece can hit them and the piece behind.' },
  discovered: { label: 'Discovered attack', advice: 'When a piece moves out of a line, check what the piece behind it now attacks.' },
  hanging: { label: 'Hanging piece', advice: 'Before each move, check which of your pieces are attacked and not defended.' },
  material: { label: 'Winning material', advice: 'Scan captures and threats for both sides before deciding — look for loose pieces.' },
  promotion: { label: 'Promotion', advice: 'Count how many moves passed pawns need to promote — for both sides.' },
};

const FILES = 'abcdefgh';
const DIRS = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};
DIRS.q = [...DIRS.b, ...DIRS.r];

const other = (c) => (c === 'w' ? 'b' : 'w');
export const pieceLabel = (type, sq) => `${PIECE_NAME[type]}${sq ? ` on ${sq}` : ''}`;

function pieces(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && (!color || p.color === color)) out.push({ sq: p.square, type: p.type, color: p.color });
  return out;
}

export function material(chess, color) {
  return pieces(chess, color).reduce((s, p) => s + (p.type === 'k' ? 0 : VALUE[p.type]), 0);
}
export const materialDiff = (chess, color) => material(chess, color) - material(chess, other(color));

// Enemy pieces attacked by the piece standing on `sq`.
function attackedBy(chess, sq, color) {
  return pieces(chess, other(color)).filter((t) => chess.attackers(t.sq, color).includes(sq));
}

// Pieces of `color` that the opponent can win: undefended, or attacked by something cheaper.
export function hangingPieces(chess, color) {
  const out = [];
  for (const p of pieces(chess, color)) {
    if (p.type === 'k') continue;
    const att = chess.attackers(p.sq, other(color));
    if (!att.length) continue;
    const cheapest = Math.min(...att.map((s) => VALUE[chess.get(s).type]));
    const defended = chess.attackers(p.sq, color).length > 0;
    const loss = defended ? VALUE[p.type] - cheapest : VALUE[p.type];
    if (loss >= 2) out.push({ ...p, loss });
  }
  return out;
}

// Sliding-piece lines: first enemy piece hit, and the piece right behind it.
function lines(chess, color) {
  const out = [];
  for (const s of pieces(chess, color)) {
    if (!DIRS[s.type]) continue;
    const f0 = FILES.indexOf(s.sq[0]);
    const r0 = Number(s.sq[1]);
    for (const [df, dr] of DIRS[s.type]) {
      const hits = [];
      for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 1 && r <= 8 && hits.length < 2; f += df, r += dr) {
        const sq = FILES[f] + r;
        const p = chess.get(sq);
        if (p) hits.push({ sq, type: p.type, color: p.color });
      }
      if (hits.length === 2 && hits[0].color !== color && hits[1].color !== color) out.push({ by: s, front: hits[0], back: hits[1] });
    }
  }
  return out;
}

function pinsAndSkewers(chess, color) {
  const out = [];
  for (const { by, front, back } of lines(chess, color)) {
    if (VALUE[back.type] > VALUE[front.type] && front.type !== 'p') {
      out.push({ type: 'pin', by, front, back, key: `pin:${by.sq}:${front.sq}:${back.sq}` });
    } else if (VALUE[front.type] > VALUE[back.type] && VALUE[front.type] >= 5 && VALUE[back.type] >= 3 && VALUE[front.type] > VALUE[by.type]) {
      out.push({ type: 'skewer', by, front, back, key: `skewer:${by.sq}:${front.sq}:${back.sq}` });
    }
  }
  return out;
}

// Tactics created by a single verbose chess.js move.
export function detectTactics(move) {
  const before = new Chess(move.before);
  const after = new Chess(move.after);
  const me = move.color;
  const opp = other(me);
  const out = [];

  if (after.isCheckmate()) out.push({ type: 'mate', text: `${move.san} is checkmate` });
  if (move.promotion) out.push({ type: 'promotion', text: `${move.san} promotes to a ${PIECE_NAME[move.promotion]}` });

  // Fork: the moved piece hits two valuable or loose targets.
  const targets = attackedBy(after, move.to, me).filter(
    (t) => t.type === 'k' || VALUE[t.type] > VALUE[move.piece] || (VALUE[t.type] >= 3 && !after.attackers(t.sq, opp).length),
  );
  const moverLoose = after.attackers(move.to, opp).length > 0 && !after.attackers(move.to, me).length;
  if (targets.length >= 2 && (!moverLoose || targets.some((t) => t.type === 'k'))) {
    const names = targets.slice(0, 3).map((t) => PIECE_NAME[t.type]);
    out.push({ type: 'fork', text: `${move.san} forks the ${names.join(' and ')}`, sq: move.to });
  }

  // New pins / skewers.
  const old = new Set(pinsAndSkewers(before, me).map((x) => x.key));
  for (const x of pinsAndSkewers(after, me)) {
    if (old.has(x.key)) continue;
    out.push(
      x.type === 'pin'
        ? { type: 'pin', text: `${move.san} pins the ${pieceLabel(x.front.type, x.front.sq)} to the ${PIECE_NAME[x.back.type]}` }
        : { type: 'skewer', text: `${move.san} skewers the ${PIECE_NAME[x.front.type]} and the ${pieceLabel(x.back.type, x.back.sq)}` },
    );
  }

  // Discovered attack: another of my long-range pieces now hits something.
  for (const s of pieces(after, me)) {
    if (!DIRS[s.type] || s.sq === move.to) continue;
    const now = attackedBy(after, s.sq, me).filter((t) => t.type === 'k' || VALUE[t.type] >= 3);
    const was = new Set(attackedBy(before, s.sq, me).map((t) => t.sq));
    const fresh = now.filter((t) => !was.has(t.sq));
    if (fresh.length) {
      const t = fresh.find((x) => x.type === 'k') || fresh[0];
      out.push({
        type: 'discovered',
        text: t.type === 'k' ? `${move.san} gives a discovered check` : `${move.san} uncovers an attack on the ${pieceLabel(t.type, t.sq)}`,
      });
      break;
    }
  }
  return out;
}

// Plays `pv` from `fen` (up to `maxPlies`) and reports the tactics the side
// to move uses, plus the material swing and whether the line mates.
export function lineThemes(fen, pv, maxPlies = 4) {
  const chess = new Chess(fen);
  const me = chess.turn();
  const start = materialDiff(chess, me);
  const tactics = [];
  const sans = [];
  for (let k = 0; k < Math.min(pv.length, maxPlies); k++) {
    let m;
    try {
      m = chess.move({ from: pv[k].slice(0, 2), to: pv[k].slice(2, 4), promotion: pv[k][4] });
    } catch {
      break;
    }
    sans.push(m.san);
    if (m.color === me) tactics.push(...detectTactics(m));
  }
  return {
    tactics,
    sans,
    gain: materialDiff(chess, me) - start,
    mates: chess.isCheckmate() && chess.turn() !== me,
  };
}
