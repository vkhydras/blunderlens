import { Chess } from 'chess.js';
import { positionProblem } from '../../../shared/legal.js';
import { imageToFen, withTurn } from './boardImage.js';

export const START = new Chess().fen();
export const BAD_INPUT = 'Not a valid FEN or PGN.';
export const isFen = (text) => /^[rnbqkpRNBQKP1-8/]+ [wb] /.test(text);

// A pasted FEN or PGN: the start position and the moves played from it.
// Throws an Error with a message that can be shown as is.
export function parsePosition(text) {
  if (isFen(text)) {
    const problem = positionProblem(text);
    if (problem) throw new Error(`Can't analyse this position: ${problem}. Fix it and press Load.`);
    return { startFen: text, moves: [] };
  }
  const c = new Chess();
  try {
    c.loadPgn(text);
  } catch {
    throw new Error(BAD_INPUT);
  }
  const hist = c.history({ verbose: true });
  return {
    startFen: hist[0]?.before || c.fen(),
    moves: hist.map((h) => ({ san: h.san, uci: h.from + h.to + (h.promotion || ''), from: h.from, to: h.to, fen: h.after })),
  };
}

// The same position with the other side to move. Castling and en passant
// rights can't carry over, so they are dropped.
export const changeTurn = (fen, turn) => withTurn(fen, turn).replace(/ (\S+) (\d+) (\d+)$/, ' - $2 $3');

// The image in a paste event, if there is one.
export const pastedImage = (e) => [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();

// Reads a board screenshot. A screenshot doesn't say whose turn it is: if one
// king is in check, that side must be to move; otherwise the side at the bottom.
export async function readScreenshot(file) {
  let { fen, flipped } = await imageToFen(file);
  const bottom = flipped ? 'b' : 'w';
  fen = withTurn(fen, bottom);
  if (positionProblem(fen)) fen = withTurn(fen, bottom === 'w' ? 'b' : 'w');
  return { fen, flipped };
}
