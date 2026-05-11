'use client';

import type { Metric } from './MetricPickerModal';

export type SimilarityResultItem = {
  player_id: string;
  similarity: number;
  position: string;
  top_similar: Array<{ metric_code: string; both_percentile: number }>;
  top_different: Array<{ metric_code: string; delta_percentile: number; direction: '+' | '-' }>;
  player: {
    id: string;
    name: string;
    current_team: string | null;
    team_in_period: string | null;
    position_primary: string | null;
    age: number | null;
    minutes_played: number | null;
    pool_name: string | null;
  };
};

type Props = {
  items: SimilarityResultItem[];
  metricByCode: Map<string, Metric>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onOpenPlayer: (id: string) => void;
  /** Drill-down: parent constrói a URL completa com anchor + candidate. */
  onCompare: (candidateId: string) => void;
};

/**
 * Bandas semânticas para a similaridade — alinhadas com o header de
 * similarity.ts (95+ clone; 85-95 muito parecido; 70-85 com diferenças;
 * 60-70 família; <60 distinto).
 */
function similarityBand(sim: number): { label: string; color: string; bar: string } {
  if (sim >= 95)
    return {
      label: 'clone',
      color: 'text-emerald-700',
      bar: 'bg-emerald-500',
    };
  if (sim >= 85)
    return {
      label: 'muito parecido',
      color: 'text-emerald-700',
      bar: 'bg-emerald-500',
    };
  if (sim >= 70)
    return {
      label: 'parecido com diferenças',
      color: 'text-neutral-700',
      bar: 'bg-neutral-500',
    };
  if (sim >= 60)
    return { label: 'família semelhante', color: 'text-amber-700', bar: 'bg-amber-400' };
  return { label: 'perfil distinto', color: 'text-neutral-400', bar: 'bg-neutral-300' };
}

function metricLabel(code: string, metricByCode: Map<string, Metric>): string {
  return metricByCode.get(code)?.label_pt ?? code;
}

export function SimilarityResultsTable({
  items,
  metricByCode,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenPlayer,
  onCompare,
}: Props) {
  const allSelected = items.length > 0 && items.every((p) => selectedIds.has(p.player_id));
  const someSelected = items.some((p) => selectedIds.has(p.player_id));

  return (
    <div>
      <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-600">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && someSelected;
            }}
            onChange={onToggleSelectAll}
            className="h-3.5 w-3.5 cursor-pointer rounded border-neutral-300"
          />
          <span>Seleccionar todos ({items.length})</span>
        </label>
      </div>
      <ul className="divide-y divide-neutral-100">
        {items.map((it, i) => {
          const selected = selectedIds.has(it.player_id);
          const band = similarityBand(it.similarity);
          const team = it.player.team_in_period ?? it.player.current_team;
          const transferred =
            it.player.team_in_period &&
            it.player.current_team &&
            it.player.team_in_period !== it.player.current_team
              ? it.player.current_team
              : null;
          return (
            <li
              key={it.player_id}
              className={`px-4 py-3 ${selected ? 'bg-emerald-50/40' : 'hover:bg-neutral-50'}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(it.player_id)}
                  className="mt-1 h-3.5 w-3.5 cursor-pointer rounded border-neutral-300"
                  aria-label={`Seleccionar ${it.player.name}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-xs text-neutral-400">#{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => onOpenPlayer(it.player.id)}
                      className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                    >
                      {it.player.name}
                    </button>
                    <span className="text-sm text-neutral-700">{team ?? '—'}</span>
                    <span className="text-xs text-neutral-500">{it.position}</span>
                    {it.player.age != null && (
                      <span className="text-xs text-neutral-500">{it.player.age}a</span>
                    )}
                    {it.player.minutes_played != null && (
                      <span className="text-xs text-neutral-500">
                        {it.player.minutes_played.toLocaleString('pt-PT')}min
                      </span>
                    )}
                    {it.player.pool_name && (
                      <span className="text-xs text-neutral-400">· {it.player.pool_name}</span>
                    )}
                    {transferred && (
                      <span className="text-xs text-neutral-400">
                        → actualmente em {transferred}
                      </span>
                    )}
                  </div>

                  {/* Barra de similaridade + % + label semântico */}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 w-40 overflow-hidden rounded-full bg-neutral-100">
                      <div
                        className={`h-full ${band.bar}`}
                        style={{ width: `${Math.max(0, Math.min(100, it.similarity))}%` }}
                      />
                    </div>
                    <span className={`text-sm font-semibold ${band.color}`}>
                      {it.similarity.toFixed(1)}%
                    </span>
                    <span className={`text-xs ${band.color}`}>{band.label}</span>
                  </div>

                  {/* Explicações inline */}
                  <div className="mt-2 space-y-0.5 text-xs">
                    {it.top_similar.length > 0 && (
                      <div className="text-neutral-600">
                        <span className="font-medium text-neutral-500">Parecidos em:</span>{' '}
                        {it.top_similar
                          .map(
                            (s) =>
                              `${metricLabel(s.metric_code, metricByCode)} (P${s.both_percentile.toFixed(0)})`
                          )
                          .join(' · ')}
                      </div>
                    )}
                    {it.top_different.length > 0 && (
                      <div className="text-neutral-600">
                        <span className="font-medium text-neutral-500">Diferentes em:</span>{' '}
                        {it.top_different
                          .map(
                            (d) =>
                              `${metricLabel(d.metric_code, metricByCode)} (${d.direction}${Math.abs(d.delta_percentile).toFixed(0)})`
                          )
                          .join(' · ')}
                      </div>
                    )}
                  </div>

                  {/* Acções por linha */}
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => onCompare(it.player.id)}
                      className="rounded-md border border-neutral-300 px-2 py-0.5 text-neutral-700 hover:bg-neutral-50"
                    >
                      Comparar
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenPlayer(it.player.id)}
                      className="text-neutral-500 hover:text-neutral-800 hover:underline"
                    >
                      Abrir ficha
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
