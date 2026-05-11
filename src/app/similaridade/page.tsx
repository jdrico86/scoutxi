'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';
import { AnchorPicker, type AnchorSelection } from '@/components/AnchorPicker';
import { LensSelector, type Lens } from '@/components/LensSelector';
import {
  SimilarityResultsTable,
  type SimilarityResultItem,
} from '@/components/SimilarityResultsTable';
import type { Metric } from '@/components/MetricPickerModal';
import { POSITION_METRICS } from '@/lib/similarity/position-metrics';
import { formatPoolName } from '@/lib/pools';

type Pool = { id: string; name: string; season: string };

type Profile = { id: string; name: string; tags: string[] | null };

const POSITIONS_BY_LINE: Array<[string, string[]]> = [
  ['GR', ['GK']],
  ['Defesa', ['CB', 'LCB', 'RCB', 'LB', 'RB', 'LWB', 'RWB']],
  ['Médio', ['DMF', 'LDMF', 'RDMF', 'CMF', 'LCMF', 'RCMF', 'AMF', 'LAMF', 'RAMF', 'LM', 'RM']],
  ['Ataque', ['LW', 'RW', 'LWF', 'RWF', 'CF']],
];

type ShortlistSummary = { id: string; name: string };
type SquadSummary = { id: string; name: string; formation: string };

// ── State preservation: URL params + sessionStorage ───────────────────────
//
// URL preserva inputs do form (anchor, pools, positions, age, minutes,
// lens=full|profile, profile_id). lens=custom NÃO entra no URL — fica em
// React state apenas (weights complexos; trade-off documentado).
//
// sessionStorage cacheia resultados com queryKey canónico que captura o
// snapshot completo do form (incluindo weights de lens=custom). Ao voltar
// do drill-down: lê URL → hidrata form → compara queryKey → se bate,
// restaura resultados sem fetch; se não bate, form preenchido sem results.
const CACHE_KEY = 'scout-similarity-cache';
const DEFAULT_MIN_MINUTES = 600;

type InitialFormFromUrl = {
  anchorPoolId: string;
  anchorPlayerId: string | null;
  targetPoolIds: string[];
  positions: string[];
  minMinutes: number;
  ageMin: string;
  ageMax: string;
  lens: Lens;
};

function readInitialFromUrl(searchParams: URLSearchParams): InitialFormFromUrl {
  const anchorPoolId = searchParams.get('anchor_pool') ?? '';
  // Edge case 3: anchor_player sem anchor_pool é inválido → ignora player.
  const rawAnchorPlayer = searchParams.get('anchor_player');
  const anchorPlayerId = rawAnchorPlayer && anchorPoolId ? rawAnchorPlayer : null;

  const targetPoolIds = (searchParams.get('pools') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const positions = (searchParams.get('positions') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const mmRaw = parseInt(searchParams.get('min_minutes') ?? '', 10);
  const minMinutes = Number.isFinite(mmRaw) && mmRaw >= 0 ? mmRaw : DEFAULT_MIN_MINUTES;

  const ageMin = searchParams.get('age_min') ?? '';
  const ageMax = searchParams.get('age_max') ?? '';

  // Edge case 5: lens=profile sem profile_id → ignora lens. lens=custom não
  // é aceite via URL (só em-memória durante a sessão).
  const lensParam = searchParams.get('lens');
  const profileId = searchParams.get('profile_id');
  let lens: Lens = { mode: 'full' };
  if (lensParam === 'profile' && profileId) {
    lens = { mode: 'profile', profile_id: profileId };
  }

  return {
    anchorPoolId,
    anchorPlayerId,
    targetPoolIds,
    positions,
    minMinutes,
    ageMin,
    ageMax,
    lens,
  };
}

function buildSearchParams(snapshot: {
  anchorPoolId: string;
  anchorPlayerId: string | null;
  targetPoolIds: string[];
  positions: string[];
  minMinutes: number;
  ageMin: string;
  ageMax: string;
  lens: Lens;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (snapshot.anchorPoolId) params.set('anchor_pool', snapshot.anchorPoolId);
  // anchor_player só faz sentido com anchor_pool.
  if (snapshot.anchorPlayerId && snapshot.anchorPoolId) {
    params.set('anchor_player', snapshot.anchorPlayerId);
  }
  if (snapshot.targetPoolIds.length > 0) params.set('pools', snapshot.targetPoolIds.join(','));
  if (snapshot.positions.length > 0) params.set('positions', snapshot.positions.join(','));
  if (snapshot.minMinutes !== DEFAULT_MIN_MINUTES) {
    params.set('min_minutes', String(snapshot.minMinutes));
  }
  if (snapshot.ageMin.trim()) params.set('age_min', snapshot.ageMin.trim());
  if (snapshot.ageMax.trim()) params.set('age_max', snapshot.ageMax.trim());
  // lens=full é default — omite. lens=custom é session-only — não escreve.
  if (snapshot.lens.mode === 'profile' && snapshot.lens.profile_id) {
    params.set('lens', 'profile');
    params.set('profile_id', snapshot.lens.profile_id);
  }
  return params;
}

/**
 * Devolve string canónica que identifica unicamente a query. Inclui o
 * snapshot completo do form (incl. lens=custom weights). Usada como key
 * no sessionStorage para validar se os resultados em cache batem com o
 * form actual.
 */
function canonicalQueryKey(snapshot: {
  anchorPoolId: string;
  anchorPlayerId: string | null;
  targetPoolIds: string[];
  positions: string[];
  minMinutes: number;
  ageMin: string;
  ageMax: string;
  lens: Lens;
}): string {
  let lensCanon: unknown;
  if (snapshot.lens.mode === 'custom') {
    const sortedWeights: Record<string, number> = {};
    for (const k of Object.keys(snapshot.lens.weights).sort()) {
      sortedWeights[k] = snapshot.lens.weights[k];
    }
    lensCanon = { mode: 'custom', weights: sortedWeights };
  } else if (snapshot.lens.mode === 'profile') {
    lensCanon = { mode: 'profile', profile_id: snapshot.lens.profile_id };
  } else {
    lensCanon = { mode: 'full' };
  }
  return JSON.stringify({
    a_pool: snapshot.anchorPoolId || null,
    a_player: snapshot.anchorPlayerId || null,
    pools: [...snapshot.targetPoolIds].sort(),
    positions: [...snapshot.positions].sort(),
    mm: snapshot.minMinutes,
    a_min: snapshot.ageMin.trim() || null,
    a_max: snapshot.ageMax.trim() || null,
    lens: lensCanon,
  });
}

type CacheEntry = {
  queryKey: string;
  candidates: SimilarityResultItem[];
  warnings: string[];
  cached_at: string;
};

function saveToCache(entry: CacheEntry): void {
  // Edge case 1: setItem pode rebentar (quota / private mode). Degrada
  // silenciosamente — perdemos só o cache para a próxima navegação.
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // no-op
  }
}

function loadFromCache(): CacheEntry | null {
  // Edge case 2: JSON malformado / shape inesperado → trata como cache absent.
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed.queryKey !== 'string' ||
      !Array.isArray(parsed.candidates) ||
      !Array.isArray(parsed.warnings)
    ) {
      return null;
    }
    return parsed as CacheEntry;
  } catch {
    return null;
  }
}

function SimilaridadeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Lazy initialiser: lê URL params 1x (na primeira render). useMemo com
  // deps vazias garante que mudanças posteriores do URL (provocadas pelo
  // próprio efeito de sincronização) não re-inicializam o form.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialFromUrl = useMemo(() => readInitialFromUrl(searchParams), []);

  const [pools, setPools] = useState<Pool[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Estado de input — inicializado a partir do URL.
  // anchor é hidratado async (precisa de fetch /api/players/[id]) noutro effect.
  const [anchorPoolId, setAnchorPoolId] = useState(initialFromUrl.anchorPoolId);
  const [anchor, setAnchor] = useState<AnchorSelection | null>(null);
  const [targetPoolIds, setTargetPoolIds] = useState<string[]>(initialFromUrl.targetPoolIds);
  const [positions, setPositions] = useState<string[]>(initialFromUrl.positions);
  const [minMinutes, setMinMinutes] = useState(initialFromUrl.minMinutes);
  const [ageMin, setAgeMin] = useState(initialFromUrl.ageMin);
  const [ageMax, setAgeMax] = useState(initialFromUrl.ageMax);
  const [lens, setLens] = useState<Lens>(initialFromUrl.lens);

  // Estado de output
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SimilarityResultItem[] | null>(null);
  const [resultWarnings, setResultWarnings] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Tracking se já tentámos restaurar do sessionStorage (evita reentrância).
  const cacheRestoreAttempted = useRef(false);
  // Tracking se já tentámos hidratar anchor a partir do URL (1x).
  const anchorHydrationAttempted = useRef(false);

  // Bulk action UI
  const [shortlistMenuOpen, setShortlistMenuOpen] = useState(false);
  const [squadMenuOpen, setSquadMenuOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const shortlistMenuRef = useRef<HTMLDivElement>(null);
  const squadMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
    fetch('/api/metrics')
      .then((r) => r.json())
      .then((j) => setMetrics(j.metrics ?? []));
    fetch('/api/profiles')
      .then((r) => r.json())
      .then((j) => setProfiles(j.profiles ?? []));
  }, []);

  // ── Hidratar anchor a partir do URL (1x) ─────────────────────────────
  // Se URL tem anchor_pool + anchor_player, busca dados do jogador para
  // construir o AnchorSelection. Edge cases tratados em readInitialFromUrl
  // (anchor_player sem anchor_pool → ignorado, anchorPlayerId=null).
  useEffect(() => {
    if (anchorHydrationAttempted.current) return;
    if (!initialFromUrl.anchorPlayerId || !initialFromUrl.anchorPoolId) return;
    anchorHydrationAttempted.current = true;
    const playerId = initialFromUrl.anchorPlayerId;
    const poolId = initialFromUrl.anchorPoolId;
    fetch(`/api/players/${playerId}`)
      .then((r) => r.json())
      .then((j) => {
        const p = j.player;
        if (!p) return;
        setAnchor({
          pool_id: poolId,
          pool_name: '',
          player_id: p.id,
          player_name: p.name,
          current_team: p.current_team ?? null,
          team_in_period: p.team_in_period ?? null,
          position_primary: p.position_primary ?? null,
          age: p.age ?? null,
          minutes_played: p.minutes_played ?? null,
        });
      })
      .catch(() => {
        // Edge case: player id no URL não existe / fetch falha → ignora
        // silenciosamente. Form fica com anchor=null; user reconfigura.
      });
  }, [initialFromUrl.anchorPlayerId, initialFromUrl.anchorPoolId]);

  // ── Validar lens=profile contra lista de profiles carregada ──────────
  // Edge case 4: URL tem profile_id que não pertence ao user / não existe.
  // Degrada lens para 'full' (sem error UI).
  useEffect(() => {
    if (profiles.length === 0) return;
    if (lens.mode !== 'profile') return;
    const found = profiles.some((p) => p.id === lens.profile_id);
    if (!found) {
      console.warn(
        `[similaridade] profile_id ${lens.profile_id} não encontrado — degrada lens para full.`
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLens({ mode: 'full' });
    }
  }, [profiles, lens]);

  // Quando a âncora muda, propor target pools (default: pool da âncora) e
  // posições (default: arquétipo da âncora).
  const anchorPosition = anchor?.position_primary ?? null;
  const anchorPlayerId = anchor?.player_id ?? null;
  const anchorPoolIdForEffect = anchor?.pool_id ?? null;

  const arquetypePositions = useMemo(() => {
    if (!anchorPosition) return [];
    const target = POSITION_METRICS[anchorPosition];
    if (!target) return [];
    const same: string[] = [];
    for (const [pos, metrics] of Object.entries(POSITION_METRICS)) {
      if (metrics === target) same.push(pos);
    }
    return same;
  }, [anchorPosition]);

  const arquetypeMetricCodes = useMemo(() => {
    if (!anchorPosition) return [];
    return POSITION_METRICS[anchorPosition] ?? [];
  }, [anchorPosition]);

  const arquetypePositionsKey = arquetypePositions.join(',');
  useEffect(() => {
    if (!anchorPlayerId || !anchorPoolIdForEffect) return;
    // Auto-popula target pools (com a pool da âncora) e positions (arquétipo).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTargetPoolIds((prev) => (prev.length === 0 ? [anchorPoolIdForEffect] : prev));
    setPositions((prev) => (prev.length === 0 ? arquetypePositions : prev));
    // arquetypePositions é derivado de anchorPosition; arquetypePositionsKey
    // resolve a regra de exhaustive-deps sem re-correr efeito por reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorPlayerId, anchorPoolIdForEffect, arquetypePositionsKey]);

  // ── Sincronizar URL com form state ──────────────────────────────────
  // Escreve sempre que algum input do form muda. router.replace (não push)
  // — não polui o histórico do browser. lens=custom NÃO entra no URL.
  useEffect(() => {
    const params = buildSearchParams({
      anchorPoolId: anchor?.pool_id ?? anchorPoolId,
      anchorPlayerId: anchor?.player_id ?? null,
      targetPoolIds,
      positions,
      minMinutes,
      ageMin,
      ageMax,
      lens,
    });
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `/similaridade?${next}` : '/similaridade', { scroll: false });
    }
  }, [
    anchor,
    anchorPoolId,
    targetPoolIds,
    positions,
    minMinutes,
    ageMin,
    ageMax,
    lens,
    router,
    searchParams,
  ]);

  // ── Restaurar resultados a partir do sessionStorage (1x) ─────────────
  // Só corre depois do anchor estar hidratado (se havia anchor no URL) E
  // dos profiles estarem carregados (para a validação de lens=profile).
  // Computa o queryKey do form actual e compara com o cached.
  useEffect(() => {
    if (cacheRestoreAttempted.current) return;
    // Aguarda anchor hidratado se URL pediu (evita match parcial).
    if (initialFromUrl.anchorPlayerId && !anchor) return;
    // Aguarda profiles para garantir que lens não está prestes a degradar.
    if (initialFromUrl.lens.mode === 'profile' && profiles.length === 0) return;
    cacheRestoreAttempted.current = true;

    const currentKey = canonicalQueryKey({
      anchorPoolId: anchor?.pool_id ?? '',
      anchorPlayerId: anchor?.player_id ?? null,
      targetPoolIds,
      positions,
      minMinutes,
      ageMin,
      ageMax,
      lens,
    });
    const cached = loadFromCache();
    if (cached && cached.queryKey === currentKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults(cached.candidates);
      setResultWarnings(cached.warnings);
    }
    // Edge case 6: URL completa mas cache absent / queryKey mismatch →
    // results fica null, user clica "Encontrar parecidos" para correr.
  }, [
    anchor,
    profiles,
    initialFromUrl.anchorPlayerId,
    initialFromUrl.lens.mode,
    targetPoolIds,
    positions,
    minMinutes,
    ageMin,
    ageMax,
    lens,
  ]);

  // Fechar dropdowns ao clicar fora
  useEffect(() => {
    if (!shortlistMenuOpen && !squadMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        shortlistMenuOpen &&
        shortlistMenuRef.current &&
        !shortlistMenuRef.current.contains(e.target as Node)
      )
        setShortlistMenuOpen(false);
      if (
        squadMenuOpen &&
        squadMenuRef.current &&
        !squadMenuRef.current.contains(e.target as Node)
      )
        setSquadMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [shortlistMenuOpen, squadMenuOpen]);

  useEffect(() => {
    if (!actionFeedback) return;
    const t = setTimeout(() => setActionFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [actionFeedback]);

  const togglePosition = (pos: string) => {
    setPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  };

  const toggleTargetPool = (id: string) => {
    setTargetPoolIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const metricByCode = useMemo(() => {
    const m = new Map<string, Metric>();
    for (const mt of metrics) m.set(mt.code, mt);
    return m;
  }, [metrics]);

  // Filtrar profiles aplicáveis à âncora (qualquer posição em comum)
  const applicableProfiles = useMemo(() => {
    if (!anchorPosition) return profiles;
    return profiles.filter((p) => {
      const positions: string[] | undefined = (p as unknown as {
        filters?: { positions?: string[] };
      }).filters?.positions;
      if (!positions || positions.length === 0) return true;
      return positions.includes(anchorPosition);
    });
  }, [profiles, anchorPosition]);

  // Posições válidas = intersecção entre seleccionadas e arquétipo da âncora.
  // Outras posições no UI ficam clicáveis mas vão ser filtradas no submit.
  const positionsInArquetype = useMemo(
    () => positions.filter((p) => arquetypePositions.includes(p)),
    [positions, arquetypePositions]
  );

  const canSearch =
    !!anchor &&
    targetPoolIds.length > 0 &&
    positionsInArquetype.length > 0 &&
    (lens.mode !== 'profile' || (lens.profile_id && lens.profile_id.length > 0)) &&
    (lens.mode !== 'custom' || Object.values(lens.weights).some((w) => w > 0));

  const search = async () => {
    if (!anchor) return;
    setError(null);
    setLoading(true);
    setResults(null);
    setResultWarnings([]);
    setSelectedIds(new Set());
    try {
      const body: Record<string, unknown> = {
        anchor: { pool_id: anchor.pool_id, player_id: anchor.player_id },
        target_pools: targetPoolIds,
        positions: positionsInArquetype,
        min_minutes: minMinutes,
        lens,
      };
      const aMin = parseInt(ageMin, 10);
      const aMax = parseInt(ageMax, 10);
      if (!Number.isNaN(aMin) && !Number.isNaN(aMax)) body.age_range = [aMin, aMax];

      const res = await fetch('/api/scout/similarity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro a procurar parecidos.');
      const candidates = (json.candidates ?? []) as SimilarityResultItem[];
      const warnings = (json.warnings ?? []) as string[];
      setResults(candidates);
      setResultWarnings(warnings);
      // Persistir em sessionStorage com queryKey canónico para restauro
      // após drill-down. queryKey inclui lens=custom weights → mismatch
      // se user mudar pesos depois de submeter (cache miss correcto).
      const queryKey = canonicalQueryKey({
        anchorPoolId: anchor.pool_id,
        anchorPlayerId: anchor.player_id,
        targetPoolIds,
        positions: positionsInArquetype,
        minMinutes,
        ageMin,
        ageMax,
        lens,
      });
      saveToCache({
        queryKey,
        candidates,
        warnings,
        cached_at: new Date().toISOString(),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allIds = (results ?? []).map((r) => r.player_id);
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.has(id));
      if (allSelected) return new Set();
      return new Set(allIds);
    });
  };

  const addToShortlist = async (id: string, name: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map((pid) =>
          fetch(`/api/shortlists/${id}/players`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: pid }),
          }).then((r) => r.ok)
        )
      );
      const ok = results.filter(Boolean).length;
      setActionFeedback(`✓ ${ok}/${ids.length} adicionados a "${name}"`);
      setShortlistMenuOpen(false);
    } catch (err) {
      setActionFeedback(`Erro: ${(err as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const addToSquad = async (id: string, name: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        ids.map((pid) =>
          fetch(`/api/squads/${id}/players`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: pid }),
          }).then((r) => r.ok || r.status === 409)
        )
      );
      const ok = results.filter(Boolean).length;
      setActionFeedback(`✓ ${ok}/${ids.length} adicionados a "${name}"`);
      setSquadMenuOpen(false);
    } catch (err) {
      setActionFeedback(`Erro: ${(err as Error).message}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const minutesWarning = minMinutes < 600;

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-5xl px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Similaridade</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Parte de um jogador-âncora e encontra jogadores parecidos em outras pools.
            Comparação por percentis dentro da pool de cada jogador — moneyball: top-10% num
            pool ≈ top-10% noutro, independente de magnitudes brutas.
          </p>
        </header>

        {/* ── Âncora ─────────────────────────────────────────────────── */}
        <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-900">Âncora</h2>
          <AnchorPicker
            pools={pools}
            selectedPoolId={anchorPoolId}
            onPoolChange={setAnchorPoolId}
            anchor={anchor}
            onAnchorChange={setAnchor}
          />
        </section>

        {/* ── Onde procurar ──────────────────────────────────────────── */}
        <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-900">Onde procurar</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Pools-alvo {targetPoolIds.length > 0 && <span className="text-neutral-400">({targetPoolIds.length})</span>}
              </label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pools.map((p) => {
                  const on = targetPoolIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleTargetPool(p.id)}
                      className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                        on
                          ? 'border-neutral-900 bg-neutral-900 text-white'
                          : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                      }`}
                    >
                      {formatPoolName(p.name, p.season)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700">
                Posições {positions.length > 0 && <span className="text-neutral-400">({positions.length})</span>}
              </label>
              {anchor && arquetypePositions.length > 0 && (
                <p className="mt-1 text-xs text-neutral-500">
                  Arquétipo da âncora ({anchor.position_primary}): {arquetypePositions.join(', ')}.
                  Outras posições são ignoradas pelo servidor.
                </p>
              )}
              <div className="mt-2 space-y-2">
                {POSITIONS_BY_LINE.map(([line, posns]) => (
                  <div key={line} className="flex flex-wrap items-center gap-1.5">
                    <span className="w-16 shrink-0 text-xs font-medium text-neutral-500">{line}</span>
                    {posns.map((pos) => {
                      const on = positions.includes(pos);
                      const inArquetype = arquetypePositions.includes(pos);
                      return (
                        <button
                          key={pos}
                          type="button"
                          onClick={() => togglePosition(pos)}
                          title={inArquetype ? '' : 'Fora do arquétipo da âncora — ignorada'}
                          className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                            on && inArquetype
                              ? 'border-neutral-900 bg-neutral-900 text-white'
                              : on
                                ? 'border-amber-400 bg-amber-50 text-amber-700 line-through'
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
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-neutral-700">Idade min</label>
                <input
                  type="number"
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700">Idade máx</label>
                <input
                  type="number"
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value)}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-700">Min minutos</label>
                <input
                  type="number"
                  value={minMinutes}
                  onChange={(e) => setMinMinutes(parseInt(e.target.value) || 0)}
                  min={0}
                  step={50}
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
                {minutesWarning && (
                  <p className="mt-1 text-xs text-amber-700">
                    ⚠ Percentis abaixo de 600 min são pouco fiáveis.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* ── Lente ──────────────────────────────────────────────────── */}
        <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-900">Lente</h2>
          <LensSelector
            lens={lens}
            onChange={setLens}
            metrics={metrics}
            arquetypeMetricCodes={arquetypeMetricCodes}
            profiles={applicableProfiles}
            anchorPositions={arquetypePositions}
          />
        </section>

        {/* ── Acção ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={search}
            disabled={!canSearch || loading}
            className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? 'A procurar…' : 'Encontrar parecidos'}
          </button>
          {error && <span className="text-sm text-red-700">{error}</span>}
          {!canSearch && !error && (
            <span className="text-xs text-neutral-500">
              {!anchor
                ? 'Escolhe uma âncora.'
                : targetPoolIds.length === 0
                  ? 'Selecciona pelo menos uma pool-alvo.'
                  : positionsInArquetype.length === 0
                    ? 'Selecciona pelo menos uma posição do arquétipo.'
                    : lens.mode === 'profile' && !lens.profile_id
                      ? 'Escolhe um perfil.'
                      : 'Configura a lente.'}
            </span>
          )}
        </div>

        {/* ── Resultados ─────────────────────────────────────────────── */}
        {results && (
          <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
            {/* Bulk action bar */}
            {selectedIds.size > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-emerald-50 px-4 py-2.5">
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
              <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3 text-sm">
                <strong className="text-neutral-900">{results.length}</strong>
                <span className="text-neutral-700"> jogador{results.length === 1 ? '' : 'es'} parecido{results.length === 1 ? '' : 's'} encontrado{results.length === 1 ? '' : 's'}</span>
              </div>
            )}

            {actionFeedback && (
              <div className="flex items-center gap-2 border-b border-neutral-200 bg-emerald-50/60 px-4 py-2 text-xs text-emerald-800">
                <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
                {actionFeedback}
              </div>
            )}

            {resultWarnings.length > 0 && (
              <ul className="border-b border-neutral-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                {resultWarnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}

            {results.length === 0 ? (
              <div className="p-6 text-sm text-neutral-500">
                Nenhum jogador parecido encontrado com estes filtros.
              </div>
            ) : (
              <SimilarityResultsTable
                items={results}
                metricByCode={metricByCode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
                onOpenPlayer={(id) => router.push(`/players/${id}`)}
                onCompare={(id) =>
                  anchor &&
                  router.push(
                    `/similaridade/comparar?a=${encodeURIComponent(anchor.player_id)}&b=${encodeURIComponent(id)}`
                  )
                }
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
}

// ── Popover de bulk-add (shortlist ou squad) — copia o padrão da Pesquisa
// Avançada. Mantido inline para evitar criar mais um componente partilhado.
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
      const body = target === 'shortlist' ? { name } : { name, formation: '4-3-3' };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro a criar.');
      const created = target === 'shortlist' ? json.shortlist : json.squad;
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

// useSearchParams() exige boundary de Suspense em Next.js App Router.
export default function SimilaridadePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-50 py-10">
          <div className="mx-auto max-w-5xl px-6 text-sm text-neutral-500">A carregar…</div>
        </main>
      }
    >
      <SimilaridadeContent />
    </Suspense>
  );
}
