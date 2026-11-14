'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FavoriteStar } from '@/components/FavoriteStar';
import { PoolPicker } from '@/components/PoolPicker';

type ProfileListItem = {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  filters: {
    positions?: string[];
    min_minutes?: number;
    min_age?: number;
    max_age?: number;
  } | null;
  weights: {
    entries?: Array<{ metric_code: string; weight: number }>;
    peer_group_positions?: string[];
  } | null;
};

type Pool = { id: string; name: string; season: string; competition: string | null };

type Contribution = {
  metric_code: string;
  raw_value: number | null;
  percentile: number;
  weight: number;
  contribution: number;
};

type RankedPlayer = {
  player_id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  positions_secondary?: string[] | null;
  age: number | null;
  minutes_played: number | null;
  contract_until: string | null;
  market_value_eur: number | null;
  score: number;
  /** Só vêm quando o ranking é calculado ao vivo; do cache chegam a pedido. */
  contributions?: Contribution[];
  missing_metrics?: string[];
};

/** Detalhe por métrica de uma linha, pedido quando a linha é aberta. */
type RowDetail =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; contributions: Contribution[]; missing_metrics: string[] };

type ScoreResponse = {
  ok: boolean;
  pool: Pool;
  profile: { id: string; name: string };
  total_players_in_pool: number;
  peer_group_size: number;
  eligible_count: number;
  warnings: string[];
  ranked: RankedPlayer[];
};

type SortKey = 'score' | 'age' | 'minutes' | 'contract' | 'value';
type SortDir = 'asc' | 'desc';

/** Sentido por defeito ao clicar numa coluna pela primeira vez. */
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  score: 'desc',
  age: 'asc',
  minutes: 'desc',
  contract: 'asc',
  value: 'asc',
};

/** Quantas linhas a tabela mostra à partida, e quantas acrescenta a cada pedido. */
const PAGE_SIZE = 20;
/** Máximo que a rota das shortlists aceita de uma vez. */
const SHORTLIST_MAX = 200;

function sortValue(p: RankedPlayer, key: SortKey): number | string | null {
  switch (key) {
    case 'score':
      return p.score;
    case 'age':
      return p.age;
    case 'minutes':
      return p.minutes_played;
    case 'contract':
      return p.contract_until;
    case 'value':
      // 0 no Wyscout é "sem valor", não "grátis".
      return p.market_value_eur && p.market_value_eur > 0 ? p.market_value_eur : null;
  }
}

function numParam(v: string | null): string {
  return v && /^\d+(\.\d+)?$/.test(v) ? v : '';
}

export function PerfisGuardados() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialProfileId = searchParams.get('profile') ?? '';
  const initialPoolId = searchParams.get('pool') ?? '';

  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(initialProfileId);
  const [selectedPoolId, setSelectedPoolId] = useState<string>(initialPoolId);
  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [rowDetails, setRowDetails] = useState<Record<string, RowDetail>>({});
  const [profilesListOpen, setProfilesListOpen] = useState(false);

  // ── Ordenação e filtros do ranking ───────────────────────────────────
  // Correm no browser sobre o ranking já carregado: não mudam scores nem a
  // régua, só escolhem que linhas se vêem e por que ordem. Vivem no endereço
  // para a pesquisa poder ser guardada ou enviada.
  const initialSort = searchParams.get('sort');
  const [sortKey, setSortKey] = useState<SortKey>(
    initialSort && initialSort in DEFAULT_DIR ? (initialSort as SortKey) : 'score'
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    searchParams.get('dir') === 'asc' || searchParams.get('dir') === 'desc'
      ? (searchParams.get('dir') as SortDir)
      : DEFAULT_DIR[initialSort && initialSort in DEFAULT_DIR ? (initialSort as SortKey) : 'score']
  );
  const [minScore, setMinScore] = useState(numParam(searchParams.get('score')));
  const [maxAge, setMaxAge] = useState(numParam(searchParams.get('age')));
  const [minMinutes, setMinMinutes] = useState(numParam(searchParams.get('min')));
  const [contractBefore, setContractBefore] = useState(
    /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('contract') ?? '') ? (searchParams.get('contract') as string) : ''
  );
  const [maxValue, setMaxValue] = useState(numParam(searchParams.get('value')));
  const [hideUnknown, setHideUnknown] = useState(searchParams.get('known') === '1');
  // Esconde quem só entra no perfil por uma posição secundária. Desligado por
  // defeito: a lista mostra todos, com etiqueta em quem entra por secundária.
  const [primaryOnly, setPrimaryOnly] = useState(searchParams.get('prim') === '1');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Sincronizar URL sempre que mudam as selecções. Mantém ?tab= se presente.
  useEffect(() => {
    const params = new URLSearchParams();
    const tab = searchParams.get('tab');
    if (tab) params.set('tab', tab);
    if (selectedProfileId) params.set('profile', selectedProfileId);
    if (selectedPoolId) params.set('pool', selectedPoolId);
    if (sortKey !== 'score' || sortDir !== 'desc') {
      params.set('sort', sortKey);
      params.set('dir', sortDir);
    }
    if (minScore) params.set('score', minScore);
    if (maxAge) params.set('age', maxAge);
    if (minMinutes) params.set('min', minMinutes);
    if (contractBefore) params.set('contract', contractBefore);
    if (maxValue) params.set('value', maxValue);
    if (hideUnknown) params.set('known', '1');
    if (primaryOnly) params.set('prim', '1');
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `/profiles?${next}` : '/profiles', { scroll: false });
    }
  }, [
    selectedProfileId,
    selectedPoolId,
    sortKey,
    sortDir,
    minScore,
    maxAge,
    minMinutes,
    contractBefore,
    maxValue,
    hideUnknown,
    primaryOnly,
    router,
    searchParams,
  ]);

  const loadProfiles = useCallback(async () => {
    const res = await fetch('/api/profiles');
    const json = await res.json();
    setProfiles(json.profiles ?? []);
  }, []);

  useEffect(() => {
    // loadProfiles é function call que internamente faz setState (setProfiles).
    // eslint flagga como set-state-in-effect mas o pattern é genuíno —
    // estamos a sincronizar com sistema externo (Supabase) no mount.
    // Mesmo precedente em squads/[id]/page.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfiles();
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
  }, [loadProfiles]);
  // Auto-apply quando chegamos com params + listas já carregadas.
  // Ref em vez de state: gating idempotente sem causar re-render (não
  // displayed na UI) e sem disparar warning set-state-in-effect.
  const autoAppliedOnceRef = useRef(false);

  const runScore = useCallback(async () => {
    if (!selectedProfileId || !selectedPoolId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setExpandedRow(null);
    setRowDetails({});
    setVisibleCount(PAGE_SIZE);
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: selectedPoolId, profile_id: selectedProfileId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');
      setResult(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId, selectedPoolId]);

  // O ranking vem de profile_scores sem o detalhe por métrica; pede-se aqui,
  // para um jogador só, quando a linha é aberta. É o mesmo pedido que a ficha
  // do jogador faz.
  const toggleRow = useCallback(
    (player: RankedPlayer) => {
      const id = player.player_id;
      if (expandedRow === id) {
        setExpandedRow(null);
        return;
      }
      setExpandedRow(id);
      if (player.contributions || rowDetails[id]?.status === 'ready' || rowDetails[id]?.status === 'loading') {
        return;
      }
      setRowDetails((prev) => ({ ...prev, [id]: { status: 'loading' } }));
      fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: selectedPoolId, profile_id: selectedProfileId, player_id: id }),
      })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? 'Erro desconhecido');
          const found = (json.ranked ?? [])[0] as RankedPlayer | undefined;
          if (!found?.contributions) throw new Error('Sem detalhe para este jogador.');
          setRowDetails((prev) => ({
            ...prev,
            [id]: {
              status: 'ready',
              contributions: found.contributions ?? [],
              missing_metrics: found.missing_metrics ?? [],
            },
          }));
        })
        .catch((err) => {
          setRowDetails((prev) => ({ ...prev, [id]: { status: 'error', message: (err as Error).message } }));
        });
    },
    [expandedRow, rowDetails, selectedPoolId, selectedProfileId]
  );

  // Se chegamos à página com params + listas já carregadas, corre score automaticamente.
  // runScore = useCallback([selectedProfileId, selectedPoolId]) é estável face às
  // outras deps; o ref guard impede re-fire mesmo que runScore mude por mudança
  // de profile/pool após o primeiro auto-apply.
  useEffect(() => {
    if (autoAppliedOnceRef.current) return;
    if (!selectedProfileId || !selectedPoolId) return;
    if (profiles.length === 0 || pools.length === 0) return;
    autoAppliedOnceRef.current = true;
    // runScore é function call que internamente faz setState — mesmo
    // pattern de loadProfiles (sincronização com sistema externo).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runScore();
  }, [selectedProfileId, selectedPoolId, profiles.length, pools.length, runScore]);

  const handleDuplicate = useCallback(
    async (profileId: string) => {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clone_from_id: profileId }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(`Erro a duplicar: ${json.error}`);
        return;
      }
      await loadProfiles();
      if (json.profile?.id) router.push(`/profiles/${json.profile.id}/edit`);
    },
    [loadProfiles, router]
  );

  // ── Linhas a mostrar: filtrar, ordenar, cortar ────────────────────────
  /** Posição no perfil (ordem por score), que a coluna "#" mostra sempre. */
  const rankOf = useMemo(() => {
    const map = new Map<string, number>();
    (result?.ranked ?? []).forEach((p, i) => map.set(p.player_id, i + 1));
    return map;
  }, [result]);

  /**
   * Posição secundária pela qual o jogador entra no perfil, ou null se entra
   * pela primária. Um extremo com CF secundário aparece num perfil de
   * ponta-de-lança; a etiqueta diz que não é esse o lugar habitual dele.
   */
  const profilePositions = useMemo(
    () => profiles.find((p) => p.id === result?.profile.id)?.filters?.positions ?? [],
    [profiles, result]
  );
  const viaSecondary = useCallback(
    (p: RankedPlayer): string | null => {
      if (profilePositions.length === 0) return null;
      if (p.position_primary && profilePositions.includes(p.position_primary)) return null;
      return (p.positions_secondary ?? []).find((pos) => profilePositions.includes(pos)) ?? null;
    },
    [profilePositions]
  );

  const filtered = useMemo(() => {
    if (!result) return [];
    const scoreMin = minScore ? Number(minScore) : null;
    const ageMax = maxAge ? Number(maxAge) : null;
    const minutesMin = minMinutes ? Number(minMinutes) : null;
    const valueMax = maxValue ? Number(maxValue) : null;

    const rows = result.ranked.filter((p) => {
      if (primaryOnly && viaSecondary(p) != null) return false;
      if (scoreMin != null && p.score < scoreMin) return false;
      if (ageMax != null && (p.age == null || p.age > ageMax)) return false;
      if (minutesMin != null && (p.minutes_played ?? 0) < minutesMin) return false;
      // Contrato e valor faltam em muitos jogadores das ligas de baixo. Quem
      // não tem o dado passa o filtro, a menos que se peça para o esconder.
      if (contractBefore) {
        if (p.contract_until == null) {
          if (hideUnknown) return false;
        } else if (p.contract_until > contractBefore) return false;
      }
      if (valueMax != null) {
        const value = sortValue(p, 'value') as number | null;
        if (value == null) {
          if (hideUnknown) return false;
        } else if (value > valueMax) return false;
      }
      return true;
    });

    const sign = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      // Sem dado vai sempre para o fim, em qualquer sentido.
      if (av == null && bv == null) return (rankOf.get(a.player_id) ?? 0) - (rankOf.get(b.player_id) ?? 0);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      // Empate: desempata pela posição no perfil.
      return (rankOf.get(a.player_id) ?? 0) - (rankOf.get(b.player_id) ?? 0);
    });
  }, [
    result,
    rankOf,
    sortKey,
    sortDir,
    minScore,
    maxAge,
    minMinutes,
    contractBefore,
    maxValue,
    hideUnknown,
    primaryOnly,
    viaSecondary,
  ]);

  const shown = filtered.slice(0, visibleCount);
  const filtersActive =
    Boolean(minScore || maxAge || minMinutes || contractBefore || maxValue) || hideUnknown || primaryOnly;
  const sortActive = sortKey !== 'score' || sortDir !== 'desc';

  const handleSort = (key: SortKey) => {
    if (key === sortKey && key !== 'score' && sortDir !== DEFAULT_DIR[key]) {
      // Terceiro clique na mesma coluna: volta à ordem do perfil.
      setSortKey('score');
      setSortDir('desc');
    } else if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
    setVisibleCount(PAGE_SIZE);
  };

  const clearFilters = () => {
    setMinScore('');
    setMaxAge('');
    setMinMinutes('');
    setContractBefore('');
    setMaxValue('');
    setHideUnknown(false);
    setPrimaryOnly(false);
    setSortKey('score');
    setSortDir('desc');
    setVisibleCount(PAGE_SIZE);
  };

  // A shortlist guarda o que está no ecrã: as linhas visíveis, depois de
  // filtros, ordenação e corte. Antes guardava os 100 primeiros por score,
  // estivessem ou não à vista.
  const handleSaveShortlist = useCallback(async () => {
    if (!result) return;
    const playerIds = shown.slice(0, SHORTLIST_MAX).map((p) => p.player_id);
    if (playerIds.length === 0) return;
    const defaultName = `${result.profile.name} · ${result.pool.name}`;
    const name = prompt(`Nome da shortlist (${playerIds.length} jogadores):`, defaultName);
    if (!name) return;
    const res = await fetch('/api/shortlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        pool_id: selectedPoolId,
        profile_id: selectedProfileId,
        player_ids: playerIds,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(`Erro: ${json.error}`);
      return;
    }
    if (confirm(`Shortlist "${name}" criada com ${json.shortlist.player_count} jogadores. Abrir agora?`)) {
      router.push(`/shortlists/${json.shortlist.id}`);
    }
  }, [result, shown, selectedPoolId, selectedProfileId, router]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <p className="text-sm text-neutral-600">
          Aplica um perfil a um pool para ver o ranking. Podes editar perfis existentes,
          duplicar para criar variantes, ou criar um novo do zero.
        </p>
        <button
          type="button"
          onClick={() => router.push('/profiles/new')}
          className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          + Novo perfil
        </button>
      </div>

      {/* ── Lista de perfis com acções ──────────────────────────────── */}
      <section className="mb-8 rounded-lg border border-neutral-200 bg-white">
        <button
          type="button"
          onClick={() => setProfilesListOpen((v) => !v)}
          className={`flex w-full items-center justify-between px-6 py-3 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 ${profilesListOpen ? 'border-b border-neutral-200' : ''
            }`}
        >
          <span>Perfis disponíveis ({profiles.length})</span>
          <span className="text-neutral-400">{profilesListOpen ? '▾' : '▸'}</span>
        </button>
        {profilesListOpen && (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-2">Nome</th>
                <th className="px-4 py-2">Posições</th>
                <th className="px-4 py-2">Métricas</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => {
                const seed = p.tags?.includes('seed');
                const entries = p.weights?.entries ?? [];
                return (
                  <tr key={p.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-neutral-900">{p.name}</span>
                        {seed && (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                            seed
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <div className="mt-0.5 text-xs text-neutral-500">{p.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600">
                      {p.filters?.positions?.join(', ') ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600">{entries.length}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(`/similaridade?lens=profile&profile_id=${p.id}`)
                          }
                          className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                          title="Procurar jogadores parecidos usando este perfil como lente"
                        >
                          Pesquisar similares
                        </button>
                        <button
                          type="button"
                          onClick={() => router.push(`/profiles/${p.id}/edit`)}
                          className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(p.id)}
                          className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                        >
                          Duplicar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Aplicar perfil ──────────────────────────────────────────── */}
      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-neutral-900">Aplicar perfil a um pool</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-neutral-700">Perfil</label>
            <select
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">— escolhe um perfil —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700">Pool</label>
            <PoolPicker
              pools={pools}
              value={selectedPoolId}
              onChange={setSelectedPoolId}
              className="mt-1"
            />
          </div>
        </div>

        <button
          onClick={runScore}
          disabled={!selectedProfileId || !selectedPoolId || loading}
          className="mt-4 w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'A calcular…' : 'Calcular ranking'}
        </button>
      </section>

      {/* Pesos do perfil seleccionado */}
      {selectedProfile && selectedProfile.weights?.entries && (
        <section className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-neutral-900">
            Pesos: {selectedProfile.name}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-3">
            {selectedProfile.weights.entries.map((w) => (
              <div
                key={w.metric_code}
                className="flex items-center justify-between rounded border border-neutral-200 px-3 py-2"
              >
                <span className="font-mono text-neutral-700">{w.metric_code}</span>
                <span className="font-medium text-neutral-900">{w.weight}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && (
        <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="flex items-start justify-between gap-4 border-b border-neutral-200 bg-neutral-50 px-6 py-3 text-sm">
            <div className="min-w-0">
              <div>
                <span className="font-medium text-neutral-900">{result.profile.name}</span>
                <span className="text-neutral-400"> / </span>
                <span className="text-neutral-700">{result.pool.name}</span>
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                A mostrar {shown.length} de {filtered.length}
                {filtersActive ? ' com estes filtros' : ''} · {result.eligible_count} elegíveis · peer
                group {result.peer_group_size} · pool {result.total_players_in_pool}
              </div>
              {result.warnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-amber-700">
                  {result.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={handleSaveShortlist}
              className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              + Guardar {Math.min(shown.length, SHORTLIST_MAX)} como shortlist
            </button>
          </div>

          {result.ranked.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 border-b border-neutral-200 px-6 py-3 text-xs">
              {(
                [
                  ['Score mín.', minScore, setMinScore, '0'],
                  ['Idade máx.', maxAge, setMaxAge, '—'],
                  ['Minutos mín.', minMinutes, setMinMinutes, '0'],
                  ['Valor máx. €', maxValue, setMaxValue, '—'],
                ] as Array<[string, string, (v: string) => void, string]>
              ).map(([label, value, setValue, placeholder]) => (
                <label key={label} className="flex flex-col gap-1 text-neutral-500">
                  {label}
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={value}
                    placeholder={placeholder}
                    onChange={(e) => {
                      setValue(e.target.value);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900"
                  />
                </label>
              ))}
              <label className="flex flex-col gap-1 text-neutral-500">
                Contrato até
                <input
                  type="date"
                  value={contractBefore}
                  onChange={(e) => {
                    setContractBefore(e.target.value);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className="rounded-md border border-neutral-300 px-2 py-1 text-sm text-neutral-900"
                />
              </label>
              <label className="flex items-center gap-2 pb-1.5 text-neutral-600">
                <input
                  type="checkbox"
                  checked={hideUnknown}
                  onChange={(e) => {
                    setHideUnknown(e.target.checked);
                    setVisibleCount(PAGE_SIZE);
                  }}
                />
                Esconder quem não tem valor ou contrato registado
              </label>
              <label className="flex items-center gap-2 pb-1.5 text-neutral-600">
                <input
                  type="checkbox"
                  checked={primaryOnly}
                  onChange={(e) => {
                    setPrimaryOnly(e.target.checked);
                    setVisibleCount(PAGE_SIZE);
                  }}
                />
                Só posição primária
              </label>
              {(filtersActive || sortActive) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Repor lista inicial
                </button>
              )}
            </div>
          )}

          {result.ranked.length === 0 ? (
            <div className="p-6 text-sm text-neutral-600">
              Zero jogadores elegíveis. Verifica os filtros do perfil.
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-neutral-600">
              Nenhum jogador passa estes filtros.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3" aria-sort={sortKey === 'score' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => handleSort('score')}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-neutral-900"
                    >
                      Score
                      <span className={sortKey === 'score' ? 'text-neutral-900' : 'text-neutral-300'}>
                        {sortKey === 'score' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="px-4 py-3">Jogador</th>
                  <th className="px-4 py-3">Equipa</th>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3" aria-sort={sortKey === 'age' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => handleSort('age')}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-neutral-900"
                    >
                      Idade
                      <span className={sortKey === 'age' ? 'text-neutral-900' : 'text-neutral-300'}>
                        {sortKey === 'age' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="px-4 py-3" aria-sort={sortKey === 'minutes' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => handleSort('minutes')}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-neutral-900"
                    >
                      Min
                      <span className={sortKey === 'minutes' ? 'text-neutral-900' : 'text-neutral-300'}>
                        {sortKey === 'minutes' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="px-4 py-3" aria-sort={sortKey === 'contract' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => handleSort('contract')}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-neutral-900"
                    >
                      Contrato
                      <span className={sortKey === 'contract' ? 'text-neutral-900' : 'text-neutral-300'}>
                        {sortKey === 'contract' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="px-4 py-3" aria-sort={sortKey === 'value' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type="button"
                      onClick={() => handleSort('value')}
                      className="flex items-center gap-1 uppercase tracking-wide hover:text-neutral-900"
                    >
                      Valor
                      <span className={sortKey === 'value' ? 'text-neutral-900' : 'text-neutral-300'}>
                        {sortKey === 'value' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.flatMap((p) => {
                  const expanded = expandedRow === p.player_id;
                  const fetched = rowDetails[p.player_id];
                  const contributions =
                    p.contributions ?? (fetched?.status === 'ready' ? fetched.contributions : null);
                  const missingMetrics =
                    p.missing_metrics ?? (fetched?.status === 'ready' ? fetched.missing_metrics : []);
                  const rows = [
                    <tr
                      key={p.player_id}
                      onClick={() => toggleRow(p)}
                      className={`cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 ${expanded ? 'bg-neutral-50' : ''
                        }`}
                    >
                      <td className="px-4 py-3 text-neutral-500">{rankOf.get(p.player_id)}</td>
                      <td className="px-4 py-3 font-semibold">{p.score.toFixed(1)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <FavoriteStar playerId={p.player_id} />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/players/${p.player_id}`);
                            }}
                            className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                          >
                            {p.name}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{p.current_team ?? '—'}</td>
                      <td className="px-4 py-3 text-neutral-600">
                        {p.position_primary ?? '—'}
                        {viaSecondary(p) && (
                          <span
                            title={`Entra neste perfil pela posição secundária ${viaSecondary(p)}`}
                            className="ml-1.5 whitespace-nowrap rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                          >
                            sec. {viaSecondary(p)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{p.age ?? '—'}</td>
                      <td className="px-4 py-3 text-neutral-600">
                        {p.minutes_played?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">{p.contract_until ?? '—'}</td>
                      <td className="px-4 py-3 text-neutral-600">
                        {p.market_value_eur ? `€${p.market_value_eur.toLocaleString()}` : '—'}
                      </td>
                    </tr>,
                  ];
                  if (expanded) {
                    rows.push(
                      <tr key={`${p.player_id}-expanded`} className="bg-neutral-50">
                        <td colSpan={9} className="px-6 py-4">
                          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            Breakdown por métrica
                          </div>
                          {!contributions ? (
                            <p className="mt-2 text-xs text-neutral-500">
                              {fetched?.status === 'error'
                                ? `Não foi possível carregar o detalhe: ${fetched.message}`
                                : 'A carregar detalhe…'}
                            </p>
                          ) : (
                          <>
                          <table className="mt-2 w-full text-xs">
                            <thead className="text-left text-neutral-500">
                              <tr>
                                <th className="py-1 pr-4">Métrica</th>
                                <th className="py-1 pr-4 text-right">Valor</th>
                                <th className="py-1 pr-4 text-right">Percentil</th>
                                <th className="py-1 pr-4 text-right">Peso</th>
                                <th className="py-1 text-right">Contribui</th>
                              </tr>
                            </thead>
                            <tbody>
                              {contributions.map((c) => (
                                <tr key={c.metric_code} className="border-t border-neutral-200">
                                  <td className="py-1 pr-4 font-mono text-neutral-700">
                                    {c.metric_code}
                                  </td>
                                  <td className="py-1 pr-4 text-right text-neutral-700">
                                    {c.raw_value == null ? '—' : c.raw_value.toFixed(2)}
                                  </td>
                                  <td className="py-1 pr-4 text-right">
                                    <span
                                      className={
                                        c.percentile >= 80
                                          ? 'font-semibold text-emerald-700'
                                          : c.percentile >= 50
                                            ? 'text-neutral-700'
                                            : 'text-neutral-400'
                                      }
                                    >
                                      {c.percentile.toFixed(1)}
                                    </span>
                                  </td>
                                  <td className="py-1 pr-4 text-right text-neutral-600">
                                    {c.weight}%
                                  </td>
                                  <td className="py-1 text-right font-medium text-neutral-900">
                                    {c.contribution.toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {missingMetrics.length > 0 && (
                            <p className="mt-2 text-xs text-amber-700">
                              Métricas em falta: {missingMetrics.join(', ')}
                            </p>
                          )}
                          </>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          )}

          {filtered.length > shown.length && (
            <div className="flex items-center justify-center gap-4 border-t border-neutral-200 px-6 py-3 text-sm">
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1 font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Mostrar mais {Math.min(PAGE_SIZE, filtered.length - shown.length)}
              </button>
              <button
                type="button"
                onClick={() => setVisibleCount(filtered.length)}
                className="text-neutral-500 underline hover:text-neutral-900"
              >
                Mostrar todos ({filtered.length})
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
