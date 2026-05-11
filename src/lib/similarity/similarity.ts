/**
 * Cálculo de similaridade entre jogadores via distância euclidiana ponderada
 * sobre vector de percentis.
 *
 * Tese: comparar jogadores em posição relativa dentro da pool dele (percentil),
 * não em valores brutos. Aursnes top-10% xA na Liga Portugal vs MC top-10%
 * xA no CdP = "similar" ainda que a magnitude absoluta seja muito diferente.
 *
 * Distância:
 *   d = sqrt( Σ w_i * (pct_anchor_i - pct_candidate_i)² )
 * Distância máxima teórica (todos os pares no extremo oposto):
 *   d_max = sqrt( Σ w_i * 100² ) = 100 * sqrt( Σ w_i )
 * Similaridade apresentada: 0-100, intuitiva
 *   sim = 100 * (1 - d / d_max)
 *
 * Função pura: testável sem Supabase. Os percentis recebidos JÁ devem estar
 * invertidos para métricas "lower_better" (goals_conceded_90, etc.) — isso é
 * responsabilidade do recalculate.ts que popula player_percentiles.
 *
 * ── Bandas de interpretação (validação empírica em CdP 25/26) ────────────
 * Para N=12 métricas, weights iguais (lens=full), top-N entre 50 candidatos
 * por pool, as bandas reais observadas são:
 *
 *   95-100%  CLONE — extremamente raro, requer <5 percentis RMS de diferença
 *            em TODAS as métricas. Praticamente só acontece com o próprio.
 *   85-95%   MUITO PARECIDO — perfil estatístico quase sobreposto. Top-1
 *            num pool grande tipicamente cai aqui.
 *   70-85%   PARECIDO COM DIFERENÇAS — mesmo arquétipo, força em métricas
 *            distintas. A maior parte do top-10 vive nesta banda.
 *   60-70%   FAMÍLIA SEMELHANTE — perfil próximo mas com gaps importantes.
 *   <60%     PERFIL DISTINTO — partilham só algumas dimensões.
 *
 * Para UI (Fase 2), considerar mostrar etiqueta semântica ao lado da %
 * conforme estas bandas (ex: "86.6% — muito parecido"). Não a inflacionar
 * a percepção (banda 100%+ implícita = clone), só a contextualizar.
 */

export type Lens =
  | { mode: 'full' }
  | { mode: 'profile'; profile_id: string }
  | { mode: 'custom'; weights: Record<string, number> };

export type SimilarityQuery = {
  anchor: { pool_id: string; player_id: string };
  target_pools: string[];
  positions: string[];
  min_minutes: number;
  age_range?: [number, number];
  lens: Lens;
};

export type CandidateMetric = {
  metric_code: string;
  percentile: number;
  raw_value: number | null;
};

export type AnchorRecord = {
  player_id: string;
  position: string;
  metrics: CandidateMetric[];
};

export type CandidateRecord = {
  player_id: string;
  position: string;
  metrics: CandidateMetric[];
};

export type SimilarityContribution = {
  metric_code: string;
  anchor_percentile: number;
  candidate_percentile: number;
  delta_percentile: number; // candidate - anchor (signed)
  weight: number;
  contribution: number; // weight * |delta|
};

export type ScoredCandidate = {
  player_id: string;
  position: string;
  similarity: number; // 0-100
  contributions: SimilarityContribution[];
  /** Até 2 métricas: ambos com percentil >= threshold e contribuição pequena. */
  top_similar: Array<{ metric_code: string; both_percentile: number }>;
  /** Até 2 métricas: maior contribuição, com sinal. */
  top_different: Array<{ metric_code: string; delta_percentile: number; direction: '+' | '-' }>;
};

export function computeSimilarity(args: {
  anchor: AnchorRecord;
  candidates: CandidateRecord[];
  weights: Record<string, number>;
  topN?: number;
  /** Limiar de percentil para qualificar como "parecidos em" (ambos têm de ser fortes). Default 60. */
  similarThreshold?: number;
}): ScoredCandidate[] {
  const { anchor, candidates, weights, topN = 50, similarThreshold = 60 } = args;

  // Index âncora
  const anchorPctByCode = new Map<string, number>();
  for (const m of anchor.metrics) anchorPctByCode.set(m.metric_code, m.percentile);

  // Métricas activas: peso > 0 E âncora tem percentil para ela.
  const activeMetrics = Object.entries(weights)
    .filter(([code, w]) => w > 0 && anchorPctByCode.has(code))
    .map(([code, weight]) => ({ code, weight }));

  if (activeMetrics.length === 0) return [];

  const sumWeights = activeMetrics.reduce((s, m) => s + m.weight, 0);
  // Distância máxima teórica
  const dmax = 100 * Math.sqrt(sumWeights);

  const scored: ScoredCandidate[] = [];

  for (const c of candidates) {
    if (c.player_id === anchor.player_id) continue;

    const candByCode = new Map<string, CandidateMetric>();
    for (const m of c.metrics) candByCode.set(m.metric_code, m);

    const contributions: SimilarityContribution[] = [];
    let sumSq = 0;

    for (const { code, weight } of activeMetrics) {
      const candM = candByCode.get(code);
      if (!candM) continue; // candidato sem valor para esta métrica → ignora
      const pa = anchorPctByCode.get(code)!;
      const pc = candM.percentile;
      const delta = pc - pa;
      sumSq += weight * delta * delta;
      contributions.push({
        metric_code: code,
        anchor_percentile: pa,
        candidate_percentile: pc,
        delta_percentile: delta,
        weight,
        contribution: weight * Math.abs(delta),
      });
    }

    if (contributions.length === 0) continue;

    const distance = Math.sqrt(sumSq);
    const similarity = Math.max(0, 100 * (1 - distance / dmax));

    // Top similar: ambos os percentis acima do threshold + menor contribuição
    const similar = contributions
      .filter(
        (c) =>
          c.anchor_percentile >= similarThreshold && c.candidate_percentile >= similarThreshold
      )
      .sort((a, b) => a.contribution - b.contribution)
      .slice(0, 2)
      .map((c) => ({
        metric_code: c.metric_code,
        both_percentile: Math.min(c.anchor_percentile, c.candidate_percentile),
      }));

    // Top different: maior contribuição (qualquer percentil)
    const different = [...contributions]
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 2)
      .map((c) => ({
        metric_code: c.metric_code,
        delta_percentile: c.delta_percentile,
        direction: (c.delta_percentile >= 0 ? '+' : '-') as '+' | '-',
      }));

    scored.push({
      player_id: c.player_id,
      position: c.position,
      similarity: Math.round(similarity * 100) / 100,
      contributions,
      top_similar: similar,
      top_different: different,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);

  // Dedup por player_id (pode haver mesmo player em múltiplas posições): keep highest
  const seen = new Map<string, ScoredCandidate>();
  for (const s of scored) {
    const existing = seen.get(s.player_id);
    if (!existing || s.similarity > existing.similarity) seen.set(s.player_id, s);
  }

  return Array.from(seen.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN);
}
