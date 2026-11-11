/**
 * Regra única de correspondência de posições.
 *
 * O Wyscout dá várias posições por jogador na coluna "Posição" ("LAMF, LW").
 * O import guarda a primeira em `position_primary` e as restantes em
 * `positions_secondary`. Até 12/11/2026 a elegibilidade olhava só para a
 * primária, e 62,6% dos jogadores da pool do Campeonato de Portugal têm pelo
 * menos uma secundária — ou seja, mais de metade do universo era avaliado por
 * uma posição só. Um extremo registado como LAMF/LW ficava fora de perfis de
 * extremo que listassem apenas LW e RW.
 *
 * ATENÇÃO — elegibilidade e peer group NÃO usam a mesma regra, e a diferença
 * é deliberada:
 *
 *  - Elegibilidade (`matchesPositions`): larga. Faz sentido avaliar um
 *    LAMF/LW num perfil de extremo.
 *  - Peer group (`matchesPrimaryPosition`): estreito. O percentil só significa
 *    alguma coisa se a régua for "comparado com médios ofensivos a sério".
 *
 * Isto foi medido, não assumido. No Campeonato de Portugal 26/27, alargar o
 * peer group de AMF/LAMF/RAMF às secundárias leva-o de 115 para 296 jogadores,
 * e os 175 que entram só por secundária têm medianas muito mais baixas em todas
 * as métricas criativas — key_passes_90 0,220 contra 0,385, xa_per_90 0,060
 * contra 0,080. Com a régua alargada os scores sobem por diluição e deixam de
 * ser comparáveis com os das semanas anteriores.
 */

export type HasPositions = {
  position_primary: string | null;
  positions_secondary?: string[] | null;
};

/** Todas as posições que o jogador ocupa, primária à frente, sem repetidos. */
export function playerPositions(p: HasPositions): string[] {
  const out: string[] = [];
  const add = (v: string | null | undefined) => {
    const s = (v ?? '').trim();
    if (s && !out.includes(s)) out.push(s);
  };
  add(p.position_primary);
  for (const s of p.positions_secondary ?? []) add(s);
  return out;
}

/**
 * Verdadeiro se alguma posição do jogador está na lista aceite.
 * Lista vazia ou ausente significa "sem restrição de posição".
 */
export function matchesPositions(p: HasPositions, accepted?: string[] | null): boolean {
  if (!accepted || accepted.length === 0) return true;
  const mine = playerPositions(p);
  return mine.some((pos) => accepted.includes(pos));
}

/**
 * Só a posição primária. É o critério do PEER GROUP — a amostra contra a qual
 * os percentis são calculados. Manter esta régua estreita é o que impede os
 * scores de subirem sozinhos quando a elegibilidade se alarga.
 */
export function matchesPrimaryPosition(p: HasPositions, accepted?: string[] | null): boolean {
  if (!accepted || accepted.length === 0) return true;
  const primary = (p.position_primary ?? '').trim();
  return primary.length > 0 && accepted.includes(primary);
}
