'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FavoriteStar } from '@/components/FavoriteStar';

type Pool = { id: string; name: string; season: string; competition: string | null };

type ProfileScore = {
  profile_id: string;
  profile_name: string;
  is_seed: boolean;
  score: number;
  rank: number;
  total_eligible: number;
};

type TeamPlayer = {
  id: string;
  name: string;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  games_played: number | null;
  height_cm: number | null;
  foot: string | null;
  contract_until: string | null;
  market_value_eur: number | null;
  profiles: ProfileScore[];
};

type TeamData = {
  pool: Pool;
  team_name: string;
  filters: { min_age: number | null; max_age: number | null; min_minutes: number | null };
  players: TeamPlayer[];
};

const POSITION_GROUPS: Array<{ label: string; positions: string[] }> = [
  { label: 'Guarda-redes', positions: ['GK'] },
  { label: 'Defesa', positions: ['CB', 'LCB', 'RCB', 'LB', 'RB', 'LWB', 'RWB'] },
  { label: 'Meio-campo', positions: ['DMF', 'LDMF', 'RDMF', 'LCMF', 'RCMF', 'CMF', 'AMF', 'LAMF', 'RAMF'] },
  { label: 'Ataque', positions: ['LW', 'RW', 'LWF', 'RWF', 'CF'] },
];

function groupOrder(pos: string | null): number {
  if (!pos) return 99;
  for (let i = 0; i < POSITION_GROUPS.length; i++) {
    if (POSITION_GROUPS[i].positions.includes(pos)) return i;
  }
  return 99;
}

export default function TeamsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-50 py-10">
          <div className="mx-auto max-w-6xl px-6 text-sm text-neutral-500">A carregar…</div>
        </main>
      }
    >
      <TeamsContent />
    </Suspense>
  );
}

function TeamsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [pools, setPools] = useState<Pool[]>([]);
  const [teamsByPool, setTeamsByPool] = useState<string[]>([]);
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Estado dos seletores e filtros (lidos da URL para serem shareable)
  const initialPool = searchParams.get('pool') ?? '';
  const initialTeam = searchParams.get('team') ?? '';
  const initialMinAge = searchParams.get('min_age') ?? '18';
  const initialMaxAge = searchParams.get('max_age') ?? '30';
  const initialMinMinutes = searchParams.get('min_minutes') ?? '500';
  const initialSort = searchParams.get('sort') === 'minutes' ? 'minutes' : 'position';

  const [poolId, setPoolId] = useState<string>(initialPool);
  const [teamName, setTeamName] = useState<string>(initialTeam);
  const [minAge, setMinAge] = useState<string>(initialMinAge);
  const [maxAge, setMaxAge] = useState<string>(initialMaxAge);
  const [minMinutes, setMinMinutes] = useState<string>(initialMinMinutes);
  const [sortMode, setSortMode] = useState<'position' | 'minutes'>(initialSort);

  // Carregar pools
  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
  }, []);

  // Carregar equipas do pool seleccionado
  useEffect(() => {
    if (!poolId) {
      setTeamsByPool([]);
      return;
    }
    fetch(`/api/pools/${poolId}/teams`)
      .then((r) => r.json())
      .then((j) => setTeamsByPool(j.teams ?? []))
      .catch(() => setTeamsByPool([]));
  }, [poolId]);

  // Sincronizar URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (poolId) params.set('pool', poolId);
    if (teamName) params.set('team', teamName);
    if (minAge) params.set('min_age', minAge);
    if (maxAge) params.set('max_age', maxAge);
    if (minMinutes) params.set('min_minutes', minMinutes);
    if (sortMode !== 'position') params.set('sort', sortMode);
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `/teams?${next}` : '/teams', { scroll: false });
    }
  }, [poolId, teamName, minAge, maxAge, minMinutes, sortMode, router, searchParams]);

  // Carregar equipa
  const loadTeam = useCallback(async () => {
    if (!poolId || !teamName) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pool: poolId, team: teamName });
      if (minAge.trim()) params.set('min_age', minAge.trim());
      if (maxAge.trim()) params.set('max_age', maxAge.trim());
      if (minMinutes.trim()) params.set('min_minutes', minMinutes.trim());

      const res = await fetch(`/api/teams?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro a carregar equipa.');
      setData(json);
    } catch (e) {
      setError((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [poolId, teamName, minAge, maxAge, minMinutes]);

  // Auto-load quando pool+team estão definidos
  useEffect(() => {
    if (poolId && teamName) loadTeam();
  }, [loadTeam, poolId, teamName]);

  const sortedPlayers = useMemo(() => {
    if (!data) return [];
    const arr = [...data.players];
    if (sortMode === 'minutes') {
      arr.sort((a, b) => (b.minutes_played ?? 0) - (a.minutes_played ?? 0));
    } else {
      arr.sort((a, b) => {
        const ga = groupOrder(a.position_primary);
        const gb = groupOrder(b.position_primary);
        if (ga !== gb) return ga - gb;
        return (b.minutes_played ?? 0) - (a.minutes_played ?? 0);
      });
    }
    return arr;
  }, [data, sortMode]);

  const clearFilters = () => {
    setMinAge('');
    setMaxAge('');
    setMinMinutes('');
  };

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Equipas</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Vê o plantel de uma equipa e em que perfis cada jogador se classifica.
          </p>
        </header>

        {/* Selectores */}
        <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                Pool
              </label>
              <select
                value={poolId}
                onChange={(e) => {
                  setPoolId(e.target.value);
                  setTeamName('');
                }}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">— escolher pool —</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.season}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                Equipa
              </label>
              <select
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                disabled={!poolId}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="">— escolher equipa —</option>
                {teamsByPool.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filtros sempre visíveis */}
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                Idade mín
              </label>
              <input
                type="number"
                value={minAge}
                onChange={(e) => setMinAge(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                Idade máx
              </label>
              <input
                type="number"
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                Minutos mín
              </label>
              <input
                type="number"
                value={minMinutes}
                onChange={(e) => setMinMinutes(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={clearFilters}
                className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Limpar filtros
              </button>
            </div>
          </div>

          {/* Sort + status */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-4">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-neutral-500">Ordenar por:</span>
              <button
                type="button"
                onClick={() => setSortMode('position')}
                className={`rounded-md px-3 py-1 ${sortMode === 'position'
                    ? 'bg-neutral-900 text-white'
                    : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                  }`}
              >
                Posição
              </button>
              <button
                type="button"
                onClick={() => setSortMode('minutes')}
                className={`rounded-md px-3 py-1 ${sortMode === 'minutes'
                    ? 'bg-neutral-900 text-white'
                    : 'border border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                  }`}
              >
                Minutos
              </button>
            </div>
            {data && (
              <div className="text-xs text-neutral-500">
                {sortedPlayers.length} jogador{sortedPlayers.length !== 1 ? 'es' : ''} sob filtros atuais
              </div>
            )}
          </div>
        </section>

        {/* Aviso sobre dados */}
        {data && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <strong>Nota sobre os dados:</strong> Jogadores aparecem associados ao seu clube atual no
            Wyscout. Se um jogador mudou de clube durante a época, os minutos jogados podem incluir
            tempo noutro clube. O filtro de minutos mínimos ajuda a focar nos jogadores com peso
            real no plantel.
          </div>
        )}

        {/* Conteúdo */}
        {loading && (
          <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
            A carregar…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {!loading && !error && data && sortedPlayers.length === 0 && (
          <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
            Nenhum jogador corresponde aos filtros atuais. Tenta relaxar os filtros.
          </div>
        )}

        {!loading && !error && data && sortedPlayers.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sortedPlayers.map((p) => (
              <PlayerCard key={p.id} player={p} onClick={() => router.push(`/players/${p.id}`)} />
            ))}
          </div>
        )}

        {!data && !loading && !error && (
          <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
            {!poolId
              ? 'Escolhe um pool para ver as equipas.'
              : !teamName
                ? 'Escolhe uma equipa.'
                : 'A preparar…'}
          </div>
        )}
      </div>
    </main>
  );
}

function PlayerCard({ player, onClick }: { player: TeamPlayer; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg border border-neutral-200 bg-white p-4 text-left transition-colors hover:border-neutral-400"
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FavoriteStar playerId={player.id} />
          <h3 className="truncate font-medium text-neutral-900">{player.name}</h3>
        </div>
        <span className="shrink-0 text-xs text-neutral-500">
          {player.position_primary ?? '—'}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        {[
          player.age ? `${player.age} anos` : null,
          player.minutes_played ? `${player.minutes_played.toLocaleString()} min` : null,
          player.games_played ? `${player.games_played} jogos` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {player.profiles.length === 0 ? (
        <p className="mt-3 text-xs italic text-neutral-400">
          Não elegível em nenhum perfil aplicável.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {player.profiles.map((pr) => (
            <li key={pr.profile_id} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 truncate text-neutral-700">
                <span className="truncate">{pr.profile_name}</span>
                {pr.is_seed && (
                  <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0 text-[10px] font-medium text-blue-800">
                    seed
                  </span>
                )}
              </span>
              <span className="shrink-0 text-neutral-500">
                <span className="font-semibold text-neutral-900">#{pr.rank}</span> / {pr.total_eligible}
                <span className="ml-1 text-neutral-400">· {pr.score.toFixed(1)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}