import { useState } from 'react';

// Small SVG line chart. points: [{ x: number, y: number|null, label: string }]
export default function LineChart({ points, height = 170, format = (v) => v, xLabel = (p) => p.label, color = 'var(--accent)', domain }) {
  const [hover, setHover] = useState(null);
  const pts = points.filter((p) => p.y !== null && p.y !== undefined);
  if (pts.length < 2) return <div className="muted small chart-empty">Not enough data yet.</div>;
  const W = 800;
  const H = height;
  const PAD = { l: 44, r: 14, t: 14, b: 24 };
  const x0 = pts[0].x;
  const x1 = pts.at(-1).x === x0 ? x0 + 1 : pts.at(-1).x;
  const ys = pts.map((p) => p.y);
  let [lo, hi] = domain || [Math.min(...ys), Math.max(...ys)];
  if (!domain) {
    const pad = Math.max(1, (hi - lo) * 0.12);
    lo -= pad;
    hi += pad;
  }
  const X = (x) => PAD.l + ((x - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const Y = (y) => PAD.t + (1 - (y - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const ticks = [0, 0.5, 1].map((f) => lo + f * (hi - lo));

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => Math.abs(X(p.x) - px) < Math.abs(X(pts[best].x) - px) && (best = i));
    setHover(best);
  };
  const hp = hover !== null ? pts[hover] : null;
  const gid = `g${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} className="grid" />
          <text x={PAD.l - 8} y={Y(t) + 4} textAnchor="end" className="axis">
            {format(Math.round(t * 10) / 10)}
          </text>
        </g>
      ))}
      <text x={PAD.l} y={H - 6} className="axis">
        {xLabel(pts[0])}
      </text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" className="axis">
        {xLabel(pts.at(-1))}
      </text>
      <path d={`${d}L${X(pts.at(-1).x)},${H - PAD.b}L${X(x0)},${H - PAD.b}Z`} fill={`url(#${gid})`} />
      <path d={d} className="line" style={{ stroke: color }} />
      {hp && (
        <g>
          <line x1={X(hp.x)} x2={X(hp.x)} y1={PAD.t} y2={H - PAD.b} className="cursor" />
          <circle cx={X(hp.x)} cy={Y(hp.y)} r={4.5} style={{ fill: color }} />
          <text x={Math.min(Math.max(X(hp.x) + 10, PAD.l), W - 170)} y={PAD.t + 12} className="tip">
            {format(hp.y)} · {xLabel(hp)}
          </text>
        </g>
      )}
    </svg>
  );
}
