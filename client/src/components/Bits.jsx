import { CLASSES, THEMES } from '../../../shared/review.js';

export function Badge({ cls, size = 'md' }) {
  const c = CLASSES[cls];
  if (!c) return null;
  return (
    <span className={`badge badge-${size} b-${cls}`} style={{ '--c': c.color }} title={c.label}>
      {ICONS[cls] || c.symbol}
    </span>
  );
}

// Chess.com-style glyphs for the non-punctuation classes (emoji render inconsistently).
const svg = (d, fill = true) => (
  <svg viewBox="0 0 24 24" width="62%" height="62%" aria-hidden="true">
    <path d={d} fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ICONS = {
  best: svg('M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.9l-6.4 3.5L7 14.3l-5.3-5 7.2-.9z'),
  excellent: svg('M2 10h4v12H2zM8 21V10l5-8c1.6 0 2.6 1.2 2.3 2.8L14.5 9H21c1.2 0 2 1 1.8 2.2l-1.6 8.2c-.2 1-1 1.6-2 1.6z'),
  good: svg('M5 12.5l4.5 4.5L19 7.5', false),
  book: svg('M3 4.5C5.8 3.6 8.8 3.8 11 5.4V20c-2.2-1.5-5.2-1.7-8-.8zM21 4.5c-2.8-.9-5.8-.7-8 .9V20c2.2-1.5 5.2-1.7 8-.8z'),
  miss: svg('M6 6l12 12M18 6L6 18', false),
};

export function TimeClassSelect({ value, onChange }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All time controls</option>
      <option value="rapid">Rapid</option>
      <option value="blitz">Blitz</option>
      <option value="bullet">Bullet</option>
      <option value="daily">Daily</option>
    </select>
  );
}

export const themeLabel = (t) => THEMES[t]?.label || t;

export function Meter({ value, max = 100, tone }) {
  const v = value ?? 0;
  const t = tone || (v >= 85 ? 'good' : v >= 70 ? 'ok' : 'bad');
  return (
    <div className={`meter meter-${t}`}>
      <div style={{ width: `${Math.max(2, Math.min(100, (100 * v) / max))}%` }} />
    </div>
  );
}

export function GameLink({ ex, children }) {
  return (
    <a className="game-link" href={`#/game/${ex.uuid}/${ex.ply}`}>
      {children}
    </a>
  );
}

export const moveLabel = (ply, san) => `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '…'} ${san}`;

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
