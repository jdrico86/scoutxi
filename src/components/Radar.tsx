/**
 * Radar de percentis por métrica, com uma ou mais séries sobrepostas.
 *
 * Usado na ficha do jogador (época actual e épocas sobrepostas) e na página
 * de comparação (dois jogadores). Um eixo por métrica; os eixos são os da
 * primeira série.
 */

export type RadarPoint = { metric_code: string; percentile: number | null };

export type RadarSeries = {
  label: string;
  color: string;
  contributions: RadarPoint[];
  /** Contorno tracejado e sem preenchimento: épocas sobrepostas à actual. */
  dashed?: boolean;
};

/** Parte um nome de métrica em até duas linhas, para caber ao lado do radar. */
export function wrapLabel(text: string, max = 20): string[] {
  if (text.length <= max) return [text];
  const words = text.split(' ');
  let first = '';
  while (words.length > 1 && (first + ' ' + words[0]).trim().length <= max) {
    first = (first + ' ' + words.shift()).trim();
  }
  if (!first) first = words.shift() ?? '';
  const rest = words.join(' ');
  return [first, rest.length > max + 4 ? `${rest.slice(0, max + 3)}…` : rest].filter(Boolean);
}

export function Radar({ series, labels = {} }: { series: RadarSeries[]; labels?: Record<string, string> }) {
  const size = 460;
  const center = size / 2;
  const radius = size / 2 - 110;

  if (series.length === 0) return null;
  const baseMetrics = series[0].contributions.map((c) => c.metric_code);
  const n = baseMetrics.length;
  if (n === 0) return null;

  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const ringLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="mx-auto max-w-lg">
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap justify-center gap-4">
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span
                className="inline-block h-0 w-5 border-t-2"
                style={{ borderColor: s.color, borderTopStyle: s.dashed ? 'dashed' : 'solid' }}
              />
              <span className="text-xs text-neutral-700">{s.label}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${size} ${size}`} className="block" style={{ maxWidth: '100%', height: 'auto' }}>
        {ringLevels.map((level) => {
          const pts = Array.from({ length: n }, (_, i) => {
            const angle = angleAt(i);
            const r = level * radius;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          }).join(' ');
          return <polygon key={level} points={pts} fill="none" stroke="#e5e5e5" strokeWidth={1} />;
        })}

        {baseMetrics.map((_, i) => {
          const angle = angleAt(i);
          return (
            <line
              key={`axis-${i}`}
              x1={center}
              y1={center}
              x2={center + radius * Math.cos(angle)}
              y2={center + radius * Math.sin(angle)}
              stroke="#e5e5e5"
              strokeWidth={1}
            />
          );
        })}

        {series.map((s) => {
          const byMetric = new Map(s.contributions.map((c) => [c.metric_code, c]));
          const points = baseMetrics.map((code, i) => {
            const c = byMetric.get(code);
            const pct = c?.percentile ?? 0;
            const angle = angleAt(i);
            const r = (pct / 100) * radius;
            return {
              x: center + r * Math.cos(angle),
              y: center + r * Math.sin(angle),
            };
          });
          const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ') + ' Z';
          return (
            <g key={s.label}>
              <path
                d={pathD}
                fill={s.dashed ? 'none' : s.color}
                fillOpacity={series.length > 1 ? 0.18 : 0.22}
                stroke={s.color}
                strokeWidth={2}
                strokeDasharray={s.dashed ? '6 4' : undefined}
              />
              {points.map((p, i) => (
                <circle key={`dot-${s.label}-${i}`} cx={p.x} cy={p.y} r={3} fill={s.color} />
              ))}
            </g>
          );
        })}

        {baseMetrics.map((code, i) => {
          const angle = angleAt(i);
          const labelX = center + (radius + 22) * Math.cos(angle);
          const labelY = center + (radius + 22) * Math.sin(angle);
          let anchor: 'start' | 'middle' | 'end' = 'middle';
          if (labelX < center - 10) anchor = 'end';
          else if (labelX > center + 10) anchor = 'start';

          const named = labels[code];
          const lines = wrapLabel(named ?? code, named ? 20 : 40);
          const percentiles = series
            .map((s) => s.contributions.find((c) => c.metric_code === code)?.percentile ?? null)
            .map((v) => (v == null ? '—' : v.toFixed(0)));

          return (
            <g key={`label-${i}`}>
              {lines.map((line, li) => (
                <text
                  key={li}
                  x={labelX}
                  y={labelY - 6 - (lines.length - 1 - li) * 11}
                  textAnchor={anchor}
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="#525252"
                  fontFamily={named ? undefined : 'monospace'}
                >
                  {line}
                </text>
              ))}
              <text
                x={labelX}
                y={labelY + 7}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={9}
                fill="#a3a3a3"
              >
                {percentiles.join(' / ')}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
