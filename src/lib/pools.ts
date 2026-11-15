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
  /** Código estável da competição; não muda quando o nome muda. */
  competition_key?: string | null;
  /** Falso para competições fora da pirâmide de escalões (sub-23, taças). */
  in_pyramid?: boolean | null;
};

/**
 * Identifica a competição entre épocas. Usa o código guardado na pool; sem
 * código, recorre a país + nome. É por aqui que a Liga Revelação de 25/26 e a
 * Liga NextGen de 26/27 contam como a mesma prova.
 */
export function competitionId(p: PoolOption): string {
  const key = p.competition_key?.trim();
  if (key) return key;
  return `${(p.country ?? '').trim().toLowerCase()}|${competitionLabel(p).toLowerCase()}`;
}

/** Gera um código a partir do país e do nome: ("Portugal", "Liga 3") → "portugal-liga-3". */
export function slugifyCompetition(country: string, name: string): string {
  return `${country} ${name}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

/**
 * Época já terminada: o dia a que as idades devem dizer respeito e quantos anos
 * passaram desde então.
 *
 * Num export de uma época passada o Wyscout escreve a idade que o jogador tem
 * HOJE. A importação acerta-a para o fim da época (30 de Junho) e regista esse
 * dia em `pools.reference_date`, que a ligação entre épocas usa para estimar o
 * ano de nascimento. Para a época em curso devolve `null`: vale a data da
 * importação.
 *
 * "21/22" a 15/11/2026 → { date: "2022-06-30", years: 4 }.
 */
export function pastSeasonReference(season: string, today: Date = new Date()): { date: string; years: number } | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(season.trim());
  if (!m) return null;
  const endYear = 2000 + Number(m[2]);
  const end = new Date(Date.UTC(endYear, 5, 30));
  if (end.getTime() >= today.getTime()) return null;
  let years = today.getUTCFullYear() - endYear;
  if (today.getUTCMonth() < 5 || (today.getUTCMonth() === 5 && today.getUTCDate() < 30)) years -= 1;
  return { date: `${endYear}-06-30`, years };
}
