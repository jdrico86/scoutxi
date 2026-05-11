'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RotateCw } from 'lucide-react';
import { MetricPickerModal, type Metric } from '@/components/MetricPickerModal';
import {
  MetricFilterRow,
  type MetricFilterValue,
  type MetricThresholds,
} from '@/components/MetricFilterRow';
import {
  runScoutQuery,
  type ScoutMetricFilter,
  type ScoutResult,
} from '@/lib/scout/query-builder';

type Pool = { id: string; name: string; season: string };

type PoolDataPlayer = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  on_loan: boolean | null;
  contract_until: string | null;
  market_value_eur: number | null;
};

type PoolDataStat = {
  player_id: string;
  metric_code: string;
  metric_value: number | null;
};

type PoolData = {
  pool_name: string;
  players: PoolDataPlayer[];
  stats: PoolDataStat[];
  generated_at: string;
};

const POSITIONS_BY_LINE: Array<[string, string[]]> = [
  ['GR', ['GK']],
  ['Defesa', ['CB', 'LCB', 'RCB', 'LB', 'RB', 'LWB', 'RWB']],
  ['Médio', ['DMF', 'LDMF', 'RDMF', 'CMF', 'LCMF', 'RCMF', 'AMF', 'LAMF', 'RAMF', 'LM', 'RM']],
  ['Ataque', ['LW', 'RW', 'LWF', 'RWF', 'CF']],
];

export function PesquisaAvancada() {
  const router = useRouter();
  const [pools, setPools] = useState<Pool[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);

  const [poolId, setPoolId] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [minMinutes, setMinMinutes] = useState('');
  const [onLoan, setOnLoan] = useState<'any' | 'yes' | 'no'>('any');
  const [metricFilters, setMetricFilters] = useState<MetricFilterValue[]>([]);

  // Cliente-cache: a pool data fica em React state durante a sessão.
  const [poolData, setPoolData] = useState<PoolData | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);

  const [showResults, setShowResults] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
    fetch('/api/metrics')
      .then((r) => r.json())
      .then((j) => setMetrics(j.metrics ?? []));
  }, []);

  // Fetch pool data quando o user escolhe pool (ou clica recarregar).
  const fetchPoolData = async (id: string, refresh = false) => {
    setPoolLoading(true);
    setPoolError(null);
    setPoolData(null);
    setShowResults(false);
    try {
      const res = await fetch(
        `/api/scout/pool-data?pool_id=${encodeURIComponent(id)}${refresh ? '&refresh=1' : ''}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro a carregar pool.');
      setPoolData(json as PoolData);
    } catch (err) {
      setPoolError((err as Error).message);
    } finally {
      setPoolLoading(false);
    }
  };

  useEffect(() => {
    // Sem pool: useMemos abaixo retornam null pelo guard, UI esconde.
    if (!poolId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPoolData(poolId);
  }, [poolId]);

  const togglePosition = (pos: string) => {
    setPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  };

  // Constroi o input para runScoutQuery a partir do estado actual.
  const queryInput = useMemo(() => {
    const general_filters: Record<string, number | boolean> = {};
    if (minAge.trim()) general_filters.min_age = parseInt(minAge, 10);
    if (maxAge.trim()) general_filters.max_age = parseInt(maxAge, 10);
    if (minMinutes.trim()) general_filters.min_minutes = parseInt(minMinutes, 10);
    if (onLoan === 'yes') general_filters.on_loan = true;
    else if (onLoan === 'no') general_filters.on_loan = false;

    // Traduzir mode=percentil → operator backend correspondente.
    // gte+percentil → top_percentile (preciso, usa distribuição completa).
    // lte+percentil → lte com value convertido via thresholds (interpolação).
    // between+percentil → between com value_range convertido.
    const mf: ScoutMetricFilter[] = [];
    for (const f of metricFilters) {
      if (f.operator === 'gte' && f.mode === 'percentile' && f.value != null) {
        mf.push({ metric_code: f.metric_code, operator: 'top_percentile', percentile: f.value });
      } else if (f.operator === 'gte' && f.value != null) {
        mf.push({ metric_code: f.metric_code, operator: 'gte', value: f.value });
      } else if (f.operator === 'lte' && f.mode === 'percentile' && f.value != null) {
        const t = lastThresholds[f.metric_code];
        if (t) {
          mf.push({
            metric_code: f.metric_code,
            operator: 'lte',
            value: percentileToAbsolute(f.value, t),
          });
        }
      } else if (f.operator === 'lte' && f.value != null) {
        mf.push({ metric_code: f.metric_code, operator: 'lte', value: f.value });
      } else if (f.operator === 'between' && f.value_range != null) {
        if (f.mode === 'percentile') {
          const t = lastThresholds[f.metric_code];
          if (t) {
            mf.push({
              metric_code: f.metric_code,
              operator: 'between',
              value_range: [
                percentileToAbsolute(f.value_range[0], t),
                percentileToAbsolute(f.value_range[1], t),
              ],
            });
          }
        } else {
          mf.push({
            metric_code: f.metric_code,
            operator: 'between',
            value_range: f.value_range,
          });
        }
      } else if (f.operator === 'top_percentile' && f.percentile != null) {
        mf.push({ metric_code: f.metric_code, operator: 'top_percentile', percentile: f.percentile });
      }
    }

    return {
      positions: positions.length > 0 ? positions : undefined,
      general_filters: Object.keys(general_filters).length > 0 ? general_filters : undefined,
      metric_filters: mf,
    };
    // lastThresholds intencionalmente fora dos deps — evita ciclo (preview depende
    // de queryInput, queryInput depende de thresholds = preview.metric_thresholds).
    // Os thresholds usados para conversão são one-step-behind, aceitável.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, minAge, maxAge, minMinutes, onLoan, metricFilters]);

  // Preview ao vivo (síncrono — runScoutQuery é puro).
  const preview: ScoutResult | null = useMemo(() => {
    if (!poolId || !poolData) return null;
    return runScoutQuery({
      players: poolData.players,
      stats: poolData.stats,
      query: queryInput,
      preview: true,
    });
  }, [poolId, poolData, queryInput]);

  // Thresholds da última run (para conversão valor↔percentil nos filtros lte/between+percentil).
  const lastThresholds: Record<string, MetricThresholds> = preview?.metric_thresholds ?? {};

  // Resultado completo (com players[]) — só após o user clicar Procurar.
  // Depois disso, actualiza ao vivo conforme filtros mudam (é instantâneo).
  const fullResult: ScoutResult | null = useMemo(() => {
    if (!poolId || !showResults || !poolData) return null;
    return runScoutQuery({
      players: poolData.players,
      stats: poolData.stats,
      query: queryInput,
      preview: false,
    });
  }, [poolId, showResults, poolData, queryInput]);

  // Mapa para enriquecer resultados com team_in_period (a partir do poolData).
  const playerInPool = useMemo(() => {
    const m = new Map<string, PoolDataPlayer>();
    if (poolData) for (const p of poolData.players) m.set(p.id, p);
    return m;
  }, [poolData]);

  const addMetricFilter = (m: Metric) => {
    setMetricFilters((prev) => [
      ...prev,
      { metric_code: m.code, operator: 'top_percentile', percentile: 75, mode: 'percentile' },
    ]);
    setPickerOpen(false);
  };

  const updateMetricFilter = (idx: number, next: MetricFilterValue) => {
    setMetricFilters((prev) => prev.map((f, i) => (i === idx ? next : f)));
  };

  const removeMetricFilter = (idx: number) => {
    setMetricFilters((prev) => prev.filter((_, i) => i !== idx));
  };

  const metricByCode = useMemo(() => {
    const m = new Map<string, Metric>();
    for (const mt of metrics) m.set(mt.code, mt);
    return m;
  }, [metrics]);

  const activeMetricCodes = metricFilters.map((f) => f.metric_code);
  const filtersDisabled = poolLoading || !poolData;

  return (
    <>
      <p className="mb-6 text-sm text-neutral-600">
        Filtros ad-hoc sem criar perfil. A pool é carregada uma vez por sessão — depois disso
        a contagem e os resultados actualizam ao vivo conforme alteras filtros.
      </p>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="space-y-5">
          {/* Pool selector + recarregar */}
          <div>
            <label className="block text-xs font-medium text-neutral-700">Pool</label>
            <div className="mt-1 flex items-center gap-2">
              <select
                value={poolId}
                onChange={(e) => setPoolId(e.target.value)}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm md:max-w-md"
              >
                <option value="">— escolhe pool —</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.season}
                  </option>
                ))}
              </select>
              {poolId && (
                <button
                  type="button"
                  onClick={() => fetchPoolData(poolId, true)}
                  disabled={poolLoading}
                  title="Recarregar dados da pool (limpa cache)"
                  className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-2 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${poolLoading ? 'animate-spin' : ''}`} strokeWidth={2} />
                  Recarregar
                </button>
              )}
            </div>
            {poolData && !poolLoading && (
              <p className="mt-1 text-xs text-neutral-400">
                {poolData.players.length} jogadores · {poolData.stats.length.toLocaleString('pt-PT')} stats
                · carregado {new Date(poolData.generated_at).toLocaleTimeString('pt-PT')}
              </p>
            )}
          </div>

          {/* Loading skeleton */}
          {poolLoading && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
                <div className="text-sm text-neutral-700">A carregar dados da pool…</div>
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Carregamento inicial pode demorar uns segundos (paginação completa do pool).
                Depois disso, todos os filtros são instantâneos.
              </p>
              <div className="mt-3 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-200" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-200" />
              </div>
            </div>
          )}

          {poolError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {poolError}
            </div>
          )}

          {/* Resto dos filtros (disabled se pool não carregada) */}
          <fieldset disabled={filtersDisabled} className="space-y-5 disabled:opacity-50">
            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Posições {positions.length > 0 && <span className="text-neutral-400">({positions.length})</span>}
              </label>
              <div className="mt-2 space-y-2">
                {POSITIONS_BY_LINE.map(([line, posns]) => (
                  <div key={line} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-16 shrink-0 text-xs font-medium text-neutral-500">{line}</span>
                    {posns.map((pos) => {
                      const on = positions.includes(pos);
                      return (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => togglePosition(pos)}
                          className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                            on
                              ? 'border-neutral-900 bg-neutral-900 text-white'
                              : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                          }`}
                        >
                          {pos}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-neutral-500">
                Sem posições escolhidas → percentis calculados sobre a pool inteira (com aviso).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <label className="block text-xs font-medium text-neutral-700">Idade min</label>
                <input
                  type="number"
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700">Idade máx</label>
                <input
                  type="number"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700">Min minutos</label>
                <input
                  type="number"
                  value={minMinutes}
                  onChange={(e) => setMinMinutes(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700">Empréstimo</label>
                <select
                  value={onLoan}
                  onChange={(e) => setOnLoan(e.target.value as 'any' | 'yes' | 'no')}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="any">Qualquer</option>
                  <option value="yes">Sim</option>
                  <option value="no">Não</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Filtros de métrica {metricFilters.length > 0 && <span className="text-neutral-400">({metricFilters.length})</span>}
              </label>
              <div className="mt-2 space-y-2">
                {metricFilters.map((mf, i) => {
                  const m = metricByCode.get(mf.metric_code);
                  if (!m) return null;
                  return (
                    <MetricFilterRow
                      key={`${mf.metric_code}-${i}`}
                      metric={m}
                      value={mf}
                      thresholds={lastThresholds[mf.metric_code]}
                      onChange={(next) => updateMetricFilter(i, next)}
                      onRemove={() => removeMetricFilter(i)}
                    />
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={metrics.length === 0}
                className="mt-2 flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
                Adicionar filtro
              </button>
            </div>
          </fieldset>

          {/* Preview ao vivo + acção */}
          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
            <button
              type="button"
              onClick={() => setShowResults(true)}
              disabled={!poolData || (preview?.count ?? 0) === 0}
              className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {showResults ? 'Resultados ao vivo' : 'Procurar'}
            </button>
            {preview && (
              <span className="text-sm text-neutral-600">
                <strong className="text-neutral-900">~{preview.count}</strong> jogadores correspondem
                <span className="text-neutral-400"> · peer group {preview.peer_group_size}</span>
              </span>
            )}
          </div>

          {preview && preview.warnings.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {preview.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {showResults && fullResult && (
        <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 bg-neutral-50 px-6 py-3 text-sm">
            <strong className="text-neutral-900">{fullResult.count}</strong>
            <span className="text-neutral-700">
              {' '}
              jogadores correspondem · peer group {fullResult.peer_group_size}
            </span>
          </div>
          {!fullResult.players || fullResult.players.length === 0 ? (
            <div className="p-6 text-sm text-neutral-500">Nenhum jogador corresponde.</div>
          ) : (
            <ResultsTable
              players={fullResult.players}
              playerInPool={playerInPool}
              poolName={poolData?.pool_name ?? ''}
              activeMetricCodes={activeMetricCodes}
              metricByCode={metricByCode}
              onOpenPlayer={(id) => router.push(`/players/${id}`)}
            />
          )}
        </section>
      )}

      {pickerOpen && (
        <MetricPickerModal
          metrics={metrics}
          alreadyPickedCodes={activeMetricCodes}
          selectedPositions={positions}
          onPick={addMetricFilter}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}

function ResultsTable({
  players,
  playerInPool,
  poolName,
  activeMetricCodes,
  metricByCode,
  onOpenPlayer,
}: {
  players: NonNullable<ScoutResult['players']>;
  playerInPool: Map<string, PoolDataPlayer>;
  poolName: string;
  activeMetricCodes: string[];
  metricByCode: Map<string, Metric>;
  onOpenPlayer: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-4 py-2">Jogador</th>
            <th className="px-4 py-2">Equipa</th>
            <th className="px-4 py-2">Pos</th>
            <th className="px-4 py-2 text-right">Idade</th>
            <th className="px-4 py-2 text-right">Min</th>
            {activeMetricCodes.map((code) => {
              const m = metricByCode.get(code);
              return (
                <th key={code} className="px-4 py-2 text-right">
                  {m?.label_pt ?? code}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const pd = playerInPool.get(p.id);
            const team = pd?.team_in_period ?? p.current_team;
            const transferred =
              pd?.team_in_period && p.current_team && pd.team_in_period !== p.current_team
                ? p.current_team
                : null;
            const valuesByCode = new Map(p.metric_values.map((v) => [v.metric_code, v]));
            return (
              <tr key={p.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(p.id)}
                    className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                  >
                    {p.name}
                  </button>
                  <div className="text-xs text-neutral-400">{poolName}</div>
                </td>
                <td className="px-4 py-3 text-neutral-700">
                  {team ?? '—'}
                  {transferred && (
                    <div className="text-xs text-neutral-400">→ {transferred}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-600">{p.position_primary ?? '—'}</td>
                <td className="px-4 py-3 text-right text-neutral-600">{p.age ?? '—'}</td>
                <td className="px-4 py-3 text-right text-neutral-600">
                  {p.minutes_played?.toLocaleString() ?? '—'}
                </td>
                {activeMetricCodes.map((code) => {
                  const v = valuesByCode.get(code);
                  return (
                    <td key={code} className="px-4 py-3 text-right">
                      {v?.raw_value == null ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        <>
                          <span className="font-medium text-neutral-900">
                            {formatVal(v.raw_value)}
                          </span>
                          {v.percentile != null && (
                            <span className="ml-1 text-xs text-neutral-400">
                              (P{v.percentile.toFixed(0)})
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatVal(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

/** Interpolação para converter percentil → valor absoluto via thresholds. */
function percentileToAbsolute(percentile: number, t: MetricThresholds): number {
  const points: Array<[number, number]> = [
    [0, t.min],
    [10, t.p10],
    [25, t.p25],
    [50, t.p50],
    [75, t.p75],
    [90, t.p90],
    [95, t.p95],
    [100, t.max],
  ];
  if (percentile <= 0) return t.min;
  if (percentile >= 100) return t.max;
  for (let i = 0; i < points.length - 1; i++) {
    const [p1, v1] = points[i];
    const [p2, v2] = points[i + 1];
    if (percentile >= p1 && percentile <= p2) {
      if (p2 === p1) return v1;
      return v1 + ((percentile - p1) / (p2 - p1)) * (v2 - v1);
    }
  }
  return t.p50;
}
