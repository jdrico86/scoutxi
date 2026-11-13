/**
 * Chave de identidade de um jogador dentro de uma pool.
 *
 * Nome + equipa + altura + pé. NUNCA a idade: o Wyscout escreve-a à data do
 * export, por isso quem faz anos entre duas importações passava a ser um
 * jogador novo (143 duplicados no CP 26/27 à J8).
 *
 * Vive num ficheiro só e é usada pelo parser (duplicados dentro do ficheiro) e
 * pela rota de import (jogadores já existentes na pool). As duas têm de usar
 * exactamente a mesma chave — a correcção de 11/11/2026 perdeu-se uma vez por
 * estar escrita inline na rota.
 *
 * Altura 0 e altura vazia contam como iguais: o Wyscout escreve 0 quando não
 * tem o dado.
 */
export function playerKey(
  name: string,
  team: string | null | undefined,
  height: unknown,
  foot: unknown
): string {
  const h = Number(height);
  const heightPart = Number.isFinite(h) && h > 0 ? String(Math.round(h)) : '';
  const footPart = foot == null ? '' : String(foot).trim().toLowerCase();
  return [name.trim().toLowerCase(), (team ?? '').trim().toLowerCase(), heightPart, footPart].join('::');
}
