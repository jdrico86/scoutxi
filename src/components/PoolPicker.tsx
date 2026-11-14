'use client';

/**
 * Escolha de pool em dois campos: época e competição, esta agrupada por país
 * e ordenada por escalão.
 *
 * Um componente único para todas as páginas — antes havia seis cópias de uma
 * lista com as pools pela ordem em que tinham sido criadas, épocas misturadas.
 * Com 12 pools era desarrumado; com 30 ligas e três épocas seriam 90 linhas.
 *
 * O valor é o id da pool (ou '' sem escolha). A época mostrada segue a pool
 * escolhida; sem pool, abre na época mais recente. Ao mudar de época mantém a
 * mesma competição, se existir nessa época.
 */

import { useState } from 'react';
import { competitionLabel, groupPoolsByCountry, poolSeasons, type PoolOption } from '@/lib/pools';

type Props = {
  pools: PoolOption[];
  value: string;
  onChange: (poolId: string) => void;
  /** Classes dos dois <select>, para condizer com o formulário da página. */
  selectClassName?: string;
  className?: string;
  disabled?: boolean;
};

const DEFAULT_SELECT = 'rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm';

export function PoolPicker({ pools, value, onChange, selectClassName, className, disabled }: Props) {
  // Época escolhida à mão quando ainda não há pool (ou quando a competição
  // anterior não existe na época nova).
  const [pickedSeason, setPickedSeason] = useState<string | null>(null);

  const seasons = poolSeasons(pools);
  const current = pools.find((p) => p.id === value) ?? null;
  const season =
    current?.season ?? (pickedSeason && seasons.includes(pickedSeason) ? pickedSeason : seasons[0]) ?? '';
  const groups = groupPoolsByCountry(pools, season);
  const selectClass = selectClassName ?? DEFAULT_SELECT;

  const handleSeason = (next: string) => {
    setPickedSeason(next);
    if (!current) return;
    // Mesma competição (e país) na época nova, se existir.
    const same = pools.find(
      (p) =>
        p.season === next &&
        competitionLabel(p) === competitionLabel(current) &&
        (p.country ?? '') === (current.country ?? '')
    );
    onChange(same ? same.id : '');
  };

  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      <select
        aria-label="Época"
        value={season}
        disabled={disabled}
        onChange={(e) => handleSeason(e.target.value)}
        className={`${selectClass} w-24 shrink-0`}
      >
        {/* Enquanto as pools não chegam, um traço — e não um campo desactivado:
            o estado "desactivado" dependia de dados que só existem no browser,
            e alguns browsers repõem-no ao recarregar, o que fazia o React
            avisar de uma diferença entre servidor e cliente. */}
        {seasons.length === 0 && <option value="">—</option>}
        {seasons.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        aria-label="Competição"
        value={current ? current.id : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectClass} min-w-0 flex-1`}
      >
        <option value="">— escolhe a competição —</option>
        {groups.map((g) => (
          <optgroup key={g.country} label={g.country}>
            {g.pools.map((p) => (
              <option key={p.id} value={p.id}>
                {competitionLabel(p)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
