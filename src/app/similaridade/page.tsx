'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Plus, X } from 'lucide-react';
import { AnchorPicker, type AnchorSelection } from '@/components/AnchorPicker';
import { LensSelector, type Lens } from '@/components/LensSelector';
import {
  SimilarityResultsTable,
  type SimilarityResultItem,
} from '@/components/SimilarityResultsTable';
import type { Metric } from '@/components/MetricPickerModal';
import { POSITION_METRICS } from '@/lib/similarity/position-metrics';

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

export default function SimilaridadePage() {
  const router = useRouter();

  const [pools, setPools] = useState<Pool[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Estado de input
  const [anchorPoolId, setAnchorPoolId] = useState('');
  const [anchor, setAnchor] = useState<AnchorSelection | null>(null);
  const [targetPoolIds, setTargetPoolIds] = useState<string[]>([]);
  const [positions, setPositions] = useState<string[]>([]);
  const [minMinutes, setMinMinutes] = useState(600);
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [lens, setLens] = useState<Lens>({ mode: 'full' });

  // Estado de output
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SimilarityResultItem[] | null>(null);
  const [resultWarnings, setResultWarnings] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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
      setResults(json.candidates ?? []);
      setResultWarnings(json.warnings ?? []);
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
                      {p.name} {p.season}
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
