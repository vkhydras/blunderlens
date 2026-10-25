import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAsync } from '../../lib/hooks.js';
import { TimeClassSelect, Empty } from '../Bits.jsx';
import LineChart from '../LineChart.jsx';

const SERIES = [
  ['acc', 'Accuracy', (v) => `${v}%`, 'var(--accent)'],
  ['errorsPerGame', 'Serious errors per game', (v) => v, 'var(--bad)'],
  ['tacticsPct', 'Tactics found', (v) => `${v}%`, 'var(--accent-2)'],
  ['score', 'Score', (v) => `${v}%`, 'var(--good)'],
];

export default function ProgressTab({ username, version }) {
  const [tc, setTc] = useState('all');
  const { data } = useAsync(() => api.progress(username, tc), [username, tc, version]);
  if (!data) return <div className="muted pad">Loading…</div>;
  if (data.buckets.length < 2) return <Empty>Progress needs analyzed games spread over at least two {data.unit || 'week'}s.</Empty>;
  return (
    <div>
      <div className="toolbar">
        <TimeClassSelect value={tc} onChange={setTc} />
        <span className="muted small">Per {data.unit}, analyzed games only.</span>
      </div>
      <div className="grid-2">
        {SERIES.map(([key, label, fmt, color]) => (
          <section key={key} className="panel">
            <h3>{label}</h3>
            <LineChart color={color} format={fmt} points={data.buckets.map((b, i) => ({ x: i, y: b[key], label: `${b.label} (${b.games} g)` }))} />
          </section>
        ))}
      </div>
    </div>
  );
}
