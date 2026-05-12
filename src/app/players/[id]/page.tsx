'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Plus, Search, FileText, Pencil } from 'lucide-react';
import { FavoriteStar } from '@/components/FavoriteStar';
import { ShortlistMenu } from '@/components/ShortlistMenu';
import { AddToSquadMenu } from '@/components/AddToSquadMenu';
import { formatPoolName } from '@/lib/pools';

type Player = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  positions_secondary: string[] | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  foot: string | null;
  nationality: string | null;
  naturality: string | null;
  on_loan: boolean | null;
  contract_until: string | null;
  market_value_eur: number | null;
  minutes_played: number | null;
  games_played: number | null;
};

type Pool = { id: string; name: string; season: string; competition: string | null };

type ApplicableProfile = {
  profile_id: string;
  profile_name: string;
  profile_description: string | null;
  is_seed: boolean;
  score: number | null;
  rank: number | null;
  eligible: boolean;
  total_eligible: number;
};

type ShortlistEntry = {
  shortlist_id: string;
  shortlist_name: string | null;
  snapshot_score: number | null;
  snapshot_rank: number | null;
};

type Note = {
  note: string | null;
  status: string | null;
  contact_info: unknown;
  updated_at: string | null;
};

type PlayerDetail = {
  player: Player;
  pool: Pool | null;
  note: Note | null;
  shortlists: ShortlistEntry[];
  applicable_profiles: ApplicableProfile[];
};

type Contribution = {
  metric_code: string;
  raw_value: number | null;
  percentile: number;
  weight: number;
  contribution: number;
};

type ProfileBreakdown = {
  score: number;
  contributions: Contribution[];
  missing_metrics: string[];
};

type SearchHit = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  pool_name: string | null;
};

type CompareResult = {
  same_pool: boolean;
  profile: { id: string; name: string; description: string | null };
  player_a: {
    id: string;
    name: string;
    current_team: string | null;
    position_primary: string | null;
    pool_name: string | null;
    score: number;
    rank: number;
    total_eligible: number;
    contributions: Contribution[];
    missing_metrics: string[];
  };
  player_b: {
    id: string;
    name: string;
    current_team: string | null;
    position_primary: string | null;
    pool_name: string | null;
    score: number;
    rank: number;
    total_eligible: number;
    contributions: Contribution[];
    missing_metrics: string[];
  };
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  tracking: { label: 'A acompanhar', color: 'bg-blue-100 text-blue-800' },
  scouted: { label: 'Visto em jogo', color: 'bg-purple-100 text-purple-800' },
  agent_contacted: { label: 'Contactado agente', color: 'bg-amber-100 text-amber-800' },
  in_negotiation: { label: 'Em negociação', color: 'bg-orange-100 text-orange-800' },
  recruited: { label: 'Recrutado', color: 'bg-emerald-100 text-emerald-800' },
  rejected: { label: 'Descartado', color: 'bg-red-100 text-red-800' },
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Sem estado' },
  { value: 'tracking', label: 'A acompanhar' },
  { value: 'scouted', label: 'Visto em jogo' },
  { value: 'agent_contacted', label: 'Contactado agente' },
  { value: 'in_negotiation', label: 'Em negociação' },
  { value: 'recruited', label: 'Recrutado' },
  { value: 'rejected', label: 'Descartado' },
];

export default function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<PlayerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<ProfileBreakdown | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const [compareOpen, setCompareOpen] = useState(false);
  const [compareData, setCompareData] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [editingNote, setEditingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const startEditingNote = () => {
    setNoteDraft(data?.note?.note ?? '');
    setStatusDraft(data?.note?.status ?? '');
    setEditingNote(true);
  };

  const cancelEditingNote = () => {
    setEditingNote(false);
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      const res = await fetch(`/api/players/${id}/note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: statusDraft || null,
          note: noteDraft || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        alert(`Erro: ${j.error}`);
        return;
      }
      const fresh = await fetch(`/api/players/${id}`).then((r) => r.json());
      setData(fresh);
      setEditingNote(false);
    } finally {
      setSavingNote(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError(null);
    setCompareData(null);
    setCompareOpen(false);
    setBreakdown(null);
    fetch(`/api/players/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error);
        } else {
          setData(j);
          const eligible = (j.applicable_profiles ?? []).filter(
            (p: ApplicableProfile) => p.eligible && p.score != null
          );
          if (eligible.length > 0) {
            setSelectedProfileId(eligible[0].profile_id);
          } else {
            setSelectedProfileId(null);
          }
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (compareData) return;
    if (!selectedProfileId || !data?.pool) {
      setBreakdown(null);
      return;
    }
    setBreakdownLoading(true);
    fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pool_id: data.pool.id,
        profile_id: selectedProfileId,
        limit: 500,
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return;
        const found = (j.ranked ?? []).find((p: { player_id: string }) => p.player_id === id);
        if (found) {
          setBreakdown({
            score: found.score,
            contributions: found.contributions,
            missing_metrics: found.missing_metrics ?? [],
          });
        } else {
          setBreakdown(null);
        }
      })
      .finally(() => setBreakdownLoading(false));
  }, [selectedProfileId, data?.pool, id, compareData]);

  const onCompareWith = useCallback(
    async (secondPlayerId: string) => {
      if (!selectedProfileId) return;
      setCompareLoading(true);
      setCompareError(null);
      try {
        const res = await fetch('/api/players/compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_a_id: id,
            player_b_id: secondPlayerId,
            profile_id: selectedProfileId,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setCompareData(json);
        setCompareOpen(false);
      } catch (e) {
        setCompareError((e as Error).message);
      } finally {
        setCompareLoading(false);
      }
    },
    [id, selectedProfileId]
  );

  const exitCompare = () => {
    setCompareData(null);
    setCompareError(null);
  };

  if (loading) {
    return <div className="p-10 text-sm text-neutral-500">A carregar…</div>;
  }
  if (error) {
    return (
      <div className="p-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Erro: {error}
        </div>
      </div>
    );
  }
  if (!data) return null;

  const { player, pool, note, shortlists, applicable_profiles } = data;
  const selectedProfile = applicable_profiles.find((p) => p.profile_id === selectedProfileId);
  const statusInfo = note?.status ? STATUS_LABELS[note.status] : null;

  return (
    <div className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mb-6">
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-3 text-xs text-neutral-500 hover:text-neutral-800"
          >
            ← Voltar
          </button>

          <div className="rounded-lg border border-neutral-200 bg-white p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-semibold text-neutral-900">{player.name}</h1>
                <p className="mt-1 text-sm text-neutral-600">
                  {[
                    player.team_in_period ?? player.current_team,
                    player.position_primary,
                    player.age ? `${player.age} anos` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {player.current_team &&
                  player.team_in_period &&
                  player.current_team !== player.team_in_period && (
                    <p className="mt-1 text-xs text-neutral-500">
                      Actualmente em <span className="font-medium text-neutral-700">{player.current_team}</span>
                    </p>
                  )}
                <p className="mt-1 text-xs text-neutral-500">
                  {pool ? formatPoolName(pool.name, pool.season) : 'Pool desconhecida'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {statusInfo && (
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusInfo.color}`}>
                    {statusInfo.label}
                  </span>
                )}
                {!compareData && (
                  <FavoriteStar playerId={id} size="lg" className="p-1.5" />
                )}
                {!compareData && (
                  <ShortlistMenu
                    playerId={id}
                    currentShortlistIds={shortlists.map((s) => s.shortlist_id)}
                    onChange={() => {
                      // recarrega data para refrescar a lista "Em shortlists" e a estrela
                      fetch(`/api/players/${id}`)
                        .then((r) => r.json())
                        .then((j) => {
                          if (!j.error) setData(j);
                        });
                    }}
                  />
                )}
                {!compareData && <AddToSquadMenu playerId={id} />}
                {!compareData && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const profileId = selectedProfileId;
                        const url = profileId
                          ? `/players/${id}/report?profile=${profileId}`
                          : `/players/${id}/report`;
                        router.push(url);
                      }}
                      className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      <FileText className="h-3.5 w-3.5" strokeWidth={2} />
                      Report Card
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareOpen((v) => !v)}
                      className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                      Comparar com outro
                    </button>
                  </>
                )}
                {compareData && (
                  <button
                    type="button"
                    onClick={exitCompare}
                    className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                    Remover comparação
                  </button>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              <Detail label="Altura" value={player.height_cm ? `${player.height_cm} cm` : null} />
              <Detail label="Peso" value={player.weight_kg ? `${player.weight_kg} kg` : null} />
              <Detail label="Pé" value={player.foot} />
              <Detail label="Nacionalidade" value={player.nationality} />
              <Detail label="Naturalidade" value={player.naturality} />
              <Detail label="Minutos" value={player.minutes_played?.toLocaleString() ?? null} />
              <Detail label="Jogos" value={player.games_played?.toString() ?? null} />
              <Detail label="Contrato até" value={player.contract_until} />
              <Detail
                label="Valor de mercado"
                value={player.market_value_eur ? `€${player.market_value_eur.toLocaleString()}` : null}
              />
            </div>
          </div>

          {compareOpen && !compareData && (
            <CompareSearchBar
              excludeId={id}
              onPick={onCompareWith}
              loading={compareLoading}
              onCancel={() => setCompareOpen(false)}
              currentProfileName={selectedProfile?.profile_name ?? null}
            />
          )}

          {compareError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {compareError}
              <button
                type="button"
                onClick={() => setCompareError(null)}
                className="ml-2 text-xs underline"
              >
                Limpar
              </button>
            </div>
          )}
        </header>

        {compareData ? (
          <CompareView data={compareData} />
        ) : (
          <section className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="rounded-lg border border-neutral-200 bg-white lg:col-span-2">
              <div className="border-b border-neutral-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-neutral-900">
                  Scores em perfis aplicáveis
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Perfis cujas posições incluem {player.position_primary ?? '—'}.
                </p>
              </div>
              {applicable_profiles.length === 0 ? (
                <div className="p-6 text-sm text-neutral-500">
                  Nenhum perfil aplicável a esta posição.
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100">
                  {applicable_profiles.map((p) => {
                    const active = p.profile_id === selectedProfileId;
                    return (
                      <li key={p.profile_id}>
                        <button
                          type="button"
                          onClick={() => p.eligible && setSelectedProfileId(p.profile_id)}
                          disabled={!p.eligible}
                          className={`block w-full px-4 py-3 text-left transition-colors ${
                            active ? 'bg-neutral-50' : 'hover:bg-neutral-50'
                          } ${!p.eligible ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-neutral-900">
                                  {p.profile_name}
                                </span>
                                {p.is_seed && (
                                  <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">
                                    seed
                                  </span>
                                )}
                              </div>
                              {p.eligible ? (
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  #{p.rank} de {p.total_eligible} elegíveis
                                </div>
                              ) : (
                                <div className="mt-0.5 text-xs text-neutral-400">Não elegível</div>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              {p.score != null ? (
                                <div className="text-lg font-semibold text-neutral-900">
                                  {p.score.toFixed(1)}
                                </div>
                              ) : (
                                <div className="text-sm text-neutral-400">—</div>
                              )}
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="rounded-lg border border-neutral-200 bg-white lg:col-span-3">
              <div className="border-b border-neutral-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-neutral-900">
                  {selectedProfile ? selectedProfile.profile_name : 'Selecciona um perfil'}
                </h2>
                {selectedProfile?.profile_description && (
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {selectedProfile.profile_description}
                  </p>
                )}
              </div>
              {breakdownLoading ? (
                <div className="p-10 text-center text-sm text-neutral-500">A calcular…</div>
              ) : !breakdown ? (
                <div className="p-10 text-center text-sm text-neutral-500">
                  Escolhe um perfil elegível à esquerda.
                </div>
              ) : (
                <div className="p-5">
                  <Radar
                    series={[
                      { label: player.name, color: '#10b981', contributions: breakdown.contributions },
                    ]}
                  />
                  <BreakdownTable contributions={breakdown.contributions} missing={breakdown.missing_metrics} />
                </div>
              )}
            </div>
          </section>
        )}

        {!compareData && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-lg border border-neutral-200 bg-white p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-900">Nota</h3>
                {!editingNote && (
                  <button
                    type="button"
                    onClick={startEditingNote}
                    className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
                  >
                    {note?.note || note?.status ? (
                      <>
                        <Pencil className="h-3 w-3" strokeWidth={2} />
                        Editar
                      </>
                    ) : (
                      <>
                        <Plus className="h-3 w-3" strokeWidth={2} />
                        Adicionar nota
                      </>
                    )}
                  </button>
                )}
              </div>

              {editingNote ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-neutral-600">Estado</label>
                    <select
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value)}
                      className="mt-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-600">Nota</label>
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={4}
                      placeholder="Observações, contactos, próximos passos…"
                      className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={saveNote}
                      disabled={savingNote}
                      className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {savingNote ? 'A guardar…' : 'Guardar'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditingNote}
                      disabled={savingNote}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : note?.note || note?.status ? (
                <div>
                  {note.note && (
                    <p className="whitespace-pre-wrap text-sm text-neutral-700">{note.note}</p>
                  )}
                  {note.updated_at && (
                    <p className="mt-2 text-xs text-neutral-400">
                      Actualizada em {new Date(note.updated_at).toLocaleDateString('pt-PT')}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-neutral-400">Sem nota.</p>
              )}
            </div>

            {shortlists.length > 0 && (
              <div className="rounded-lg border border-neutral-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-neutral-900">
                  Em shortlists ({shortlists.length})
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {shortlists.map((s) => (
                    <li key={s.shortlist_id}>
                      <button
                        type="button"
                        onClick={() => router.push(`/shortlists/${s.shortlist_id}`)}
                        className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-neutral-50"
                      >
                        <span className="text-neutral-700 hover:text-neutral-900">{s.shortlist_name}</span>
                        {s.snapshot_rank && (
                          <span className="text-xs text-neutral-500">
                            #{s.snapshot_rank} · {s.snapshot_score?.toFixed(1)}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="text-neutral-900">{value ?? '—'}</div>
    </div>
  );
}

function CompareSearchBar({
  excludeId,
  onPick,
  loading,
  onCancel,
  currentProfileName,
}: {
  excludeId: string;
  onPick: (id: string) => void;
  loading: boolean;
  onCancel: () => void;
  currentProfileName: string | null;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    // q < 2 → não disparamos a busca; JSX já hide o dropdown via `q.trim().length >= 2` guard.
    if (q.trim().length < 2) return;
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(q.trim())}`);
        const j = await res.json();
        setResults((j.players ?? []).filter((p: SearchHit) => p.id !== excludeId));
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [q, excludeId]);

  return (
    <div className="mt-3 rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">Escolher segundo jogador</h3>
          <p className="mt-0.5 text-xs text-neutral-500">
            Comparação usa o perfil actualmente seleccionado
            {currentProfileName ? `: ${currentProfileName}` : '.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-neutral-500 hover:text-neutral-800"
        >
          Cancelar
        </button>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" strokeWidth={2} />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nome do jogador…"
          autoFocus
          className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm placeholder:text-neutral-400 focus:border-neutral-400 focus:bg-white focus:outline-none"
        />
      </div>
      {q.trim().length >= 2 && (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-neutral-200">
          {searching ? (
            <div className="px-3 py-2 text-xs text-neutral-500">A procurar…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-neutral-500">Sem resultados.</div>
          ) : (
            <ul>
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onPick(p.id)}
                    className="block w-full px-3 py-2 text-left hover:bg-neutral-50 disabled:opacity-50"
                  >
                    <div className="text-sm font-medium text-neutral-900">{p.name}</div>
                    <div className="text-xs text-neutral-500">
                      {[p.current_team, p.position_primary, p.age].filter(Boolean).join(' · ')}
                      {p.pool_name && <span className="text-neutral-400"> · {p.pool_name}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function CompareView({ data }: { data: CompareResult }) {
  const { player_a: a, player_b: b, profile, same_pool } = data;
  const aByMetric = new Map(a.contributions.map((c) => [c.metric_code, c]));
  const bByMetric = new Map(b.contributions.map((c) => [c.metric_code, c]));
  const allMetrics = Array.from(new Set([...aByMetric.keys(), ...bByMetric.keys()]));

  return (
    <section className="mb-6">
      {!same_pool && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <strong>Comparação entre pools diferentes.</strong> Os percentis de cada jogador são calculados
          dentro do seu próprio pool ({a.pool_name} vs {b.pool_name}), o que torna a comparação indicativa
          — não literal. Um percentil 75 num pool pode não equivaler a 75 noutro.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CompareCard label="A" player={a} color="#10b981" />
        <CompareCard label="B" player={b} color="#f59e0b" />
      </div>

      <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-neutral-900">{profile.name}</h3>
          {profile.description && (
            <p className="mt-0.5 text-xs text-neutral-500">{profile.description}</p>
          )}
        </div>
        <Radar
          series={[
            { label: a.name, color: '#10b981', contributions: a.contributions },
            { label: b.name, color: '#f59e0b', contributions: b.contributions },
          ]}
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2">Métrica</th>
              <th className="px-4 py-2 text-right">A · Valor</th>
              <th className="px-4 py-2 text-right">A · Percentil</th>
              <th className="px-4 py-2 text-right">B · Valor</th>
              <th className="px-4 py-2 text-right">B · Percentil</th>
              <th className="px-4 py-2 text-right">Δ Percentil</th>
            </tr>
          </thead>
          <tbody>
            {allMetrics.map((code) => {
              const ca = aByMetric.get(code);
              const cb = bByMetric.get(code);
              const delta = ca && cb ? ca.percentile - cb.percentile : null;
              return (
                <tr key={code} className="border-t border-neutral-100">
                  <td className="px-4 py-2 font-mono text-neutral-700">{code}</td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {ca?.raw_value == null ? '—' : ca.raw_value.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {ca == null ? '—' : <PercentileCell value={ca.percentile} />}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-700">
                    {cb?.raw_value == null ? '—' : cb.raw_value.toFixed(2)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {cb == null ? '—' : <PercentileCell value={cb.percentile} />}
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    {delta == null ? (
                      '—'
                    ) : (
                      <span
                        className={
                          delta > 5 ? 'text-emerald-700' : delta < -5 ? 'text-red-700' : 'text-neutral-500'
                        }
                      >
                        {delta > 0 ? '+' : ''}
                        {delta.toFixed(1)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PercentileCell({ value }: { value: number }) {
  return (
    <span
      className={
        value >= 80
          ? 'font-semibold text-emerald-700'
          : value >= 50
          ? 'text-neutral-700'
          : 'text-neutral-400'
      }
    >
      {value.toFixed(1)}
    </span>
  );
}

function CompareCard({
  label,
  player,
  color,
}: {
  label: string;
  player: CompareResult['player_a'];
  color: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">
              Jogador {label}
            </span>
          </div>
          <h3 className="mt-1 truncate text-lg font-semibold text-neutral-900">{player.name}</h3>
          <p className="mt-0.5 truncate text-xs text-neutral-500">
            {[player.current_team, player.position_primary].filter(Boolean).join(' · ')}
            {player.pool_name && <span className="text-neutral-400"> · {player.pool_name}</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold text-neutral-900">{player.score.toFixed(1)}</div>
          <div className="text-xs text-neutral-500">
            #{player.rank} de {player.total_eligible}
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownTable({
  contributions,
  missing,
}: {
  contributions: Contribution[];
  missing: string[];
}) {
  return (
    <div className="mt-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
        Breakdown
      </div>
      <table className="mt-2 w-full text-xs">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="py-1 pr-3">Métrica</th>
            <th className="py-1 pr-3 text-right">Valor</th>
            <th className="py-1 pr-3 text-right">Percentil</th>
            <th className="py-1 pr-3 text-right">Peso</th>
            <th className="py-1 text-right">Contribui</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((c) => (
            <tr key={c.metric_code} className="border-t border-neutral-100">
              <td className="py-1 pr-3 font-mono text-neutral-700">{c.metric_code}</td>
              <td className="py-1 pr-3 text-right text-neutral-700">
                {c.raw_value == null ? '—' : c.raw_value.toFixed(2)}
              </td>
              <td className="py-1 pr-3 text-right">
                <PercentileCell value={c.percentile} />
              </td>
              <td className="py-1 pr-3 text-right text-neutral-600">{c.weight}%</td>
              <td className="py-1 text-right font-medium text-neutral-900">
                {c.contribution.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">Métricas em falta: {missing.join(', ')}</p>
      )}
    </div>
  );
}

type RadarSeries = {
  label: string;
  color: string;
  contributions: Contribution[];
};

function Radar({ series }: { series: RadarSeries[] }) {
  const size = 460;
  const center = size / 2;
  const radius = size / 2 - 110;

  if (series.length === 0) return null;
  const baseMetrics = series[0].contributions.map((c) => c.metric_code);
  const n = baseMetrics.length;
  if (n === 0) return null;

  const angleAt = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const ringLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="mx-auto max-w-lg">
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap justify-center gap-4">
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-xs text-neutral-700">{s.label}</span>
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${size} ${size}`} className="block" style={{ maxWidth: '100%', height: 'auto' }}>
        {ringLevels.map((level) => {
          const pts = Array.from({ length: n }, (_, i) => {
            const angle = angleAt(i);
            const r = level * radius;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
          }).join(' ');
          return (
            <polygon
              key={level}
              points={pts}
              fill="none"
              stroke="#e5e5e5"
              strokeWidth={1}
            />
          );
        })}

        {baseMetrics.map((_, i) => {
          const angle = angleAt(i);
          return (
            <line
              key={`axis-${i}`}
              x1={center}
              y1={center}
              x2={center + radius * Math.cos(angle)}
              y2={center + radius * Math.sin(angle)}
              stroke="#e5e5e5"
              strokeWidth={1}
            />
          );
        })}

        {series.map((s) => {
          const byMetric = new Map(s.contributions.map((c) => [c.metric_code, c]));
          const points = baseMetrics.map((code, i) => {
            const c = byMetric.get(code);
            const pct = c?.percentile ?? 0;
            const angle = angleAt(i);
            const r = (pct / 100) * radius;
            return {
              x: center + r * Math.cos(angle),
              y: center + r * Math.sin(angle),
            };
          });
          const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ') + ' Z';
          return (
            <g key={s.label}>
              <path d={pathD} fill={s.color} fillOpacity={series.length > 1 ? 0.18 : 0.22} stroke={s.color} strokeWidth={2} />
              {points.map((p, i) => (
                <circle key={`dot-${s.label}-${i}`} cx={p.x} cy={p.y} r={3} fill={s.color} />
              ))}
            </g>
          );
        })}

        {baseMetrics.map((code, i) => {
          const angle = angleAt(i);
          const labelX = center + (radius + 22) * Math.cos(angle);
          const labelY = center + (radius + 22) * Math.sin(angle);
          let anchor: 'start' | 'middle' | 'end' = 'middle';
          if (labelX < center - 10) anchor = 'end';
          else if (labelX > center + 10) anchor = 'start';

          const percentiles = series
            .map((s) => s.contributions.find((c) => c.metric_code === code)?.percentile ?? null)
            .map((v) => (v == null ? '—' : v.toFixed(0)));

          return (
            <g key={`label-${i}`}>
              <text
                x={labelX}
                y={labelY - 6}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={10}
                fill="#525252"
                fontFamily="monospace"
              >
                {code}
              </text>
              <text
                x={labelX}
                y={labelY + 7}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={9}
                fill="#a3a3a3"
              >
                {percentiles.join(' / ')}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}