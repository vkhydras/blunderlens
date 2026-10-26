// Checks a FEN before it reaches Stockfish, which refuses some positions
// outright (e.g. the side not to move in check) and then exits.
import { Chess } from 'chess.js';

const START_COUNT = { q: 1, r: 2, b: 2, n: 2 };

// Pieces beyond the starting set must come from promotions, one per missing
// pawn; Stockfish refuses anything else ("Too many pieces").
// `types` is one side's piece letters; null if that material is possible.
export function materialProblem(types) {
  const count = (t) => types.filter((x) => x === t).length;
  const pawns = count('p');
  if (pawns > 8) return 'more than 8 pawns';
  const extra = Object.entries(START_COUNT).reduce((s, [t, n]) => s + Math.max(0, count(t) - n), 0);
  if (extra > 8 - pawns) return 'more pieces than promotions allow';
  return null;
}

// null if the position is fine, otherwise a short reason.
export function positionProblem(fen) {
  let c;
  try {
    c = new Chess(fen);
  } catch (e) {
    return e.message.replace(/^Invalid FEN: /, '');
  }
  const board = c.board().flat().filter(Boolean);
  for (const color of ['w', 'b']) {
    const kings = board.filter((p) => p.type === 'k' && p.color === color).length;
    if (kings !== 1) return `${color === 'w' ? 'White' : 'Black'} needs exactly one king`;
    const problem = materialProblem(board.filter((p) => p.color === color).map((p) => p.type));
    if (problem) return `${color === 'w' ? 'White' : 'Black'} has ${problem}`;
  }
  // The side that just moved can't have left its own king in check.
  const swapped = fen.split(' ');
  swapped[1] = swapped[1] === 'w' ? 'b' : 'w';
  swapped[3] = '-';
  try {
    if (new Chess(swapped.join(' ')).inCheck()) return `${swapped[1] === 'w' ? 'White' : 'Black'} is in check, so it must be ${swapped[1] === 'w' ? 'White' : 'Black'} to move`;
  } catch {}
  return null;
}
