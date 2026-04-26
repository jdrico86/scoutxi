'use client';

import { Star } from 'lucide-react';
import { useFavorites } from '@/lib/hooks/useFavorites';

type Size = 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

export function FavoriteStar({
  playerId,
  size = 'sm',
  className = '',
}: {
  playerId: string;
  size?: Size;
  className?: string;
}) {
  const { isFavorite, toggle } = useFavorites();
  const fav = isFavorite(playerId);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggle(playerId);
      }}
      title={fav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      className={`shrink-0 rounded transition-colors hover:bg-neutral-100 ${className}`}
    >
      <Star
        className={`${SIZE_CLASSES[size]} ${
          fav ? 'fill-amber-400 text-amber-400' : 'text-neutral-300 hover:text-neutral-500'
        }`}
        strokeWidth={2}
      />
    </button>
  );
}