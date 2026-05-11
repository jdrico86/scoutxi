'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RotateCw, Check, X } from 'lucide-react';
import { MetricPickerModal, type Metric } from '@/components/MetricPickerModal';
import {
  MetricFilterRow,
  type MetricFilterValue,
  type MetricThresholds,
} from '@/components/MetricFilterRow';
import {
  ScoutResultsTable,
  type DisplayPlayer,
  type SortState,
} from '@/components/ScoutResultsTable';
import { SaveAsProfileModal } from '@/components/SaveAsProfileModal';
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

type ShortlistSummary = { id: string; name: string };
type SquadSummary = { id: string; name: string; formation: string };

const POSITIONS_BY_LINE: Array<[string, string[]]> = [
  ['GR', ['GK']],
  ['Defesa', ['CB', 'LCB', 'RCB', 'LB', 'RB', 'LWB', 'RWB']],
  ['Médio', ['DMF', 'LDMF', 'RDMF', 'CMF', 'LCMF', 'RCMF', 'AMF', 'LAMF', 'RAMF', 'LM', 'RM']],
  ['Ataque', ['LW', 'RW', 'LWF', 'RWF', 'CF']],
];

const STATIC_SORT_FIELDS = new Set(['name', 'team', 'pos', 'age', 'minutes']);

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

  const [poolData, setPoolData] = useState<PoolData | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [poolError, setPoolError] = useState<string | null>(null);

  const [showResults, setShowResults] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Selecção múltipla
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Sort: user override (null = usa default derivado dos filtros activos)
  const [userSort, setUserSort] = useState<SortState | null>(null);

  // Bulk actions
  const [shortlistMenuOpen, setShortlistMenuOpen] = useState(false);
  const [squadMenuOpen, setSquadMenuOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    text: string;
    link?: { href: string; label: string };
  } | null>(null);

  // Save-as-profile modal
  const [saveProfileOpen, setSaveProfileOpen] = useState(false);

  const shortlistMenuRef = useRef<HTMLDivElement>(null);
  const squadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
    fetch('/api/metrics')
      .then((r) => r.json())
      .then((j) => setMetrics(j.metrics ?? []));
  }, []);

  const fetchPoolData = useCallback(async (id: string, refresh = false) => {
    setPoolLoading(true);
    setPoolError(null);
    setPoolData(null);
    setShowResults(false);
    setSelectedIds(new Set());
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
  }, []);

  useEffect(() => {
    if (!poolId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPoolData(poolId);
  }, [poolId, fetchPoolData]);

  // Fechar dropdowns ao clicar fora
  useEffect(() => {
    if (!shortlistMenuOpen && !squadMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        shortlistMenuOpen &&
        shortlistMenuRef.current &&
        !shortlistMenuRef.current.contains(e.target as Node)
      ) {
        setShortlistMenuOpen(false);
      }
      if (
        squadMenuOpen &&
        squadMenuRef.current &&
        !squadMenuRef.current.contains(e.target as Node)
      ) {
        setSquadMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [shortlistMenuOpen, squadMenuOpen]);

  // Feedback temporário (4s)
  useEffect(() => {
    if (!actionFeedback) return;
    const t = setTimeout(() => setActionFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [actionFeedback]);

  const togglePosition = (pos: string) => {
    setPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  };

  const queryInput = useMemo(() => {
    const general_filters: Record<string, number | boolean> = {};
    if (minAge.trim()) general_filters.min_age = parseInt(minAge, 10);
    if (maxAge.trim()) general_filters.max_age = parseInt(maxAge, 10);
    if (minMinutes.trim()) general_filters.min_minutes = parseInt(minMinutes, 10);
    if (onLoan === 'yes') general_filters.on_loan = true;
    else if (onLoan === 'no') general_filters.on_loan = false;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, minAge, maxAge, minMinutes, onLoan, metricFilters]);

  const preview: ScoutResult | null = useMemo(() => {
    if (!poolId || !poolData) return null;
    return runScoutQuery({
      players: poolData.players,
      stats: poolData.stats,
      query: queryInput,
      preview: true,
    });
  }, [poolId, poolData, queryInput]);

  const lastThresholds: Record<string, MetricThresholds> = preview?.metric_thresholds ?? {};

  const fullResult: ScoutResult | null = useMemo(() => {
    if (!poolId || !showResults || !poolData) return null;
    return runScoutQuery({
      players: poolData.players,
      stats: poolData.stats,
      query: queryInput,
      preview: false,
    });
  }, [poolId, showResults, poolData, queryInput]);

  const playerInPool = useMemo(() => {
    const m = new Map<string, PoolDataPlayer>();
    if (poolData) for (const p of poolData.players) m.set(p.id, p);
    return m;
  }, [poolData]);

  const activeMetricCodes = useMemo(() => metricFilters.map((f) => f.metric_code), [metricFilters]);

  // Default sort: 1ª métrica DESC se houver, senão nome ASC.
  // Se o user fez override e o campo ainda é válido, usa o override.
  const effectiveSort: SortState = useMemo(() => {
    if (
      userSort &&
      (STATIC_SORT_FIELDS.has(userSort.field) || activeMetricCodes.includes(userSort.field))
    ) {
      return userSort;
    }
    if (activeMetricCodes.length > 0) {
      return { field: activeMetricCodes[0], direction: 'desc' };
    }
    return { field: 'name', direction: 'asc' };
  }, [userSort, activeMetricCodes]);

  const onSort = (field: string) => {
    setUserSort((curr) => {
      if (curr && curr.field === field) {
        return { field, direction: curr.direction === 'asc' ? 'desc' : 'asc' };
      }
      // Strings começam asc; números/métricas começam desc
      const direction = STATIC_SORT_FIELDS.has(field) && field !== 'age' && field !== 'minutes' ? 'asc' : 'desc';
      return { field, direction };
    });
  };

  // Build displayPlayers (com team_in_period enriquecido)
  const displayPlayers: DisplayPlayer[] = useMemo(() => {
    if (!fullResult?.players) return [];
    return fullResult.players.map((p) => {
      const pd = playerInPool.get(p.id);
      return {
        id: p.id,
        name: p.name,
        current_team: p.current_team,
        team_in_period: pd?.team_in_period ?? null,
        position_primary: p.position_primary,
        age: p.age,
        minutes_played: p.minutes_played,
        metric_values: p.metric_values,
      };
    });
  }, [fullResult, playerInPool]);

  // Multi-select handlers
  const toggleSelect = (playerId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allIds = displayPlayers.map((p) => p.id);
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(allIds);
    });
  };

  // Bulk actions
  const addToShortlist = async (shortlistId: string, shortlistName: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map((pid) =>
          fetch(`/api/shortlists/${shortlistId}/players`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: pid }),
          }).then((r) => r.ok)
        )
      );
      const ok = results.filter(Boolean).length;
      setActionFeedback({ text: `✓ ${ok}/${ids.length} adicionados a "${shortlistName}"` });
      setShortlistMenuOpen(false);
    } catch (err) {
      setActionFeedback({ text: `Erro: ${(err as Error).message}` });
    } finally {
      setBulkBusy(false);
    }
  };

  const addToSquad = async (squadId: string, squadName: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map((pid) =>
          fetch(`/api/squads/${squadId}/players`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: pid }),
          }).then((r) => r.ok || r.status === 409)
        )
      );
      const ok = results.filter(Boolean).length;
      setActionFeedback({ text: `✓ ${ok}/${ids.length} adicionados a "${squadName}"` });
      setSquadMenuOpen(false);
    } catch (err) {
      setActionFeedback({ text: `Erro: ${(err as Error).message}` });
    } finally {
      setBulkBusy(false);
    }
  };

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

  const filtersDisabled = poolLoading || !poolData;
  const generalFiltersForSave = useMemo(() => {
    const o: { min_age?: number; max_age?: number; min_minutes?: number; on_loan?: boolean } = {};
    if (minAge.trim()) o.min_age = parseInt(minAge, 10);
    if (maxAge.trim()) o.max_age = parseInt(maxAge, 10);
    if (minMinutes.trim()) o.min_minutes = parseInt(minMinutes, 10);
    if (onLoan === 'yes') o.on_loan = true;
    else if (onLoan === 'no') o.on_loan = false;
    return o;
  }, [minAge, maxAge, minMinutes, onLoan]);

  return (
    <>
      <p className="mb-6 text-sm text-neutral-600">
        Filtros ad-hoc sem criar perfil. A pool é carregada uma vez por sessão — depois disso
        a contagem e os resultados actualizam ao vivo conforme alteras filtros.
      </p>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="space-y-5">
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
          {/* Bulk action bar (sticky no topo da secção) */}
          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-emerald-50 px-6 py-2.5">
              <div className="text-sm font-medium text-emerald-900">
                {selectedIds.size} jogador{selectedIds.size === 1 ? '' : 'es'} seleccionado
                {selectedIds.size === 1 ? '' : 's'}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative" ref={shortlistMenuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setShortlistMenuOpen((v) => !v);
                      setSquadMenuOpen(false);
                    }}
                    disabled={bulkBusy}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    + Shortlist
                  </button>
                  {shortlistMenuOpen && (
                    <BulkAddPopover
                      target="shortlist"
                      onPick={(id, name) => addToShortlist(id, name)}
                      onClose={() => setShortlistMenuOpen(false)}
                    />
                  )}
                </div>
                <div className="relative" ref={squadMenuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      setSquadMenuOpen((v) => !v);
                      setShortlistMenuOpen(false);
                    }}
                    disabled={bulkBusy}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    + Equipa-sombra
                  </button>
                  {squadMenuOpen && (
                    <BulkAddPopover
                      target="squad"
                      onPick={(id, name) => addToSquad(id, name)}
                      onClose={() => setSquadMenuOpen(false)}
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-emerald-800 hover:underline"
                >
                  Limpar
                </button>
              </div>
            </div>
          ) : (
            <div className="border-b border-neutral-200 bg-neutral-50 px-6 py-3 text-sm">
              <strong className="text-neutral-900">{fullResult.count}</strong>
              <span className="text-neutral-700">
                {' '}
                jogadores correspondem · peer group {fullResult.peer_group_size}
              </span>
            </div>
          )}

          {actionFeedback && (
            <div className="flex items-center gap-2 border-b border-neutral-200 bg-emerald-50/60 px-6 py-2 text-xs text-emerald-800">
              <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
              <span>{actionFeedback.text}</span>
              {actionFeedback.link && (
                <button
                  type="button"
                  onClick={() => router.push(actionFeedback.link!.href)}
                  className="underline hover:text-emerald-900"
                >
                  {actionFeedback.link.label}
                </button>
              )}
            </div>
          )}

          {displayPlayers.length === 0 ? (
            <div className="p-6 text-sm text-neutral-500">Nenhum jogador corresponde.</div>
          ) : (
            <ScoutResultsTable
              players={displayPlayers}
              activeMetricCodes={activeMetricCodes}
              metricByCode={metricByCode}
              poolName={poolData?.pool_name ?? ''}
              selectedIds={selectedIds}
              sort={effectiveSort}
              onSort={onSort}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onOpenPlayer={(id) => router.push(`/players/${id}`)}
            />
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 bg-neutral-50 px-6 py-3">
            <button
              type="button"
              onClick={() => setSaveProfileOpen(true)}
              disabled={!poolData}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Guardar como perfil
            </button>
          </div>
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

      {saveProfileOpen && (
        <SaveAsProfileModal
          positions={positions}
          generalFilters={generalFiltersForSave}
          hasMetricFilters={metricFilters.length > 0}
          onClose={() => setSaveProfileOpen(false)}
          onSaved={(profileId) => {
            setSaveProfileOpen(false);
            // Fica na tab Pesquisa avançada — toast com link para a tab Perfis.
            setActionFeedback({
              text: '✓ Perfil criado.',
              link: profileId
                ? { href: `/profiles?profile=${profileId}`, label: 'Ver na aba Perfis' }
                : undefined,
            });
          }}
        />
      )}
    </>
  );
}

// ── Popover de bulk-add (shortlist ou squad) ────────────────────────────
function BulkAddPopover({
  target,
  onPick,
  onClose,
}: {
  target: 'shortlist' | 'squad';
  onPick: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Array<ShortlistSummary | SquadSummary> | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = target === 'shortlist' ? '/api/shortlists' : '/api/squads';
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        const list = target === 'shortlist' ? j.shortlists : j.squads;
        setItems(list ?? []);
      })
      .catch(() => setItems([]));
  }, [target]);

  const createAndPick = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const url = target === 'shortlist' ? '/api/shortlists' : '/api/squads';
      const body =
        target === 'shortlist' ? { name } : { name, formation: '4-3-3' };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro a criar.');
      const created =
        target === 'shortlist' ? json.shortlist : json.squad;
      if (created?.id) onPick(created.id, created.name);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          {target === 'shortlist' ? 'Shortlists' : 'Equipas-sombra'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          aria-label="Fechar"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>

      {items === null ? (
        <div className="px-3 py-3 text-xs text-neutral-500">A carregar…</div>
      ) : items.length === 0 && !creating ? (
        <div className="px-3 py-3 text-xs text-neutral-500">
          {target === 'shortlist' ? 'Sem shortlists ainda.' : 'Sem equipas ainda.'}
        </div>
      ) : (
        <ul className="max-h-56 overflow-y-auto">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                onClick={() => onPick(it.id, it.name)}
                disabled={busy}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50"
              >
                {it.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-neutral-100 p-2">
        {creating ? (
          <div className="space-y-2 px-1 py-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={target === 'shortlist' ? 'Nome da shortlist' : 'Nome da equipa'}
              autoFocus
              className="w-full rounded-md border border-neutral-200 px-2 py-1 text-sm focus:border-neutral-400 focus:outline-none"
            />
            {error && <div className="text-xs text-red-700">{error}</div>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createAndPick}
                disabled={busy || newName.trim().length === 0}
                className="rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {busy ? 'A criar…' : 'Criar + adicionar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
                disabled={busy}
                className="text-xs text-neutral-500 hover:text-neutral-800"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-neutral-600 hover:text-neutral-900"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            {target === 'shortlist' ? 'Criar nova shortlist' : 'Criar nova equipa'}
          </button>
        )}
      </div>
    </div>
  );
}

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
