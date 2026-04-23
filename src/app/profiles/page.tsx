'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
  age: number | null;
  minutes_played: number | null;
  contract_until: string | null;
  market_value_eur: number | null;
  score: number;
  contributions: Contribution[];
  missing_metrics: string[];
};

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

export default function ProfilesPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedPoolId, setSelectedPoolId] = useState<string>('');
  const [result, setResult] = useState<ScoreResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    const res = await fetch('/api/profiles');
    const json = await res.json();
    setProfiles(json.profiles ?? []);
  }, []);

  useEffect(() => {
    loadProfiles();
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
  }, [loadProfiles]);

  const runScore = useCallback(async () => {
    if (!selectedProfileId || !selectedPoolId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setExpandedRow(null);
    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: selectedPoolId, profile_id: selectedProfileId, limit: 100 }),
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

  const handleSaveShortlist = useCallback(async () => {
    if (!result) return;
    const defaultName = `${result.profile.name} · ${result.pool.name}`;
    const name = prompt('Nome da shortlist:', defaultName);
    if (!name) return;
    const res = await fetch('/api/shortlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        pool_id: selectedPoolId,
        profile_id: selectedProfileId,
        limit: result.ranked.length,
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
  }, [result, selectedPoolId, selectedProfileId, router]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Perfis de scouting</h1>
            <p className="mt-2 text-sm text-neutral-600">
              Aplica um perfil a um pool para ver o ranking. Podes editar perfis existentes,
              duplicar para criar variantes, ou criar um novo do zero.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push('/profiles/new')}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            + Novo perfil
          </button>
        </header>

        {/* ── Lista de perfis com acções ──────────────────────────────── */}
        <section className="mb-8 rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-6 py-3 text-sm font-semibold text-neutral-900">
            Perfis disponíveis ({profiles.length})
          </div>
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
              <select
                value={selectedPoolId}
                onChange={(e) => setSelectedPoolId(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— escolhe um pool —</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.season})
                  </option>
                ))}
              </select>
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
                  {result.eligible_count} elegíveis · peer group {result.peer_group_size} · pool{' '}
                  {result.total_players_in_pool}
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
                + Guardar como shortlist
              </button>
            </div>

            {result.ranked.length === 0 ? (
              <div className="p-6 text-sm text-neutral-600">
                Zero jogadores elegíveis. Verifica os filtros do perfil.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Score</th>
                    <th className="px-4 py-3">Jogador</th>
                    <th className="px-4 py-3">Equipa</th>
                    <th className="px-4 py-3">Pos</th>
                    <th className="px-4 py-3">Idade</th>
                    <th className="px-4 py-3">Min</th>
                    <th className="px-4 py-3">Contrato</th>
                    <th className="px-4 py-3">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.flatMap((p, i) => {
                    const expanded = expandedRow === p.player_id;
                    const rows = [
                      <tr
                        key={p.player_id}
                        onClick={() => setExpandedRow(expanded ? null : p.player_id)}
                        className={`cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 ${
                          expanded ? 'bg-neutral-50' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-neutral-500">{i + 1}</td>
                        <td className="px-4 py-3 font-semibold">{p.score.toFixed(1)}</td>
                        <td className="px-4 py-3 font-medium text-neutral-900">{p.name}</td>
                        <td className="px-4 py-3 text-neutral-700">{p.current_team ?? '—'}</td>
                        <td className="px-4 py-3 text-neutral-600">{p.position_primary ?? '—'}</td>
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
                                {p.contributions.map((c) => (
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
                            {p.missing_metrics.length > 0 && (
                              <p className="mt-2 text-xs text-amber-700">
                                Métricas em falta: {p.missing_metrics.join(', ')}
                              </p>
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
          </section>
        )}
      </div>
    </main>
  );
}