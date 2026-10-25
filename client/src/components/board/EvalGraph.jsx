import { winPct, CLASSES } from '../../../../shared/review.js';

const W = 600;
const H = 100;
const MARKED = new Set(['brilliant', 'great', 'miss', 'mistake', 'blunder']);

// Win-probability area chart; click to jump to a move.
export default function EvalGraph({ evals, moves, ply, onSelect }) {
  const n = evals.length - 1;
  if (n < 1) return null;
  const x = (i) => (i / n) * W;
  const y = (i) => H - (winPct(evals[i]) / 100) * H;
  let path = `M0,${H}`;
  for (let i = 0; i <= n; i++) path += `L${x(i).toFixed(1)},${y(i).toFixed(1)}`;
  path += `L${W},${H}Z`;
  return (
    <svg
      className="eval-graph"
      viewBox={`0 0 ${W} ${H}`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSelect(Math.round(((e.clientX - r.left) / r.width) * n));
      }}
    >
      <rect width={W} height={H} className="eg-bg" />
      <path d={path} className="eg-white" />
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="eg-mid" />
      <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} className="eg-cursor" />
      {moves.map((m, i) => (m && MARKED.has(m.cls) ? <circle key={i} cx={x(i + 1)} cy={y(i + 1)} r={4} fill={CLASSES[m.cls].color} className="eg-dot" /> : null))}
    </svg>
  );
}
