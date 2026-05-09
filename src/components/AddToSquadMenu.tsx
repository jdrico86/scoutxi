'use client';

import { useEffect, useRef, useState } from 'react';
import { Users, Plus } from 'lucide-react';

type Squad = {
  id: string;
  name: string;
  formation: string;
  player_count: number;
};

const FORMATIONS = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3'] as const;

type Props = {
  playerId: string;
  /** Chamado depois de adicionar o jogador a uma squad — para a página recarregar caso queira. */
  onChange?: () => void;
};

type Feedback =
  | { kind: 'success'; squadName: string }
  | { kind: 'already'; squadName: string }
  | { kind: 'error'; message: string }
  | null;

export function AddToSquadMenu({ playerId, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [squads, setSquads] = useState<Squad[] | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFormation, setNewFormation] = useState<(typeof FORMATIONS)[number]>('4-3-3');
  const [creatingBusy, setCreatingBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFeedback(null);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Carregar squads ao abrir (1ª vez)
  useEffect(() => {
    if (!open || squads !== null) return;
    fetch('/api/squads')
      .then((r) => r.json())
      .then((j) => setSquads(j.squads ?? []))
      .catch(() => setSquads([]));
  }, [open, squads]);

  const addPlayer = async (squad: Squad) => {
    if (busyIds.has(squad.id)) return;
    setBusyIds((prev) => new Set(prev).add(squad.id));
    setFeedback(null);

    try {
      const res = await fetch(`/api/squads/${squad.id}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      });

      if (res.status === 409) {
        setFeedback({ kind: 'already', squadName: squad.name });
        return;
      }

      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ kind: 'error', message: j.error ?? 'Erro desconhecido.' });
        return;
      }

      setFeedback({ kind: 'success', squadName: squad.name });
      setSquads(
        (prev) =>
          prev?.map((s) => (s.id === squad.id ? { ...s, player_count: s.player_count + 1 } : s)) ?? prev
      );
      if (onChange) onChange();
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(squad.id);
        return next;
      });
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreatingBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/squads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, formation: newFormation }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.squad) {
        setFeedback({ kind: 'error', message: j.error ?? 'Erro a criar equipa.' });
        return;
      }

      const created: Squad = j.squad;

      // Adicionar o jogador à equipa recém-criada
      const addRes = await fetch(`/api/squads/${created.id}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId }),
      });
      if (!addRes.ok && addRes.status !== 409) {
        const aj = await addRes.json().catch(() => ({}));
        setFeedback({ kind: 'error', message: aj.error ?? 'Equipa criada mas falha a adicionar jogador.' });
        return;
      }

      setSquads((prev) => [{ ...created, player_count: 1 }, ...(prev ?? [])]);
      setFeedback({ kind: 'success', squadName: created.name });
      setCreating(false);
      setNewName('');
      setNewFormation('4-3-3');
      if (onChange) onChange();
    } catch (err) {
      setFeedback({ kind: 'error', message: (err as Error).message });
    } finally {
      setCreatingBusy(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        title="Adicionar a uma equipa-sombra"
      >
        <Users className="h-3.5 w-3.5" strokeWidth={2} />
        Equipa
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
          <div className="border-b border-neutral-100 px-3 py-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Adicionar a equipa
          </div>

          {feedback && (
            <div
              className={`px-3 py-2 text-xs ${
                feedback.kind === 'success'
                  ? 'bg-emerald-50 text-emerald-800'
                  : feedback.kind === 'already'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-red-50 text-red-800'
              }`}
            >
              {feedback.kind === 'success' && <>Adicionado a <strong>{feedback.squadName}</strong> (no banco).</>}
              {feedback.kind === 'already' && <>Já está em <strong>{feedback.squadName}</strong>.</>}
              {feedback.kind === 'error' && <>Erro: {feedback.message}</>}
            </div>
          )}

          {squads === null ? (
            <div className="px-3 py-3 text-xs text-neutral-500">A carregar…</div>
          ) : squads.length === 0 && !creating ? (
            <div className="px-3 py-4 text-center text-xs text-neutral-500">
              Ainda não tens equipas-sombra.
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {squads.map((s) => {
                const isBusy = busyIds.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => addPlayer(s)}
                      disabled={isBusy}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
                        <span>{s.formation}</span>
                        <span>·</span>
                        <span>{s.player_count}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-neutral-100 p-2">
            {creating ? (
              <div className="space-y-2 px-1 py-1">
                <input
                  type="text"
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Nome da equipa"
                  className="w-full rounded-md border border-neutral-200 px-2 py-1.5 text-sm focus:border-neutral-400 focus:outline-none"
                />
                <div className="flex items-center gap-2">
                  <select
                    value={newFormation}
                    onChange={(e) => setNewFormation(e.target.value as (typeof FORMATIONS)[number])}
                    className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm"
                  >
                    {FORMATIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={createAndAdd}
                    disabled={creatingBusy || newName.trim().length === 0}
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {creatingBusy ? 'A criar…' : 'Criar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setNewName('');
                    }}
                    disabled={creatingBusy}
                    className="text-xs text-neutral-500 hover:text-neutral-800"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setFeedback(null);
                }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-xs text-neutral-600 hover:text-neutral-900"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
                Criar nova equipa
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
