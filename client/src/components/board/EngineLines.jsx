import { Chess } from 'chess.js';
import { pvToSan, formatEval, winPct } from '../../../../shared/review.js';

export default function EngineLines({ fen, live, onPlay, engineName = 'Stockfish 19', hidden }) {
  const chess = new Chess(fen);
  if (hidden) return <section className="engine panel-tight muted small">Engine hidden while you retry.</section>;
  if (chess.isGameOver()) return <section className="engine panel-tight muted">{chess.isCheckmate() ? 'Checkmate' : 'Draw'}</section>;
  const lines = live?.result?.lines || [];
  return (
    <section className="engine panel-tight">
      <div className="engine-head">
        <span>{engineName}</span>
        <span className="muted small">{live ? `depth ${live.result.depth}${live.finished ? '' : '…'}` : 'thinking…'}</span>
      </div>
      {[0, 1, 2].map((i) => {
        const l = lines[i];
        if (!l) return <div key={i} className="pv pv-empty" />;
        const e = { cp: l.cp, mate: l.mate };
        return (
          <button key={i} className="pv" onClick={() => onPlay(l.pv[0])} title="Play this move">
            <span className={`pv-eval ${winPct(e) >= 50 ? 'w' : 'b'}`}>{formatEval(e)}</span>
            <span className="pv-moves">
              {pvToSan(fen, l.pv, 10).map((m, j) => (
                <span key={j}>
                  {m.color === 'w' ? `${m.moveNumber}. ` : j === 0 ? `${m.moveNumber}… ` : ''}
                  {m.san}{' '}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </section>
  );
}
