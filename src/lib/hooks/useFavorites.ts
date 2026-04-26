'use client';

import { useEffect, useState, useCallback } from 'react';

let cachedFavorites: Set<string> | null = null;
const subscribers = new Set<(s: Set<string>) => void>();

function notify(next: Set<string>) {
  cachedFavorites = next;
  for (const s of subscribers) s(new Set(next));
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(cachedFavorites ?? new Set());
  const [loaded, setLoaded] = useState<boolean>(cachedFavorites !== null);

  useEffect(() => {
    const sub = (s: Set<string>) => setFavorites(s);
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
    };
  }, []);

  useEffect(() => {
    if (cachedFavorites !== null) return;
    fetch('/api/favorites')
      .then((r) => r.json())
      .then((j) => {
        const set = new Set<string>(j.player_ids ?? []);
        notify(set);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const toggle = useCallback(async (playerId: string) => {
    const isCurrentlyFav = (cachedFavorites ?? new Set()).has(playerId);
    // Otimista: atualizar UI imediatamente
    const next = new Set(cachedFavorites ?? new Set());
    if (isCurrentlyFav) next.delete(playerId);
    else next.add(playerId);
    notify(next);

    try {
      if (isCurrentlyFav) {
        await fetch(`/api/favorites?player_id=${playerId}`, { method: 'DELETE' });
      } else {
        await fetch('/api/favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ player_id: playerId }),
        });
      }
    } catch (e) {
      // Reverter em caso de erro
      const reverted = new Set(cachedFavorites ?? new Set());
      if (isCurrentlyFav) reverted.add(playerId);
      else reverted.delete(playerId);
      notify(reverted);
    }
  }, []);

  const isFavorite = useCallback((playerId: string) => favorites.has(playerId), [favorites]);

  return { favorites, isFavorite, toggle, loaded };
}