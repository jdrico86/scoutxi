'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { formatPoolName } from '@/lib/pools';

export type AnchorSelection = {
  pool_id: string;
  pool_name: string;
  player_id: string;
  player_name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
};

type Pool = { id: string; name: string; season: string };

type SearchHit = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  pool_id: string;
  pool_name: string | null;
  minutes_played: number | null;
};

type Props = {
  pools: Pool[];
  selectedPoolId: string;
  onPoolChange: (poolId: string) => void;
  anchor: AnchorSelection | null;
  onAnchorChange: (a: AnchorSelection | null) => void;
};

export function AnchorPicker({ pools, selectedPoolId, onPoolChange, anchor, onAnchorChange }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Search-as-you-type filtrado pela pool seleccionada (filtro client-side
  // sobre /api/players/search que devolve até 15 hits cross-pool).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length < 2) return;
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(query.trim())}`);
        const j = await res.json();
        const hits: SearchHit[] = j.players ?? [];
        // Filtrar à pool seleccionada
        setResults(selectedPoolId ? hits.filter((h) => h.pool_id === selectedPoolId) : hits);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [query, selectedPoolId]);

  const pickHit = async (h: SearchHit) => {
    // /api/players/search não devolve team_in_period nem minutes — buscar via /api/players/[id].
    setShowResults(false);
    setQuery('');
    try {
      const res = await fetch(`/api/players/${h.id}`);
      const j = await res.json();
      const p = j.player;
      onAnchorChange({
        pool_id: h.pool_id,
        pool_name: h.pool_name ?? '',
        player_id: h.id,
        player_name: h.name,
        current_team: p?.current_team ?? h.current_team,
        team_in_period: p?.team_in_period ?? null,
        position_primary: p?.position_primary ?? h.position_primary,
        age: p?.age ?? h.age,
        minutes_played: p?.minutes_played ?? h.minutes_played ?? null,
      });
    } catch {
      // Fallback: usa só dados do search
      onAnchorChange({
        pool_id: h.pool_id,
        pool_name: h.pool_name ?? '',
        player_id: h.id,
        player_name: h.name,
        current_team: h.current_team,
        team_in_period: null,
        position_primary: h.position_primary,
        age: h.age,
        minutes_played: h.minutes_played ?? null,
      });
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-neutral-700">Pool da âncora</label>
        <select
          value={selectedPoolId}
          onChange={(e) => {
            onPoolChange(e.target.value);
            if (anchor && anchor.pool_id !== e.target.value) onAnchorChange(null);
            setQuery('');
            setResults([]);
          }}
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm md:max-w-md"
        >
          <option value="">— escolhe pool —</option>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {formatPoolName(p.name, p.season)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-neutral-700">Jogador-âncora</label>
        {anchor ? (
          <div className="mt-1 flex items-center gap-2 rounded-md border border-neutral-300 bg-emerald-50 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-neutral-900">{anchor.player_name}</div>
              <div className="truncate text-xs text-neutral-600">
                {[
                  anchor.team_in_period ?? anchor.current_team,
                  anchor.position_primary,
                  anchor.age != null ? `${anchor.age}a` : null,
                  anchor.minutes_played != null ? `${anchor.minutes_played.toLocaleString('pt-PT')}min` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onAnchorChange(null)}
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              aria-label="Limpar âncora"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <div className="relative mt-1" ref={containerRef}>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
              strokeWidth={2}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              placeholder={selectedPoolId ? 'Procurar jogador na pool…' : 'Escolhe pool primeiro'}
              disabled={!selectedPoolId}
              className="w-full rounded-md border border-neutral-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-neutral-400 focus:outline-none disabled:bg-neutral-50 md:max-w-md"
            />
            {showResults && query.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg md:max-w-md">
                {searching ? (
                  <div className="px-3 py-2 text-xs text-neutral-500">A procurar…</div>
                ) : results.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-neutral-500">
                    Sem jogadores nesta pool com esse nome.
                  </div>
                ) : (
                  <ul>
                    {results.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => pickHit(p)}
                          className="block w-full px-3 py-2 text-left hover:bg-neutral-50"
                        >
                          <div className="text-sm font-medium text-neutral-900">{p.name}</div>
                          <div className="text-xs text-neutral-500">
                            {[p.current_team, p.position_primary, p.age != null ? `${p.age}a` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
