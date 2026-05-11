/**
 * Orquestração da pesquisa de similaridade.
 *
 * Carrega percentis da âncora + candidatos via 1-2 queries a player_percentiles
 * (linhas leves, sem stats brutos). Resolve weights conforme o lens. Chama
 * computeSimilarity (puro). Hidrata com info de jogadores e pools.
 *
 * Separado do route handler para o test script poder exercitar a feature
 * sem passar pelo HTTP/auth.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeSimilarity,
  type AnchorRecord,
  type CandidateRecord,
  type ScoredCandidate,
  type SimilarityQuery,
} from './similarity';
import { getMetricsForPosition, POSITION_METRICS } from './position-metrics';

export type SimilarityPlayer = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  positions_secondary: string[] | null;
  age: number | null;
  minutes_played: number | null;
  pool_id: string;
  pool_name: string | null;
};

export type SimilarityResponseItem = ScoredCandidate & {
  player: SimilarityPlayer;
};

export type SimilarityResponse = {
  anchor: SimilarityPlayer & {
    arquetype_positions: string[]; // posições no mesmo arquétipo (mesmo metric set)
  };
  weights: Record<string, number>;
  candidates: SimilarityResponseItem[];
  warnings: string[];
};

const PAGE = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = SupabaseClient<any>;

/** Devolve outras posições que partilham o mesmo metric set da posição dada. */
function getArquetypePositions(position: string): string[] {
  const targetMetrics = getMetricsForPosition(position);
  if (targetMetrics.length === 0) return [];
  const same: string[] = [];
  for (const [pos, metrics] of Object.entries(POSITION_METRICS)) {
    if (metrics === targetMetrics) same.push(pos); // mesma referência → mesmo arquétipo
  }
  return same;
}

export async function runSimilarityQuery(
  supabase: SB,
  query: SimilarityQuery
): Promise<SimilarityResponse> {
  const warnings: string[] = [];

  // ── 1. Carregar âncora ───────────────────────────────────────────────
  const { data: anchorPlayer, error: anchorErr } = await supabase
    .from('players')
    .select(
      'id, name, current_team, team_in_period, position_primary, positions_secondary, age, minutes_played, pool_id'
    )
    .eq('id', query.anchor.player_id)
    .eq('pool_id', query.anchor.pool_id)
    .maybeSingle();
  if (anchorErr) throw anchorErr;
  if (!anchorPlayer) throw new Error('Âncora não encontrada na pool indicada.');

  const anchorPosition = (anchorPlayer as { position_primary: string | null }).position_primary;
  if (!anchorPosition) throw new Error('Âncora sem position_primary definida.');

  const arquetypePositions = getArquetypePositions(anchorPosition);
  if (arquetypePositions.length === 0) {
    throw new Error(`Posição '${anchorPosition}' não tem métricas configuradas.`);
  }

  // Posições válidas = intersecção entre query.positions e arquetype
  const allowedPositions = query.positions.filter((p) => arquetypePositions.includes(p));
  if (allowedPositions.length === 0) {
    throw new Error(
      `Posições escolhidas ${JSON.stringify(query.positions)} não intersectam o arquétipo da âncora (${arquetypePositions.join(', ')}).`
    );
  }

  // ── 2. Carregar percentis da âncora (apenas a sua posição) ───────────
  const { data: anchorPctRows, error: aPctErr } = await supabase
    .from('player_percentiles')
    .select('metric_code, percentile, raw_value')
    .eq('pool_id', query.anchor.pool_id)
    .eq('player_id', query.anchor.player_id)
    .eq('position', anchorPosition);
  if (aPctErr) throw aPctErr;
  if (!anchorPctRows || anchorPctRows.length === 0) {
    throw new Error('Âncora sem percentis calculados. Recalcula a pool primeiro.');
  }
  const anchorRecord: AnchorRecord = {
    player_id: query.anchor.player_id,
    position: anchorPosition,
    metrics: (anchorPctRows as Array<{ metric_code: string; percentile: number; raw_value: number | null }>).map(
      (r) => ({
        metric_code: r.metric_code,
        percentile: r.percentile,
        raw_value: r.raw_value,
      })
    ),
  };

  // ── 3. Resolver weights conforme lens ────────────────────────────────
  const weights: Record<string, number> = {};
  if (query.lens.mode === 'full') {
    for (const m of getMetricsForPosition(anchorPosition)) weights[m] = 1;
  } else if (query.lens.mode === 'profile') {
    const { data: profile } = await supabase
      .from('scouting_profiles')
      .select('weights')
      .eq('id', query.lens.profile_id)
      .maybeSingle();
    type ProfileEntry = { metric_code: string; weight: number };
    const entries = ((profile as { weights?: { entries?: ProfileEntry[] } } | null)?.weights?.entries ?? []) as ProfileEntry[];
    if (entries.length === 0) {
      throw new Error('Perfil sem pesos definidos.');
    }
    for (const e of entries) weights[e.metric_code] = e.weight;
  } else {
    // custom
    for (const [code, w] of Object.entries(query.lens.weights)) {
      if (w > 0) weights[code] = w;
    }
    if (Object.keys(weights).length === 0) {
      throw new Error('Pesos custom vazios.');
    }
  }

  // ── 4. Carregar candidatos via player_percentiles (paginado) ─────────
  // Filtros: pool_id IN target_pools, position IN allowedPositions, player_id != anchor.
  const candidatePctRows: Array<{
    pool_id: string;
    player_id: string;
    position: string;
    metric_code: string;
    percentile: number;
    raw_value: number | null;
  }> = [];

  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('player_percentiles')
      .select('pool_id, player_id, position, metric_code, percentile, raw_value')
      .in('pool_id', query.target_pools)
      .in('position', allowedPositions)
      .neq('player_id', query.anchor.player_id)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    candidatePctRows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  if (candidatePctRows.length === 0) {
    warnings.push('Sem percentis para os filtros escolhidos.');
    return buildEmptyResponse(anchorPlayer as SimilarityPlayer, arquetypePositions, weights, warnings);
  }

  // ── 5. Construir CandidateRecord por (player_id, position) ──────────
  const recordsByKey = new Map<string, CandidateRecord>();
  for (const r of candidatePctRows) {
    const key = `${r.player_id}::${r.position}`;
    let rec = recordsByKey.get(key);
    if (!rec) {
      rec = { player_id: r.player_id, position: r.position, metrics: [] };
      recordsByKey.set(key, rec);
    }
    rec.metrics.push({
      metric_code: r.metric_code,
      percentile: r.percentile,
      raw_value: r.raw_value,
    });
  }

  // ── 6. Filtrar jogadores por min_minutes + age_range via tabela players
  const uniquePlayerIds = Array.from(new Set(Array.from(recordsByKey.values()).map((r) => r.player_id)));

  const playerMetaById = new Map<string, SimilarityPlayer>();
  // Paginar pelos IDs (split em chunks porque .in() com 1000+ ids pode falhar)
  const ID_CHUNK = 500;
  for (let i = 0; i < uniquePlayerIds.length; i += ID_CHUNK) {
    const chunk = uniquePlayerIds.slice(i, i + ID_CHUNK);
    const { data: pData, error: pErr } = await supabase
      .from('players')
      .select(
        'id, name, current_team, team_in_period, position_primary, positions_secondary, age, minutes_played, pool_id'
      )
      .in('id', chunk);
    if (pErr) throw pErr;
    for (const p of (pData ?? []) as SimilarityPlayer[]) {
      playerMetaById.set(p.id, p);
    }
  }

  // Aplicar filtros min_minutes + age_range
  const validIds = new Set<string>();
  for (const [id, p] of playerMetaById.entries()) {
    if ((p.minutes_played ?? 0) < query.min_minutes) continue;
    if (query.age_range) {
      const age = p.age ?? -1;
      if (age < query.age_range[0] || age > query.age_range[1]) continue;
    }
    validIds.add(id);
  }

  const candidates: CandidateRecord[] = [];
  for (const rec of recordsByKey.values()) {
    if (validIds.has(rec.player_id)) candidates.push(rec);
  }

  if (candidates.length === 0) {
    warnings.push('Nenhum candidato satisfaz os filtros de idade/minutos.');
    return buildEmptyResponse(anchorPlayer as SimilarityPlayer, arquetypePositions, weights, warnings);
  }

  // ── 7. Calcular similaridades ──────────────────────────────────────
  const scored = computeSimilarity({
    anchor: anchorRecord,
    candidates,
    weights,
    topN: 50,
  });

  // ── 8. Hidratar com player meta + pool name ────────────────────────
  const usedPoolIds = new Set<string>([
    (anchorPlayer as SimilarityPlayer).pool_id,
    ...scored.map((s) => playerMetaById.get(s.player_id)?.pool_id ?? '').filter(Boolean),
  ]);
  const poolNameById = new Map<string, string>();
  if (usedPoolIds.size > 0) {
    const { data: pools } = await supabase
      .from('pools')
      .select('id, name, season')
      .in('id', Array.from(usedPoolIds));
    for (const p of (pools ?? []) as Array<{ id: string; name: string; season: string }>) {
      poolNameById.set(p.id, `${p.name} ${p.season}`);
    }
  }

  const items: SimilarityResponseItem[] = scored.map((s) => {
    const meta = playerMetaById.get(s.player_id)!;
    return {
      ...s,
      player: { ...meta, pool_name: poolNameById.get(meta.pool_id) ?? null },
    };
  });

  const anchorWithPool = anchorPlayer as SimilarityPlayer;
  return {
    anchor: {
      ...anchorWithPool,
      pool_name: poolNameById.get(anchorWithPool.pool_id) ?? null,
      arquetype_positions: arquetypePositions,
    },
    weights,
    candidates: items,
    warnings,
  };
}

function buildEmptyResponse(
  anchorPlayer: SimilarityPlayer,
  arquetypePositions: string[],
  weights: Record<string, number>,
  warnings: string[]
): SimilarityResponse {
  return {
    anchor: { ...anchorPlayer, arquetype_positions: arquetypePositions },
    weights,
    candidates: [],
    warnings,
  };
}
