'use client';

/**
 * Editor de perfil reutilizável: nome, descrição, filtros, pesos por métrica.
 *
 * Usado por /profiles/new e /profiles/[id]/edit.
 *
 * Controlo total via props:
 *   - `initialProfile`: valor inicial do form (undefined para criar do zero)
 *   - `onSubmit`: callback chamado quando o utilizador guarda (retorna redirect?)
 *   - `submitLabel`: "Criar perfil" ou "Guardar alterações"
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Metric = {
  code: string;
  category: string;
  label_pt: string;
  direction: string | null;
  unit: string | null;
};

type Filters = {
  positions?: string[];
  min_minutes?: number;
  min_age?: number;
  max_age?: number;
  contract_until_before?: string;
  on_loan?: boolean;
};

type WeightEntry = {
  metric_code: string;
  weight: number;
  direction?: 'higher' | 'lower';
};

export type ProfileFormValue = {
  name: string;
  description: string;
  filters: Filters;
  peer_group_positions: string[];
  entries: WeightEntry[];
};

// Lista canónica de posições que o Wyscout usa (a mesma que aparece no export)
const POSITION_CODES = [
  'GK',
  'CB', 'LCB', 'RCB',
  'LB', 'RB', 'LWB', 'RWB',
  'DMF', 'LDMF', 'RDMF',
  'CMF', 'LCMF', 'RCMF',
  'AMF', 'LAMF', 'RAMF',
  'LM', 'RM',
  'LW', 'RW', 'LWF', 'RWF',
  'CF',
];

export function ProfileEditor(props: {
  initialProfile?: Partial<ProfileFormValue>;
  submitLabel: string;
  onSubmit: (value: ProfileFormValue) => Promise<{ ok: boolean; error?: string; redirectTo?: string }>;
}) {
  const router = useRouter();

  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [metricsLoading, setMetricsLoading] = useState(true);

  // Form state
  const [name, setName] = useState(props.initialProfile?.name ?? '');
  const [description, setDescription] = useState(props.initialProfile?.description ?? '');
  const [filters, setFilters] = useState<Filters>(props.initialProfile?.filters ?? { min_minutes: 500, min_age: 18, max_age: 34 });
  const [peerGroup, setPeerGroup] = useState<string[]>(props.initialProfile?.peer_group_positions ?? []);
  const [entries, setEntries] = useState<WeightEntry[]>(props.initialProfile?.entries ?? []);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carregar métricas
  useEffect(() => {
    fetch('/api/metrics')
      .then((r) => r.json())
      .then((j) => {
        setMetrics(j.metrics ?? []);
        setMetricsLoading(false);
      })
      .catch(() => setMetricsLoading(false));
  }, []);

  // ── Derived state ───────────────────────────────────────────────────────
  const weightSum = useMemo(() => entries.reduce((s, e) => s + e.weight, 0), [entries]);
  const weightsValid = Math.abs(weightSum - 100) <= 0.5;

  const metricsByCategory = useMemo(() => {
    const groups = new Map<string, Metric[]>();
    for (const m of metrics) {
      if (!groups.has(m.category)) groups.set(m.category, []);
      groups.get(m.category)!.push(m);
    }
    return groups;
  }, [metrics]);

  const usedCodes = useMemo(() => new Set(entries.map((e) => e.metric_code)), [entries]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const togglePosition = useCallback((pos: string, list: 'filters' | 'peer') => {
    if (list === 'filters') {
      setFilters((f) => {
        const cur = f.positions ?? [];
        return cur.includes(pos)
          ? { ...f, positions: cur.filter((p) => p !== pos) }
          : { ...f, positions: [...cur, pos] };
      });
    } else {
      setPeerGroup((p) => (p.includes(pos) ? p.filter((x) => x !== pos) : [...p, pos]));
    }
  }, []);

  const addMetric = useCallback((code: string) => {
    setEntries((prev) =>
      prev.some((e) => e.metric_code === code)
        ? prev
        : [...prev, { metric_code: code, weight: 0 }]
    );
  }, []);

  const removeMetric = useCallback((code: string) => {
    setEntries((prev) => prev.filter((e) => e.metric_code !== code));
  }, []);

  const updateWeight = useCallback((code: string, value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setEntries((prev) => prev.map((e) => (e.metric_code === code ? { ...e, weight: clamped } : e)));
  }, []);

  const updateDirection = useCallback((code: string, dir: 'auto' | 'higher' | 'lower') => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.metric_code !== code) return e;
        if (dir === 'auto') {
          const { direction, ...rest } = e;
          void direction;
          return rest;
        }
        return { ...e, direction: dir };
      })
    );
  }, []);

  const normalizeWeights = useCallback(() => {
    if (entries.length === 0) return;
    const sum = entries.reduce((s, e) => s + e.weight, 0);
    if (sum === 0) {
      // Distribuir igualmente
      const equal = Math.round((100 / entries.length) * 100) / 100;
      setEntries((prev) => prev.map((e, i) => ({ ...e, weight: i === 0 ? 100 - equal * (prev.length - 1) : equal })));
      return;
    }
    setEntries((prev) => prev.map((e) => ({ ...e, weight: Math.round((e.weight / sum) * 100 * 100) / 100 })));
  }, [entries]);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!name.trim()) return setError('Nome obrigatório.');
    if (entries.length < 2) return setError('Adiciona pelo menos 2 métricas.');
    if (!filters.positions || filters.positions.length === 0)
      return setError('Escolhe pelo menos uma posição nos filtros.');
    if (!weightsValid)
      return setError(`Pesos somam ${weightSum.toFixed(1)} — deve ser 100.`);

    setSubmitting(true);
    try {
      const res = await props.onSubmit({
        name: name.trim(),
        description: description.trim(),
        filters,
        peer_group_positions: peerGroup,
        entries,
      });
      if (!res.ok) {
        setError(res.error ?? 'Erro desconhecido');
        setSubmitting(false);
        return;
      }
      if (res.redirectTo) router.push(res.redirectTo);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }, [name, description, filters, peerGroup, entries, weightsValid, weightSum, props, router]);

  // ── Render ──────────────────────────────────────────────────────────────
  if (metricsLoading) {
    return <div className="p-6 text-sm text-neutral-500">A carregar métricas…</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Identificação ────────────────────────────────────────────── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-neutral-900">Identificação</h2>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="Ex: Extremo invertido à Brentford"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="Descrição breve do arquétipo que o perfil captura."
            />
          </div>
        </div>
      </section>

      {/* ── Filtros ──────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-neutral-900">Filtros de elegibilidade</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Quem é elegível para o ranking. Se um jogador não passar estes filtros, nem entra.
        </p>

        <div className="mt-4">
          <label className="block text-xs font-medium text-neutral-600">Posições primárias</label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {POSITION_CODES.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => togglePosition(pos, 'filters')}
                className={`rounded-md border px-2 py-1 text-xs ${
                  (filters.positions ?? []).includes(pos)
                    ? 'border-neutral-900 bg-neutral-900 text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-neutral-600">
            Grupo de comparação (percentis) <span className="text-neutral-400">— opcional, default = posições acima</span>
          </label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {POSITION_CODES.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => togglePosition(pos, 'peer')}
                className={`rounded-md border px-2 py-1 text-xs ${
                  peerGroup.includes(pos)
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                }`}
              >
                {pos}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600">Min minutos</label>
            <input
              type="number"
              value={filters.min_minutes ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, min_minutes: e.target.value ? parseInt(e.target.value) : undefined }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">Idade min</label>
            <input
              type="number"
              value={filters.min_age ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, min_age: e.target.value ? parseInt(e.target.value) : undefined }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">Idade max</label>
            <input
              type="number"
              value={filters.max_age ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, max_age: e.target.value ? parseInt(e.target.value) : undefined }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600">Contrato termina antes de</label>
            <input
              type="date"
              value={filters.contract_until_before ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, contract_until_before: e.target.value || undefined }))
              }
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      {/* ── Pesos ─────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">Métricas e pesos</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={normalizeWeights}
              disabled={entries.length === 0}
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              Normalizar para 100
            </button>
            <div
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                weightsValid
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              Total: {weightSum.toFixed(1)} / 100
            </div>
          </div>
        </div>

        {/* Tabela de métricas seleccionadas */}
        {entries.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
            Nenhuma métrica adicionada. Escolhe uma ou mais abaixo.
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="pb-2">Métrica</th>
                <th className="pb-2 text-right">Peso</th>
                <th className="pb-2 pl-4">Direcção</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const meta = metrics.find((m) => m.code === e.metric_code);
                return (
                  <tr key={e.metric_code} className="border-t border-neutral-100">
                    <td className="py-2">
                      <div className="text-sm text-neutral-900">{meta?.label_pt ?? e.metric_code}</div>
                      <div className="font-mono text-xs text-neutral-400">{e.metric_code}</div>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number"
                          value={e.weight}
                          min={0}
                          max={100}
                          step={1}
                          onChange={(ev) => updateWeight(e.metric_code, parseFloat(ev.target.value) || 0)}
                          className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-right text-sm"
                        />
                        <span className="text-xs text-neutral-500">%</span>
                      </div>
                    </td>
                    <td className="py-2 pl-4">
                      <select
                        value={e.direction ?? 'auto'}
                        onChange={(ev) =>
                          updateDirection(e.metric_code, ev.target.value as 'auto' | 'higher' | 'lower')
                        }
                        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                      >
                        <option value="auto">auto</option>
                        <option value="higher">↑ maior melhor</option>
                        <option value="lower">↓ menor melhor</option>
                      </select>
                    </td>
                    <td className="py-2 pr-0 text-right">
                      <button
                        type="button"
                        onClick={() => removeMetric(e.metric_code)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Métricas disponíveis agrupadas por categoria */}
        <div className="mt-6 border-t border-neutral-200 pt-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            Adicionar métricas
          </div>
          <div className="mt-3 space-y-4">
            {Array.from(metricsByCategory.entries()).map(([category, list]) => (
              <div key={category}>
                <div className="text-xs font-medium text-neutral-500">{category}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {list.map((m) => {
                    const used = usedCodes.has(m.code);
                    return (
                      <button
                        key={m.code}
                        type="button"
                        disabled={used}
                        onClick={() => addMetric(m.code)}
                        className={`rounded-md border px-2 py-1 text-xs ${
                          used
                            ? 'border-neutral-200 bg-neutral-100 text-neutral-400'
                            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-900 hover:text-white'
                        }`}
                        title={m.code}
                      >
                        + {m.label_pt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Submit ────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => router.push('/profiles')}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'A guardar…' : props.submitLabel}
        </button>
      </div>
    </div>
  );
}