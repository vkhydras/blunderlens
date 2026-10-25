import { Chessboard } from 'react-chessboard';
import { winPct, formatEval, CLASSES } from '../../../../shared/review.js';
import { Badge } from '../Bits.jsx';

const BOARD = {
  light: { backgroundColor: '#dfe3e8' },
  dark: { backgroundColor: '#7389a3' },
};

// Board + eval bar + classification badge on the destination square.
export default function BoardView({ fen, orientation, arrows = [], lastMove, cls, evaluation, hideEval, onDrop, canDrag = true, top, bottom }) {
  const highlight = cls ? CLASSES[cls].color : '#f2a93b';
  const squareStyles = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: `color-mix(in srgb, ${highlight} 38%, transparent)` };
    squareStyles[lastMove.to] = { background: `color-mix(in srgb, ${highlight} 55%, transparent)` };
  }
  return (
    <div className="board-stack">
      {top}
      <div className="board-row">
        <EvalBar evaluation={hideEval ? null : evaluation} orientation={orientation} hidden={hideEval} />
        <div className="board-wrap">
          <Chessboard
            options={{
              id: 'main',
              position: fen,
              boardOrientation: orientation,
              arrows,
              squareStyles,
              onPieceDrop: onDrop,
              allowDragging: canDrag,
              allowDrawingArrows: true,
              clearArrowsOnPositionChange: true,
              animationDurationInMs: 150,
              darkSquareStyle: BOARD.dark,
              lightSquareStyle: BOARD.light,
              darkSquareNotationStyle: { color: '#dfe3e8', fontWeight: 600 },
              lightSquareNotationStyle: { color: '#7389a3', fontWeight: 600 },
            }}
          />
          {cls && lastMove && <SquareBadge square={lastMove.to} cls={cls} orientation={orientation} />}
        </div>
      </div>
      {bottom}
    </div>
  );
}

function SquareBadge({ square, cls, orientation }) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]);
  const col = orientation === 'white' ? file : 7 - file;
  const row = orientation === 'white' ? 8 - rank : rank - 1;
  return (
    <div className="square-badge" style={{ left: `calc(${(col + 1) * 12.5}% - 15px)`, top: `calc(${row * 12.5}% - 9px)` }}>
      <Badge cls={cls} />
    </div>
  );
}

export function EvalBar({ evaluation, orientation, hidden }) {
  const wp = evaluation ? winPct(evaluation) : 50;
  const white = Math.max(4, Math.min(96, wp));
  const label = hidden ? '?' : evaluation ? formatEval(evaluation).replace(/^\+/, '') : '';
  return (
    <div className={`eval-bar ${orientation === 'black' ? 'flipped' : ''}`}>
      <div className="eval-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${wp >= 50 ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}

export function PlayerBar({ name, rating, clock, color, active, extra }) {
  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <span className={`piece-dot ${color}`} />
      <span className="pname">{name}</span>
      {rating && <span className="muted">{rating}</span>}
      {extra}
      {clock && <span className="clock">{clock}</span>}
    </div>
  );
}
