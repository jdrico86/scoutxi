'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

type PlayerInfo = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  pool_id: string;
  pool_name: string | null;
};

type MetricRow = {
  metric_code: string;
  label_pt: string;
  category: string;
  direction: string | null;
  unit: string | null;
  anchor: { raw_value: number | null; percentile: number } | null;
  candidate: { raw_value: number | null; percentile: number } | null;
  delta_percentile: number | null;
};

type DetailResponse = {
  anchor: PlayerInfo;
  candidate: PlayerInfo;
  arquetype_position_anchor: string;
  arquetype_position_candidate: string;
  metrics: MetricRow[];
};

const CATEGORY_LABELS: Record<string, string> = {
  offensive: 'Ofensivo',
  defensive: 'Defensivo',
  technical: 'Técnico',
  physical: 'Físico',
  goalkeeping: 'Guarda-redes',
};

const CATEGORY_ORDER = ['offensive', 'defensive', 'technical', 'physical', 'goalkeeping'];

function CompararContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const a = searchParams.get('a');
  const b = searchParams.get('b');

  // Validação dos params via render path — evita setState-in-effect.
  const paramsValid = !!(a && b);
  const paramsError = paramsValid ? null : 'Parâmetros a e b obrigatórios na URL.';

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(paramsValid);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!a || !b) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setFetchError(null);
    fetch(`/api/scout/similarity-detail?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        if (!ok) throw new Error(json.error ?? 'Erro a carregar comparação.');
        setData(json);
      })
      .catch((err) => setFetchError((err as Error).message))
      .finally(() => setLoading(false));
  }, [a, b]);

  const error = paramsError ?? fetchError;

  // Agregar por categoria para o radar (média de percentil dos metrics dessa categoria)
  const radarSeries = useMemo(() => {
    if (!data) return null;
    const byCategory = new Map<string, { sumA: number; sumB: number; n: number }>();
    for (const m of data.metrics) {
      if (m.anchor == null || m.candidate == null) continue;
      const cat = m.category;
      let agg = byCategory.get(cat);
      if (!agg) {
        agg = { sumA: 0, sumB: 0, n: 0 };
        byCategory.set(cat, agg);
      }
      agg.sumA += m.anchor.percentile;
      agg.sumB += m.candidate.percentile;
      agg.n++;
    }
    const axes: Array<{ key: string; label: string; anchor: number; candidate: number }> = [];
    for (const cat of CATEGORY_ORDER) {
      const agg = byCategory.get(cat);
      if (!agg || agg.n === 0) continue;
      axes.push({
        key: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        anchor: agg.sumA / agg.n,
        candidate: agg.sumB / agg.n,
      });
    }
    return axes;
  }, [data]);

  // Ordenar tabela por |delta_percentile| descendente; nulls no fim
  const sortedMetrics = useMemo(() => {
    if (!data) return [];
    return [...data.metrics].sort((x, y) => {
      const dx = x.delta_percentile;
      const dy = y.delta_percentile;
      if (dx == null && dy == null) return 0;
      if (dx == null) return 1;
      if (dy == null) return -1;
      return Math.abs(dy) - Math.abs(dx);
    });
  }, [data]);

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-50 py-10">
        <div className="mx-auto max-w-5xl px-6 text-sm text-neutral-500">A carregar…</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-neutral-50 py-10">
        <div className="mx-auto max-w-5xl px-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-4 flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
            Voltar
          </button>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error ?? 'Erro desconhecido.'}
          </div>
        </div>
      </main>
    );
  }

  const anchorTeam = data.anchor.team_in_period ?? data.anchor.current_team ?? '—';
  const candTeam = data.candidate.team_in_period ?? data.candidate.current_team ?? '—';

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-5xl px-6">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Voltar
        </button>

        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Comparação detalhada</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Percentis calculados dentro do pool de cada jogador (moneyball — magnitudes brutas
            não comparáveis directamente entre pools).
          </p>
        </header>

        {/* Cards dos dois jogadores */}
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <PlayerCard
            player={data.anchor}
            team={anchorTeam}
            position={data.arquetype_position_anchor}
            colorClass="border-neutral-400 bg-neutral-50"
            colorDot="bg-neutral-500"
            label="Âncora"
          />
          <PlayerCard
            player={data.candidate}
            team={candTeam}
            position={data.arquetype_position_candidate}
            colorClass="border-emerald-300 bg-emerald-50/40"
            colorDot="bg-emerald-500"
            label="Candidato"
          />
        </div>

        {/* Radar */}
        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-neutral-900">
            Radar por categoria (média de percentis)
          </h2>
          {radarSeries && radarSeries.length > 0 ? (
            <CategoryRadar
              axes={radarSeries}
              anchorLabel={data.anchor.name}
              candidateLabel={data.candidate.name}
            />
          ) : (
            <p className="mt-4 text-sm text-neutral-500">
              Sem dados suficientes para construir o radar.
            </p>
          )}
        </section>

        {/* Tabela detalhada */}
        <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3">
            <h2 className="text-sm font-semibold text-neutral-900">
              Detalhe por métrica · ordenado por |Δ percentil|
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Métricas do arquétipo <span className="font-mono">{data.arquetype_position_anchor}</span> ({data.metrics.length}).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Métrica</th>
                  <th className="px-4 py-2">Categoria</th>
                  <th className="px-4 py-2 text-right">{shortName(data.anchor.name)} · valor</th>
                  <th className="px-4 py-2 text-right">{shortName(data.anchor.name)} · P</th>
                  <th className="px-4 py-2 text-right">{shortName(data.candidate.name)} · valor</th>
                  <th className="px-4 py-2 text-right">{shortName(data.candidate.name)} · P</th>
                  <th className="px-4 py-2 text-right">Δ P</th>
                </tr>
              </thead>
              <tbody>
                {sortedMetrics.map((m) => (
                  <tr key={m.metric_code} className="border-t border-neutral-100 hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <div className="text-neutral-900">{m.label_pt}</div>
                      <div className="font-mono text-xs text-neutral-400">{m.metric_code}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-500">
                      {CATEGORY_LABELS[m.category] ?? m.category}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-700">
                      {m.anchor?.raw_value != null ? formatVal(m.anchor.raw_value) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {m.anchor != null ? <PercentileCell value={m.anchor.percentile} /> : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-700">
                      {m.candidate?.raw_value != null ? formatVal(m.candidate.raw_value) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {m.candidate != null ? <PercentileCell value={m.candidate.percentile} /> : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {m.delta_percentile == null ? (
                        '—'
                      ) : (
                        <span
                          className={
                            Math.abs(m.delta_percentile) > 20
                              ? m.delta_percentile > 0
                                ? 'font-semibold text-emerald-700'
                                : 'font-semibold text-red-700'
                              : 'text-neutral-500'
                          }
                        >
                          {m.delta_percentile > 0 ? '+' : ''}
                          {m.delta_percentile.toFixed(1)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function PlayerCard({
  player,
  team,
  position,
  colorClass,
  colorDot,
  label,
}: {
  player: PlayerInfo;
  team: string;
  position: string;
  colorClass: string;
  colorDot: string;
  label: string;
}) {
  return (
    <div className={`rounded-lg border ${colorClass} p-4`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${colorDot}`} />
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          {label}
        </span>
      </div>
      <h3 className="mt-1 text-lg font-semibold text-neutral-900">{player.name}</h3>
      <p className="mt-0.5 text-sm text-neutral-700">{team}</p>
      <div className="mt-1 text-xs text-neutral-500">
        {[
          position,
          player.age != null ? `${player.age}a` : null,
          player.minutes_played != null ? `${player.minutes_played.toLocaleString('pt-PT')}min` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
      {player.pool_name && (
        <div className="mt-1 text-xs text-neutral-400">{player.pool_name}</div>
      )}
    </div>
  );
}

function PercentileCell({ value }: { value: number }) {
  return (
    <span
      className={
        value >= 80
          ? 'font-semibold text-emerald-700'
          : value >= 50
            ? 'text-neutral-700'
            : 'text-neutral-400'
      }
    >
      {value.toFixed(1)}
    </span>
  );
}

function shortName(name: string): string {
  const parts = name.split(' ');
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

function formatVal(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

// ── Radar de categorias ─────────────────────────────────────────────────
function CategoryRadar({
  axes,
  anchorLabel,
  candidateLabel,
}: {
  axes: Array<{ key: string; label: string; anchor: number; candidate: number }>;
  anchorLabel: string;
  candidateLabel: string;
}) {
  const size = 380;
  const center = size / 2;
  const radius = size / 2 - 70;
  const n = axes.length;

  if (n < 3) {
    return (
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        {axes.map((a) => (
          <div key={a.key} className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              {a.label}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-neutral-600">{shortName(anchorLabel)}</span>
              <span className="font-semibold text-neutral-900">{a.anchor.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-700">{shortName(candidateLabel)}</span>
              <span className="font-semibold text-emerald-700">{a.candidate.toFixed(1)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const ringLevels = [0.25, 0.5, 0.75, 1.0];

  const buildPath = (values: number[]): string => {
    return values
      .map((v, i) => {
        const angle = angleAt(i);
        const r = (v / 100) * radius;
        const x = center + r * Math.cos(angle);
        const y = center + r * Math.sin(angle);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ') + ' Z';
  };

  const anchorPath = buildPath(axes.map((a) => a.anchor));
  const candidatePath = buildPath(axes.map((a) => a.candidate));

  return (
    <div className="mx-auto mt-3" style={{ maxWidth: size }}>
      <div className="mb-3 flex justify-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-neutral-500" />
          <span className="text-neutral-700">{anchorLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-emerald-700">{candidateLabel}</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" className="block">
        {/* Rings */}
        {ringLevels.map((level) => {
          const pts = Array.from({ length: n }, (_, i) => {
            const angle = angleAt(i);
            const r = level * radius;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          }).join(' ');
          return (
            <polygon
              key={level}
              points={pts}
              fill="none"
              stroke="#e5e5e5"
              strokeWidth={1}
            />
          );
        })}
        {/* Axis lines */}
        {axes.map((_, i) => {
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
        {/* Anchor polygon */}
        <path d={anchorPath} fill="#737373" fillOpacity={0.18} stroke="#525252" strokeWidth={2} />
        {/* Candidate polygon */}
        <path d={candidatePath} fill="#10b981" fillOpacity={0.22} stroke="#047857" strokeWidth={2} />
        {/* Labels */}
        {axes.map((a, i) => {
          const angle = angleAt(i);
          const labelX = center + (radius + 24) * Math.cos(angle);
          const labelY = center + (radius + 24) * Math.sin(angle);
          let anchor: 'start' | 'middle' | 'end' = 'middle';
          if (labelX < center - 10) anchor = 'end';
          else if (labelX > center + 10) anchor = 'start';
          return (
            <g key={`label-${i}`}>
              <text
                x={labelX}
                y={labelY - 5}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={11}
                fontWeight={600}
                fill="#171717"
              >
                {a.label}
              </text>
              <text
                x={labelX}
                y={labelY + 8}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={9}
                fill="#a3a3a3"
              >
                {a.anchor.toFixed(0)} / {a.candidate.toFixed(0)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function CompararPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-50 py-10">
          <div className="mx-auto max-w-5xl px-6 text-sm text-neutral-500">A carregar…</div>
        </main>
      }
    >
      <CompararContent />
    </Suspense>
  );
}
