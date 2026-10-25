import { useEffect, useRef } from 'react';
import { Badge } from '../Bits.jsx';

const fmtClock = (s) => {
  if (s === null || s === undefined) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
export { fmtClock };

// Compact two-column move list. moves: [{ san, cls?, clock? }] in ply order.
export default function MoveList({ moves, ply, onSelect, startMove = 1, blackFirst = false, result }) {
  const ref = useRef(null);
  useEffect(() => {
    const box = ref.current;
    const el = box?.querySelector('.mv.current');
    if (!el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 10 || top > box.scrollTop + box.clientHeight - 40) box.scrollTop = top - box.clientHeight / 2;
  }, [ply]);

  const cells = blackFirst ? [null, ...moves.map((m, i) => ({ m, i }))] : moves.map((m, i) => ({ m, i }));
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([cells[i], cells[i + 1]]);

  const cell = (c) => {
    if (!c) return <span className="mv empty" />;
    const { m, i } = c;
    return (
      <button className={`mv ${i + 1 === ply ? 'current' : ''} ${m.cls ? `c-${m.cls}` : ''}`} onClick={() => onSelect(i + 1)}>
        <span className="mv-badge">{m.cls && m.cls !== 'best' && m.cls !== 'excellent' && m.cls !== 'good' ? <Badge cls={m.cls} size="xs" /> : null}</span>
        <span className="mv-san">{m.san}</span>
        {m.clock !== undefined && m.clock !== null && <span className="clk">{fmtClock(m.clock)}</span>}
      </button>
    );
  };

  return (
    <div className="move-list" ref={ref}>
      {rows.map(([w, b], r) => (
        <div key={r} className="mrow">
          <span className="mno">{startMove + r}</span>
          {cell(w)}
          {cell(b)}
        </div>
      ))}
      {result && <div className="result">{result}</div>}
    </div>
  );
}
