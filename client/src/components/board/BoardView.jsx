import { useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import { winPct, formatEval, CLASSES } from '../../../../shared/review.js';
import { Badge } from '../Bits.jsx';

const BOARD = {
  light: { backgroundColor: '#dfe3e8' },
  dark: { backgroundColor: '#7389a3' },
};

// Board + eval bar + classification badge on the destination square.
// Moves work like Chess.com: drag a piece, or click it and then click a target;
// legal targets are marked and promotions ask which piece to take.
export default function BoardView({ fen, orientation, arrows = [], lastMove, cls, evaluation, hideEval, onMove, canDrag = true, top, bottom }) {
  const [selected, setSelected] = useState(null);
  const [promotion, setPromotion] = useState(null); // { from, to, color }
  useEffect(() => {
    setSelected(null);
    setPromotion(null);
  }, [fen]);
  const chess = useMemo(() => new Chess(fen), [fen]);
  const turn = chess.turn();
  const targets = useMemo(() => (selected ? chess.moves({ square: selected, verbose: true }) : []), [chess, selected]);
  const movable = (square) => !!onMove && canDrag && chess.get(square)?.color === turn;

  // Returns true if the move was played.
  const attempt = (from, to) => {
    const legal = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    setSelected(null);
    if (!legal.length) return false;
    if (legal[0].promotion) {
      setPromotion({ from, to, color: turn });
      return false;
    }
    return onMove(from + to) !== false;
  };

  const onSquareClick = ({ square }) => {
    if (!onMove || promotion) return setPromotion(null);
    if (selected && targets.some((m) => m.to === square)) return attempt(selected, square);
    setSelected(movable(square) && square !== selected ? square : null);
  };

  const highlight = cls ? CLASSES[cls].color : '#f2a93b';
  const squareStyles = {};
  if (lastMove) {
    squareStyles[lastMove.from] = { background: `color-mix(in srgb, ${highlight} 38%, transparent)` };
    squareStyles[lastMove.to] = { background: `color-mix(in srgb, ${highlight} 55%, transparent)` };
  }
  if (selected) squareStyles[selected] = { background: 'rgba(255, 255, 51, 0.5)' };
  for (const m of targets) {
    squareStyles[m.to] = {
      ...squareStyles[m.to],
      backgroundImage: m.captured
        ? 'radial-gradient(circle, transparent 58%, rgba(0, 0, 0, 0.22) 60%, rgba(0, 0, 0, 0.22) 78%, transparent 80%)'
        : 'radial-gradient(circle, rgba(0, 0, 0, 0.2) 18%, transparent 20%)',
      cursor: 'pointer',
    };
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
              onSquareClick,
              onPieceDrag: ({ square }) => movable(square) && setSelected(square),
              onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare && targetSquare !== sourceSquare ? attempt(sourceSquare, targetSquare) : false),
              canDragPiece: ({ square }) => movable(square),
              allowDragging: !!onMove && canDrag,
              allowDrawingArrows: true,
              clearArrowsOnPositionChange: true,
              animationDurationInMs: 150,
              darkSquareStyle: BOARD.dark,
              lightSquareStyle: BOARD.light,
              darkSquareNotationStyle: { color: '#dfe3e8', fontWeight: 600 },
              lightSquareNotationStyle: { color: '#7389a3', fontWeight: 600 },
            }}
          />
          {cls && lastMove && !promotion && <SquareBadge square={lastMove.to} cls={cls} orientation={orientation} />}
          {promotion && (
            <PromotionPicker
              {...promotion}
              orientation={orientation}
              onPick={(p) => {
                setPromotion(null);
                onMove(promotion.from + promotion.to + p);
              }}
            />
          )}
        </div>
      </div>
      {bottom}
    </div>
  );
}

// Column of Q/R/B/N on the promotion square, extending into the board.
function PromotionPicker({ to, color, orientation, onPick }) {
  const file = to.charCodeAt(0) - 97;
  const col = orientation === 'white' ? file : 7 - file;
  const fromTop = (orientation === 'white') === (color === 'w');
  return (
    <div className="promo" style={{ left: `${col * 12.5}%`, [fromTop ? 'top' : 'bottom']: 0, flexDirection: fromTop ? 'column' : 'column-reverse' }}>
      {['q', 'r', 'b', 'n'].map((p) => (
        <button key={p} className="promo-piece" onClick={() => onPick(p)} title={{ q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[p]}>
          {defaultPieces[color + p.toUpperCase()]()}
        </button>
      ))}
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
