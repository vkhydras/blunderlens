import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { parsePosition, isFen, changeTurn, pastedImage, readScreenshot } from '../lib/position.js';
import { positionProblem } from '../../../shared/legal.js';

// Home's "open a position on the board" box: a FEN, PGN or pasted screenshot.
// Local-only; the web build swaps it out, so online is game review only.
export default function PositionBox() {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [orientation, setOrientation] = useState('white');

  // Paste a screenshot (Ctrl+V anywhere on this page): read the board from it.
  useEffect(() => {
    const onPaste = async (e) => {
      const file = pastedImage(e);
      if (!file) return;
      e.preventDefault();
      setError('');
      setReading(true);
      try {
        const { fen, flipped } = await readScreenshot(file);
        setText(fen);
        setOrientation(flipped ? 'black' : 'white');
      } catch (err) {
        setError(err.message);
      } finally {
        setReading(false);
      }
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, []);

  const input = text.trim();
  const turn = isFen(input) ? input.split(' ')[1] : null;
  const setTurn = (t) => {
    const next = changeTurn(input, t);
    const problem = positionProblem(next);
    if (problem) return setError(`${problem}.`);
    setError('');
    setText(next);
  };

  // Hands the position to the board page, which reads it on load.
  const openBoard = () => {
    try {
      const { startFen, moves } = parsePosition(input);
      localStorage.setItem('liveBoard', JSON.stringify({ startFen, moves, orientation }));
      sessionStorage.setItem('boardFromHome', '1');
      location.hash = '#/board';
    } catch (e) {
      setError(e.message);
    }
  };
  const review = async () => {
    try {
      const { uuid } = await api.importPgn(input);
      location.hash = `#/game/${uuid}`;
    } catch {
      setError('Not a valid PGN.');
    }
  };

  return (
  <details className="panel pgn-box">
    <summary>Open a position or game on the board</summary>
    <p className="muted small">Paste a FEN, a PGN or a screenshot of a board, then play moves for both sides with Stockfish's suggestions.</p>
    <textarea
      rows={6}
      placeholder="Paste a FEN, PGN or a screenshot of a board…"
      value={text}
      onChange={(e) => (setText(e.target.value), setError(''))}
    />
    {reading && <div className="muted small">Reading the board…</div>}
    {error && <div className="error">{error}</div>}
    {turn && (
      <div className="btn-row">
        <span className="muted small">To move:</span>
        {['w', 'b'].map((t) => (
          <button key={t} className={`btn sm ${turn === t ? '' : 'ghost'}`} onClick={() => setTurn(t)}>
            {t === 'w' ? 'White' : 'Black'}
          </button>
        ))}
      </div>
    )}
    <div className="btn-row">
      <button className="btn primary" disabled={!input} onClick={openBoard}>
        Open on board
      </button>
      {input && !turn && (
        <button className="btn" onClick={review}>
          Full review
        </button>
      )}
    </div>
  </details>
  );
}
