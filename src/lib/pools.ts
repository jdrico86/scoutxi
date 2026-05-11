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
