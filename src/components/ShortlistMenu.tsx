'use client';

import { useEffect, useRef, useState } from 'react';
import { ListPlus, Check } from 'lucide-react';

type Shortlist = {
  id: string;
  name: string;
  player_count: number;
};

type Props = {
  playerId: string;
  /** IDs das shortlists em que o jogador já está. Tipicamente vem da página do jogador. */
  currentShortlistIds: string[];
  /** Chamado quando uma shortlist é tocada (add/remove) — para a página recarregar dados se quiser. */
  onChange?: () => void;
};

export function ShortlistMenu({ playerId, currentShortlistIds, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [shortlists, setShortlists] = useState<Shortlist[] | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [localIds, setLocalIds] = useState<Set<string>>(new Set(currentShortlistIds));
  const containerRef = useRef<HTMLDivElement>(null);

  // Sincroniza estado local quando currentShortlistIds muda externamente
  useEffect(() => {
    setLocalIds(new Set(currentShortlistIds));
  }, [currentShortlistIds]);

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Carregar shortlists ao abrir (1ª vez)
  useEffect(() => {
    if (!open || shortlists !== null) return;
    fetch('/api/shortlists')
      .then((r) => r.json())
      .then((j) => setShortlists(j.shortlists ?? []))
      .catch(() => setShortlists([]));
  }, [open, shortlists]);

  const toggle = async (shortlistId: string) => {
    if (busyIds.has(shortlistId)) return;

    const isIn = localIds.has(shortlistId);
    setBusyIds((prev) => new Set(prev).add(shortlistId));

    // Otimismo: actualiza UI já
    const newSet = new Set(localIds);
    if (isIn) newSet.delete(shortlistId);
    else newSet.add(shortlistId);
    setLocalIds(newSet);

    try {
      const url = `/api/shortlists/${shortlistId}/players${isIn ? `?player_id=${playerId}` : ''}`;
      const res = await fetch(url, {
        method: isIn ? 'DELETE' : 'POST',
        headers: isIn ? undefined : { 'Content-Type': 'application/json' },
        body: isIn ? undefined : JSON.stringify({ player_id: playerId }),
      });
      if (!res.ok) {
        // Reverter
        setLocalIds(new Set(localIds));
        const j = await res.json();
        alert(`Erro: ${j.error}`);
      } else if (onChange) {
        onChange();
      }
    } catch (err) {
      setLocalIds(new Set(localIds));
      alert(`Erro: ${(err as Error).message}`);
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(shortlistId);
        return next;
      });
    }
  };

  const inCount = localIds.size;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${
          inCount > 0
            ? 'border-neutral-900 bg-neutral-900 text-white'
            : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
        }`}
        title={inCount > 0 ? `Em ${inCount} shortlist(s)` : 'Adicionar a shortlist'}
      >
        <ListPlus className="h-3.5 w-3.5" strokeWidth={2} />
        Shortlist{inCount > 0 ? ` (${inCount})` : ''}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
          <div className="border-b border-neutral-100 px-3 py-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            As tuas shortlists
          </div>

          {shortlists === null ? (
            <div className="px-3 py-3 text-xs text-neutral-500">A carregar…</div>
          ) : shortlists.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-neutral-500">
              Não tens shortlists ainda.
              <br />
              <a
                href="/shortlists"
                className="mt-1 inline-block text-neutral-700 underline"
              >
                Criar uma
              </a>
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {shortlists.map((s) => {
                const isIn = localIds.has(s.id);
                const isBusy = busyIds.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      disabled={isBusy}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50 ${
                        isIn ? 'bg-neutral-50' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-neutral-400">{s.player_count}</span>
                        {isIn && (
                          <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="border-t border-neutral-100 px-3 py-2">
            <a
              href="/shortlists"
              className="text-xs text-neutral-600 hover:text-neutral-900"
            >
              + Criar nova shortlist
            </a>
          </div>
        </div>
      )}
    </div>
  );
}