'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Users } from 'lucide-react';

type Squad = {
  id: string;
  name: string;
  formation: string;
  notes: string | null;
  player_count: number;
  created_at: string | null;
  updated_at: string | null;
};

const FORMATIONS = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3'] as const;

export default function SquadsPage() {
  const router = useRouter();
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formFormation, setFormFormation] = useState<(typeof FORMATIONS)[number]>('4-3-3');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch('/api/squads').then((r) => r.json());
    setSquads(res.squads ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setFormName('');
    setFormFormation('4-3-3');
    setCreateError(null);
  };

  const handleCreate = async () => {
    const name = formName.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch('/api/squads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, formation: formFormation }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      setFormOpen(false);
      resetForm();
      if (json.squad?.id) {
        router.push(`/squads/${json.squad.id}`);
      } else {
        await load();
      }
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Apagar a equipa "${name}"? Esta acção não pode ser desfeita.`)) return;
    const res = await fetch(`/api/squads/${id}`, { method: 'DELETE' });
    if (res.ok) await load();
  };

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-5xl px-6">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Minhas Equipas</h1>
            <p className="mt-2 text-sm text-neutral-600">
              Equipas-sombra que constróis manualmente: escolhes a formação, adicionas
              jogadores das pools e organiza-os no campo. Pode misturar jogadores de várias pools.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setFormOpen((v) => !v);
              if (formOpen) resetForm();
            }}
            className="shrink-0 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            {formOpen ? 'Cancelar' : '+ Nova equipa'}
          </button>
        </header>

        {formOpen && (
          <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-neutral-900">Criar equipa</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Cria uma equipa vazia com um sistema táctico. Adicionas jogadores depois — a partir
              das fichas dos jogadores ou desta página.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-neutral-600">Nome</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Onze ideal Liga 1 25/26"
                  autoFocus
                  className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600">Formação</label>
                <select
                  value={formFormation}
                  onChange={(e) => setFormFormation(e.target.value as (typeof FORMATIONS)[number])}
                  className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
                >
                  {FORMATIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {createError && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {createError}
              </div>
            )}

            <button
              type="button"
              onClick={handleCreate}
              disabled={!formName.trim() || creating}
              className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {creating ? 'A criar…' : 'Criar equipa'}
            </button>
          </section>
        )}

        {loading ? (
          <div className="text-sm text-neutral-500">A carregar…</div>
        ) : squads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500">
            Ainda não tens equipas-sombra.
            <br />
            Cria a primeira clicando em &quot;+ Nova equipa&quot; em cima.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {squads.map((s) => (
              <SquadCard
                key={s.id}
                squad={s}
                onOpen={() => router.push(`/squads/${s.id}`)}
                onDelete={() => handleDelete(s.id, s.name)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function SquadCard({
  squad,
  onOpen,
  onDelete,
}: {
  squad: Squad;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const updated = squad.updated_at
    ? new Date(squad.updated_at).toLocaleDateString('pt-PT', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <div className="group relative flex flex-col rounded-lg border border-neutral-200 bg-white p-5 transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Apagar equipa"
        className="absolute right-3 top-3 rounded p-1 text-neutral-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex-1 text-left"
      >
        <h3 className="pr-6 text-base font-semibold text-neutral-900 group-hover:text-emerald-700">
          {squad.name}
        </h3>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">
            {squad.formation}
          </span>
          <span className="flex items-center gap-1 text-xs text-neutral-500">
            <Users className="h-3 w-3" strokeWidth={2} />
            {squad.player_count} jogador{squad.player_count === 1 ? '' : 'es'}
          </span>
        </div>
        {updated && (
          <p className="mt-3 text-xs text-neutral-400">
            Actualizada em {updated}
          </p>
        )}
      </button>
    </div>
  );
}
