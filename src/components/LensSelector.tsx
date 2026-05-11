'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { MetricPickerModal, type Metric } from './MetricPickerModal';

export type Lens =
  | { mode: 'full' }
  | { mode: 'profile'; profile_id: string }
  | { mode: 'custom'; weights: Record<string, number> };

type Profile = {
  id: string;
  name: string;
  tags: string[] | null;
};

type Props = {
  lens: Lens;
  onChange: (l: Lens) => void;
  /** Métricas disponíveis (todas as 45). UI restringe a lens=custom picker aos relevantes do arquétipo da âncora. */
  metrics: Metric[];
  /** Métricas relevantes para a posição da âncora — definem o universo para lens=custom. */
  arquetypeMetricCodes: string[];
  profiles: Profile[];
  /** Posições do arquétipo da âncora — usado pelo MetricPickerModal para esconder/mostrar GR. */
  anchorPositions: string[];
};

export function LensSelector({
  lens,
  onChange,
  metrics,
  arquetypeMetricCodes,
  profiles,
  anchorPositions,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const metricByCode = useMemo(() => {
    const m = new Map<string, Metric>();
    for (const mt of metrics) m.set(mt.code, mt);
    return m;
  }, [metrics]);

  // Universe filtrado para o lens=custom: só métricas do arquétipo da âncora
  const arquetypeMetrics = useMemo(() => {
    const set = new Set(arquetypeMetricCodes);
    return metrics.filter((m) => set.has(m.code));
  }, [metrics, arquetypeMetricCodes]);

  const customWeights = lens.mode === 'custom' ? lens.weights : {};
  const customEntries = Object.entries(customWeights);

  const setMode = (mode: Lens['mode']) => {
    if (mode === 'full') onChange({ mode: 'full' });
    else if (mode === 'profile') onChange({ mode: 'profile', profile_id: profiles[0]?.id ?? '' });
    else
      onChange({
        mode: 'custom',
        // Pré-preenche com todas as métricas do arquétipo, peso 1
        weights: Object.fromEntries(arquetypeMetricCodes.map((c) => [c, 1])),
      });
  };

  const updateCustomWeight = (code: string, weight: number) => {
    if (lens.mode !== 'custom') return;
    const next = { ...lens.weights, [code]: weight };
    onChange({ mode: 'custom', weights: next });
  };

  const removeCustomMetric = (code: string) => {
    if (lens.mode !== 'custom') return;
    const next = { ...lens.weights };
    delete next[code];
    onChange({ mode: 'custom', weights: next });
  };

  const addCustomMetric = (m: Metric) => {
    if (lens.mode !== 'custom') return;
    if (lens.weights[m.code] != null) {
      setPickerOpen(false);
      return;
    }
    onChange({ mode: 'custom', weights: { ...lens.weights, [m.code]: 1 } });
    setPickerOpen(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="lens"
            checked={lens.mode === 'full'}
            onChange={() => setMode('full')}
          />
          <span>Perfil completo</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="lens"
            checked={lens.mode === 'profile'}
            onChange={() => setMode('profile')}
            disabled={profiles.length === 0}
          />
          <span className={profiles.length === 0 ? 'text-neutral-400' : ''}>
            Usar perfil guardado
          </span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            name="lens"
            checked={lens.mode === 'custom'}
            onChange={() => setMode('custom')}
            disabled={arquetypeMetricCodes.length === 0}
          />
          <span className={arquetypeMetricCodes.length === 0 ? 'text-neutral-400' : ''}>
            Personalizar pesos
          </span>
        </label>
      </div>

      {lens.mode === 'full' && (
        <p className="text-xs text-neutral-500">
          Todas as métricas relevantes para a posição da âncora ({arquetypeMetricCodes.length}),
          peso igual = 1.
        </p>
      )}

      {lens.mode === 'profile' && (
        <div>
          <label className="block text-xs font-medium text-neutral-700">Perfil</label>
          <select
            value={lens.profile_id}
            onChange={(e) => onChange({ mode: 'profile', profile_id: e.target.value })}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm md:max-w-md"
          >
            <option value="">— escolhe perfil —</option>
            {profiles.map((p) => {
              const seed = p.tags?.includes('seed');
              const adhoc = p.tags?.includes('ad_hoc');
              const label = `${p.name}${seed ? ' [seed]' : adhoc ? ' [ad-hoc]' : ''}`;
              return (
                <option key={p.id} value={p.id}>
                  {label}
                </option>
              );
            })}
          </select>
          <p className="mt-1 text-xs text-neutral-500">
            Pesos do perfil aplicados. Métricas sem percentil para a âncora são ignoradas.
          </p>
        </div>
      )}

      {lens.mode === 'custom' && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-neutral-700">
              Pesos custom ({customEntries.length})
            </label>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1 rounded-md border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
            >
              <Plus className="h-3 w-3" strokeWidth={2} />
              Adicionar métrica
            </button>
          </div>
          {customEntries.length === 0 ? (
            <p className="text-xs text-neutral-500">
              Sem métricas — adiciona pelo menos uma para correr a pesquisa.
            </p>
          ) : (
            <div className="space-y-1.5">
              {customEntries.map(([code, weight]) => {
                const m = metricByCode.get(code);
                return (
                  <div
                    key={code}
                    className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-neutral-900">
                        {m?.label_pt ?? code}
                      </div>
                      <div className="truncate font-mono text-[10px] text-neutral-400">{code}</div>
                    </div>
                    <input
                      type="number"
                      value={weight}
                      onChange={(e) => updateCustomWeight(code, parseFloat(e.target.value) || 0)}
                      min={0}
                      step={0.5}
                      className="w-16 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => removeCustomMetric(code)}
                      className="rounded p-0.5 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remover métrica"
                    >
                      <X className="h-3 w-3" strokeWidth={2} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-neutral-500">
            Métricas restritas ao arquétipo da âncora ({arquetypeMetricCodes.length} possíveis).
            Sem peso 0 — para excluir, remove a linha.
          </p>
        </div>
      )}

      {pickerOpen && (
        <MetricPickerModal
          metrics={arquetypeMetrics}
          alreadyPickedCodes={lens.mode === 'custom' ? Object.keys(lens.weights) : []}
          selectedPositions={anchorPositions}
          onPick={addCustomMetric}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
