// Checks a FEN before it reaches Stockfish, which refuses some positions
// outright (e.g. the side not to move in check) and then exits.
import { Chess } from 'chess.js';

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
