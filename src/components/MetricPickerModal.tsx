'use client';

import { useMemo, useState } from 'react';
import { Search, ChevronRight, ChevronDown } from 'lucide-react';
import { ModalShell } from './ModalShell';

export type Metric = {
  code: string;
  category: 'technical' | 'offensive' | 'defensive' | 'goalkeeping' | 'physical';
  label_pt: string;
  direction: 'higher' | 'lower' | null;
  unit: string | null;
};

type Props = {
  metrics: Metric[];
  /** Códigos de métrica já adicionados como filtro — desactivados na lista. */
  alreadyPickedCodes: string[];
  /** Posições escolhidas na pesquisa. Se não incluir 'GK', a categoria
   *  goalkeeping fica escondida. */
  selectedPositions: string[];
  onPick: (metric: Metric) => void;
  onClose: () => void;
};

const CATEGORY_LABELS: Record<Metric['category'], string> = {
  technical: 'Técnico',
  offensive: 'Ofensivo',
  defensive: 'Defensivo',
  goalkeeping: 'Guarda-redes',
  physical: 'Físico',
};

const CATEGORY_ORDER: Metric['category'][] = [
  'offensive',
  'defensive',
  'technical',
  'physical',
  'goalkeeping',
];

export function MetricPickerModal({
  metrics,
  alreadyPickedCodes,
  selectedPositions,
  onPick,
  onClose,
}: Props) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<Metric['category']>>(new Set());

  const showGoalkeeping = selectedPositions.includes('GK');
  const alreadySet = useMemo(() => new Set(alreadyPickedCodes), [alreadyPickedCodes]);

  // Agrupar por categoria, filtrando por busca
  const grouped = useMemo(() => {
    const byCat = new Map<Metric['category'], Metric[]>();
    const query = q.trim().toLowerCase();
    for (const m of metrics) {
      if (!showGoalkeeping && m.category === 'goalkeeping') continue;
      if (
        query &&
        !m.label_pt.toLowerCase().includes(query) &&
        !m.code.toLowerCase().includes(query)
      ) {
        continue;
      }
      if (!byCat.has(m.category)) byCat.set(m.category, []);
      byCat.get(m.category)!.push(m);
    }
    return byCat;
  }, [metrics, q, showGoalkeeping]);

  const toggleCat = (cat: Metric['category']) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const totalShown = Array.from(grouped.values()).reduce((s, l) => s + l.length, 0);

  return (
    <ModalShell title="Escolher métrica" onClose={onClose} maxWidth="max-w-lg">
      <div className="relative mb-3">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
          strokeWidth={2}
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder="Procurar por nome ou código…"
          className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm focus:border-neutral-400 focus:bg-white focus:outline-none"
        />
      </div>

      {totalShown === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-500">
          {q.trim() ? 'Sem resultados.' : 'Sem métricas disponíveis.'}
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => {
            const list = grouped.get(cat)!;
            const isCollapsed = collapsed.has(cat) && !q.trim();
            return (
              <div key={cat} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggleCat(cat)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500 hover:bg-neutral-50"
                >
                  <span>
                    {CATEGORY_LABELS[cat]} ({list.length})
                  </span>
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
                  )}
                </button>
                {!isCollapsed && (
                  <ul className="mt-0.5">
                    {list.map((m) => {
                      const already = alreadySet.has(m.code);
                      return (
                        <li key={m.code}>
                          <button
                            type="button"
                            disabled={already}
                            onClick={() => onPick(m)}
                            className="flex w-full items-center justify-between gap-3 rounded px-3 py-1.5 text-left text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-neutral-900">{m.label_pt}</div>
                              <div className="truncate font-mono text-xs text-neutral-400">
                                {m.code}
                              </div>
                            </div>
                            {already && (
                              <span className="shrink-0 text-xs text-neutral-400">já adicionado</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}
