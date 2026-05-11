'use client';

import { useState } from 'react';
import { ModalShell } from './ModalShell';

type Props = {
  positions: string[];
  generalFilters: {
    min_age?: number;
    max_age?: number;
    min_minutes?: number;
    on_loan?: boolean;
  };
  /** Métricas activas — só mostramos como aviso, não são preservadas em v1. */
  hasMetricFilters: boolean;
  onClose: () => void;
  onSaved: (profileId: string) => void;
};

export function SaveAsProfileModal({
  positions,
  generalFilters,
  hasMetricFilters,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/scout/save-as-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || undefined,
          positions: positions.length > 0 ? positions : undefined,
          general_filters:
            Object.keys(generalFilters).length > 0 ? generalFilters : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro a criar perfil.');
      onSaved(json.profile?.id ?? '');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Guardar como perfil" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-neutral-500">
          Vai criar um perfil com os filtros gerais actuais (posições, idade, minutos,
          empréstimo). Pesos ficam vazios — defines depois no editor de perfis se quiseres
          ranking ponderado.
        </p>

        {hasMetricFilters && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            ⚠ Filtros de métrica <strong>não</strong> são preservados em perfis (ainda) —
            só posições, idade, minutos e empréstimo. Em v2 vamos estender o schema.
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-neutral-700">Nome do perfil</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="Ex: Médios ofensivos jovens"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-700">
            Descrição (opcional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Notas sobre este perfil…"
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-neutral-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim()}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {saving ? 'A guardar…' : 'Guardar perfil'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
