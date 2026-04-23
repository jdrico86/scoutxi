'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Shortlist = {
  id: string;
  name: string;
  pool_id: string | null;
  profile_id: string | null;
  created_at: string | null;
  player_count: number;
};

type Pool = { id: string; name: string; season: string };
type Profile = { id: string; name: string };

export default function ShortlistsPage() {
  const router = useRouter();
  const [shortlists, setShortlists] = useState<Shortlist[]>([]);
  const [pools, setPools] = useState<Pool[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  // Form criar
  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPoolId, setFormPoolId] = useState('');
  const [formProfileId, setFormProfileId] = useState('');
  const [formLimit, setFormLimit] = useState(30);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadAll = async () => {
    const [slRes, poolRes, profRes] = await Promise.all([
      fetch('/api/shortlists').then((r) => r.json()),
      fetch('/api/pools').then((r) => r.json()),
      fetch('/api/profiles').then((r) => r.json()),
    ]);
    setShortlists(slRes.shortlists ?? []);
    setPools(poolRes.pools ?? []);
    setProfiles(profRes.profiles ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreate = async () => {
    if (!formName || !formPoolId || !formProfileId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/shortlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          pool_id: formPoolId,
          profile_id: formProfileId,
          limit: formLimit,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      setFormOpen(false);
      setFormName('');
      setFormPoolId('');
      setFormProfileId('');
      await loadAll();
      // Abrir a shortlist nova
      if (json.shortlist?.id) router.push(`/shortlists/${json.shortlist.id}`);
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Apagar a shortlist "${name}"? Esta acção não pode ser desfeita.`)) return;
    const res = await fetch(`/api/shortlists/${id}`, { method: 'DELETE' });
    if (res.ok) await loadAll();
  };

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-5xl px-6">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Shortlists</h1>
            <p className="mt-2 text-sm text-neutral-600">
              Listas de prospects que estás a acompanhar. Cada shortlist é gerada a partir de
              um perfil aplicado a uma pool, e podes recalcular scores com dados actualizados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            {formOpen ? 'Cancelar' : '+ Nova shortlist'}
          </button>
        </header>

        {/* Form criar */}
        {formOpen && (
          <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-neutral-900">Criar shortlist</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Aplica um perfil a um pool e guarda o top N como shortlist. Podes adicionar/remover
              jogadores depois.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600">Nome</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Extremos CdP — alvos verão 2026"
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600">Pool</label>
                  <select
                    value={formPoolId}
                    onChange={(e) => setFormPoolId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— escolhe —</option>
                    {pools.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600">Perfil</label>
                  <select
                    value={formProfileId}
                    onChange={(e) => setFormProfileId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">— escolhe —</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600">Top N</label>
                  <input
                    type="number"
                    value={formLimit}
                    onChange={(e) => setFormLimit(parseInt(e.target.value) || 30)}
                    min={1}
                    max={200}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {createError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {createError}
                </div>
              )}
              <button
                type="button"
                onClick={handleCreate}
                disabled={!formName || !formPoolId || !formProfileId || creating}
                className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {creating ? 'A criar…' : 'Criar shortlist'}
              </button>
            </div>
          </section>
        )}

        {/* Lista */}
        {loading ? (
          <div className="text-sm text-neutral-500">A carregar…</div>
        ) : shortlists.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
            Nenhuma shortlist ainda. Cria a primeira clicando em &quot;+ Nova shortlist&quot; em cima.
          </div>
        ) : (
          <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-2">Nome</th>
                  <th className="px-4 py-2">Jogadores</th>
                  <th className="px-4 py-2">Criada</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {shortlists.map((s) => (
                  <tr key={s.id} className="border-t border-neutral-100">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => router.push(`/shortlists/${s.id}`)}
                        className="text-left font-medium text-neutral-900 hover:underline"
                      >
                        {s.name}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{s.player_count}</td>
                    <td className="px-4 py-3 text-xs text-neutral-500">
                      {s.created_at ? new Date(s.created_at).toLocaleDateString('pt-PT') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id, s.name)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Apagar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </main>
  );
}