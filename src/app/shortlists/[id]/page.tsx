'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FavoriteStar } from '@/components/FavoriteStar';

type Player = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  contract_until: string | null;
  market_value_eur: number | null;
};

type Item = {
  player: Player | null;
  added_at: string | null;
  snapshot_score: number | null;
  snapshot_rank: number | null;
  shortlist_note: string | null;
  note: string | null;
  status: string | null;
  contact_info: unknown;
  note_updated_at: string | null;
};

type ShortlistData = {
  shortlist: { id: string; name: string; pool_id: string | null; profile_id: string | null; created_at: string | null };
  pool: { id: string; name: string; season: string; competition: string | null } | null;
  profile: { id: string; name: string; description: string | null } | null;
  items: Item[];
};

const STATUS_OPTIONS: Array<{ value: string; label: string; color: string }> = [
  { value: '', label: 'Sem estado', color: 'bg-neutral-100 text-neutral-600' },
  { value: 'tracking', label: 'A acompanhar', color: 'bg-blue-100 text-blue-800' },
  { value: 'scouted', label: 'Visto em jogo', color: 'bg-purple-100 text-purple-800' },
  { value: 'agent_contacted', label: 'Contactado agente', color: 'bg-amber-100 text-amber-800' },
  { value: 'in_negotiation', label: 'Em negociação', color: 'bg-orange-100 text-orange-800' },
  { value: 'recruited', label: 'Recrutado', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'rejected', label: 'Descartado', color: 'bg-red-100 text-red-800' },
];

function statusLabel(value: string | null): { label: string; color: string } {
  const found = STATUS_OPTIONS.find((s) => s.value === (value ?? ''));
  return found ?? STATUS_OPTIONS[0];
}

export default function ShortlistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = useState<ShortlistData | null>(null);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null); // player_id
  const [noteDraft, setNoteDraft] = useState('');
  const [statusDraft, setStatusDraft] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/shortlists/${id}`);
    const json = await res.json();
    if (!res.ok) {
      alert(`Erro: ${json.error}`);
      return;
    }
    setData(json);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRecalculate = async () => {
    if (!confirm('Recalcular scores com dados actuais? Isto sobrescreve os snapshots existentes.')) return;
    setRecalculating(true);
    try {
      const res = await fetch(`/api/shortlists/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recalculate: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await load();
    } catch (err) {
      alert(`Erro: ${(err as Error).message}`);
    } finally {
      setRecalculating(false);
    }
  };

  const handleRemovePlayer = async (playerId: string, name: string) => {
    if (!confirm(`Remover "${name}" da shortlist?`)) return;
    const res = await fetch(`/api/shortlists/${id}/players?player_id=${playerId}`, {
      method: 'DELETE',
    });
    if (res.ok) await load();
  };

  const startEditingNote = (item: Item) => {
    if (!item.player) return;
    setEditingNote(item.player.id);
    setNoteDraft(item.note ?? '');
    setStatusDraft(item.status ?? '');
  };

  const saveNote = async (playerId: string) => {
    const res = await fetch(`/api/players/${playerId}/note`, {
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
    setEditingNote(null);
    await load();
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-50 py-10">
        <div className="mx-auto max-w-6xl px-6 text-sm text-neutral-500">A carregar…</div>
      </main>
    );
  }

  if (!data) return null;

  const { shortlist, pool, profile, items } = data;

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-6xl px-6">
        {/* Header */}
        <header className="mb-6">
          <button
            type="button"
            onClick={() => router.push('/shortlists')}
            className="mb-2 text-xs text-neutral-500 hover:text-neutral-800"
          >
            ← Voltar às shortlists
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-neutral-900">{shortlist.name}</h1>
              <p className="mt-1 text-sm text-neutral-600">
                {profile?.name ?? '(perfil apagado)'} aplicado a {pool?.name ?? '(pool apagada)'}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                {items.length} jogador{items.length === 1 ? '' : 'es'} ·
                {shortlist.created_at ? ' criada em ' + new Date(shortlist.created_at).toLocaleDateString('pt-PT') : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRecalculate}
              disabled={recalculating || !shortlist.profile_id || !shortlist.pool_id}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              title="Re-aplica o perfil aos jogadores actuais e actualiza scores."
            >
              {recalculating ? 'A recalcular…' : '↻ Recalcular'}
            </button>
          </div>
        </header>

        {/* Tabela */}
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
            Shortlist vazia. Adiciona jogadores na página de perfis.
          </div>
        ) : (
          <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-3 w-10">Rank</th>
                  <th className="px-3 py-3 w-16">Score</th>
                  <th className="px-3 py-3">Jogador</th>
                  <th className="px-3 py-3">Equipa</th>
                  <th className="px-3 py-3">Pos</th>
                  <th className="px-3 py-3">Idade</th>
                  <th className="px-3 py-3">Min</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {items.flatMap((item) => {
                  if (!item.player) return [];
                  const p = item.player;
                  const editing = editingNote === p.id;
                  const sLabel = statusLabel(item.status);
                  const rows = [
                    <tr key={p.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                      <td className="px-3 py-3 text-neutral-500">{item.snapshot_rank ?? '—'}</td>
                      <td className="px-3 py-3 font-semibold">
                        {item.snapshot_score?.toFixed(1) ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => router.push(`/players/${p.id}`)}
                          className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                        >
                          {p.name}
                        </button>
                      </td>
                      <td className="px-3 py-3 text-neutral-700">{p.current_team ?? '—'}</td>
                      <td className="px-3 py-3 text-neutral-600">{p.position_primary ?? '—'}</td>
                      <td className="px-3 py-3 text-neutral-600">{p.age ?? '—'}</td>
                      <td className="px-3 py-3 text-neutral-600">
                        {p.minutes_played?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <FavoriteStar playerId={p.id} />
                          <button
                            type="button"
                            onClick={() => router.push(`/players/${p.id}`)}
                            className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                          >
                            {p.name}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemovePlayer(p.id, p.name)}
                          className="text-xs text-red-600 hover:text-red-700"
                          title="Remover da shortlist"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>,
                  ];
                  if (editing) {
                    rows.push(
                      <tr key={`${p.id}-edit`} className="bg-neutral-50">
                        <td colSpan={9} className="px-6 py-4">
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
                              <label className="block text-xs font-medium text-neutral-600">
                                Nota (visível em todas as shortlists deste jogador)
                              </label>
                              <textarea
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                rows={3}
                                placeholder="Observações, contactos, próximos passos…"
                                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => saveNote(p.id)}
                                className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white"
                              >
                                Guardar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingNote(null)}
                                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700"
                              >
                                Cancelar
                              </button>
                              {item.note_updated_at && (
                                <span className="ml-auto text-xs text-neutral-500">
                                  última actualização: {new Date(item.note_updated_at).toLocaleDateString('pt-PT')}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  if (!editing && item.note) {
                    rows.push(
                      <tr key={`${p.id}-note`} className="bg-neutral-50/50">
                        <td colSpan={9} className="px-6 py-2 text-xs italic text-neutral-600">
                          📝 {item.note}
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}