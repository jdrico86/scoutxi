/**
 * Cálculo de percentil "midrank".
 *
 * Função pura partilhada pelo scorer (perfis com pesos) e pela pesquisa
 * avançada (filtros ad-hoc por percentil). Mantém-se em um sítio só para
 * evitar divergências.
 *
 * Midrank: se o valor é igual a outros, atribui a média das posições. Mais
 * justo que "a percentage below" — não penaliza empates.
 *
 * Ex: valores [10, 20, 20, 30], valor=20 → percentil = 50 (no meio dos empates)
 */
export function computePercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return 50; // com 1 só não faz sentido, devolve meio

  // Contagem de valores estritamente abaixo + metade dos iguais
  let below = 0;
  let equal = 0;
  for (const v of sortedValues) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  const percentile = ((below + equal / 2) / sortedValues.length) * 100;
  return Math.round(percentile * 100) / 100; // 2 casas decimais
}
