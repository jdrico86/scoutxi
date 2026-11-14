/**
 * Helpers de display de pools.
 */

/**
 * Devolve o nome formatado da pool para apresentação ao utilizador.
 *
 * Trata duplicação histórica: algumas pools têm o `season` já incluído no
 * `name` (ex: name="Campeonato de Portugal 25/26", season="25/26"). Concat
 * naïve produzia "Campeonato de Portugal 25/26 25/26".
 *
 * Aceita também o caso em que `name` NÃO inclui o season — concatena
 * normalmente. Robust se a BD for normalizada no futuro.
 */
export function formatPoolName(name: string, season: string | null | undefined): string {
  if (!season) return name;
  const trimmedName = name.trim();
  const trimmedSeason = season.trim();
  if (!trimmedSeason) return trimmedName;
  if (trimmedName === trimmedSeason) return trimmedName;
  if (trimmedName.endsWith(` ${trimmedSeason}`)) return trimmedName;
  if (trimmedName.endsWith(trimmedSeason)) return trimmedName;
  return `${trimmedName} ${trimmedSeason}`;
}

// ── Ordenação e agrupamento ──────────────────────────────────────────────

/**
 * O que a escolha de pool precisa de saber. `country` e `tier` vêm da tabela
 * `pools` desde 14/11/2026; são opcionais para pools antigas sem esses dados.
 */
export type PoolOption = {
  id: string;
  name: string;
  season: string;
  competition?: string | null;
  country?: string | null;
  tier?: number | null;
};

/** Grupo para pools sem país preenchido. */
export const NO_COUNTRY = 'Outros';

/** Nome da competição sem a época: "Liga 3 26/27" → "Liga 3". */
export function competitionLabel(p: PoolOption): string {
  if (p.competition && p.competition.trim()) return p.competition.trim();
  const name = p.name.trim();
  const season = p.season?.trim();
  return season && name.endsWith(season) ? name.slice(0, -season.length).trim() : name;
}

/** Épocas existentes, da mais recente para a mais antiga. */
export function poolSeasons(pools: PoolOption[]): string[] {
  return Array.from(new Set(pools.map((p) => p.season))).sort((a, b) => b.localeCompare(a));
}

/**
 * Ordem única para qualquer lista de pools: época mais recente primeiro,
 * depois país (os sem país no fim), escalão (os sem escalão no fim) e nome.
 */
export function comparePools(a: PoolOption, b: PoolOption): number {
  if (a.season !== b.season) return b.season.localeCompare(a.season);
  const ca = a.country ?? '';
  const cb = b.country ?? '';
  if (ca !== cb) {
    if (!ca) return 1;
    if (!cb) return -1;
    return ca.localeCompare(cb, 'pt');
  }
  const ta = a.tier ?? Number.MAX_SAFE_INTEGER;
  const tb = b.tier ?? Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return competitionLabel(a).localeCompare(competitionLabel(b), 'pt');
}

/** Pools de uma época agrupadas por país, já ordenadas. */
export function groupPoolsByCountry(
  pools: PoolOption[],
  season: string
): Array<{ country: string; pools: PoolOption[] }> {
  const groups = new Map<string, PoolOption[]>();
  for (const p of pools.filter((x) => x.season === season).sort(comparePools)) {
    const key = p.country?.trim() || NO_COUNTRY;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  return Array.from(groups, ([country, list]) => ({ country, pools: list }));
}
