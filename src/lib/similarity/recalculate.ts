/**
 * Recalcula a tabela player_percentiles para uma pool.
 *
 * Para cada (posição, métrica relevante para essa posição):
 *   1. Junta os valores de todos os jogadores da pool que jogam nessa posição
 *      (primary OR secondary).
 *   2. Calcula percentil de cada jogador na distribuição (midrank).
 *   3. Inverte se metrics.direction = 'lower_better' (golos sofridos, faltas, cartões).
 *      A BD usa 'higher_better' / 'lower_better' como valores canónicos.
 *   4. INSERT em player_percentiles, em batches.
 *
 * Idempotente: DELETE de todas as linhas da pool antes do INSERT.
 *
 * Reusa loadPoolData (paginado) e computePercentile já existentes.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { computePercentile } from '@/lib/scouting/percentile';
import { getMetricsForPosition, SUPPORTED_POSITIONS } from './position-metrics';

type PlayerRow = {
  id: string;
  position_primary: string | null;
  positions_secondary: string[] | null;
  minutes_played: number | null;
};

type StatRow = {
  player_id: string;
  metric_code: string;
  metric_value: number | null;
};

export type RecalculateResult = {
  pool_id: string;
  positions_processed: number;
  rows_inserted: number;
  duration_ms: number;
};

const INSERT_BATCH = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function recalculatePoolPercentiles(supabase: SupabaseClient<any>, poolId: string): Promise<RecalculateResult> {
  const t0 = Date.now();

  // ── Carregar players da pool (paginado) ──────────────────────────────
  const players: PlayerRow[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('players')
        .select('id, position_primary, positions_secondary, minutes_played')
        .eq('pool_id', poolId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      players.push(...(data as PlayerRow[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // ── Carregar stats da pool (paginado, via inner join) ────────────────
  const stats: StatRow[] = [];
  {
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('player_stats')
        .select('player_id, metric_code, metric_value, players!inner(pool_id)')
        .eq('players.pool_id', poolId)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const row of data as Array<{ player_id: string; metric_code: string; metric_value: number | null }>) {
        stats.push({
          player_id: row.player_id,
          metric_code: row.metric_code,
          metric_value: row.metric_value,
        });
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  // ── Carregar metric directions ───────────────────────────────────────
  // BD usa 'higher_better' / 'lower_better'. Aceita também forma curta
  // ('higher' / 'lower') para resiliência caso normalize-se no futuro.
  const { data: metricsData, error: metricsErr } = await supabase
    .from('metrics')
    .select('code, direction');
  if (metricsErr) throw metricsErr;
  const direction = new Map<string, 'higher' | 'lower'>();
  for (const m of (metricsData ?? []) as Array<{ code: string; direction: string | null }>) {
    if (m.direction === 'lower' || m.direction === 'lower_better') {
      direction.set(m.code, 'lower');
    } else {
      direction.set(m.code, 'higher');
    }
  }

  // ── Index stats por (player_id, metric_code) ─────────────────────────
  const statIndex = new Map<string, number>();
  for (const s of stats) {
    if (s.metric_value === null) continue;
    statIndex.set(`${s.player_id}::${s.metric_code}`, s.metric_value);
  }

  // ── Players por posição (primary + secondary, expandido) ─────────────
  const playersByPosition = new Map<string, PlayerRow[]>();
  for (const p of players) {
    const positions = new Set<string>();
    if (p.position_primary) positions.add(p.position_primary);
    for (const s of p.positions_secondary ?? []) positions.add(s);
    for (const pos of positions) {
      if (!SUPPORTED_POSITIONS.has(pos)) continue;
      if (!playersByPosition.has(pos)) playersByPosition.set(pos, []);
      playersByPosition.get(pos)!.push(p);
    }
  }

  // ── Construir linhas a inserir ───────────────────────────────────────
  type InsertRow = {
    pool_id: string;
    player_id: string;
    position: string;
    metric_code: string;
    raw_value: number;
    percentile: number;
  };
  const rows: InsertRow[] = [];

  for (const [position, group] of playersByPosition.entries()) {
    const metricCodes = getMetricsForPosition(position);
    for (const metricCode of metricCodes) {
      // Distribuição: valores de todos os jogadores deste grupo que têm o valor.
      const distribution: number[] = [];
      const valueByPlayer = new Map<string, number>();
      for (const p of group) {
        const v = statIndex.get(`${p.id}::${metricCode}`);
        if (v != null) {
          distribution.push(v);
          valueByPlayer.set(p.id, v);
        }
      }
      if (distribution.length === 0) continue;
      distribution.sort((a, b) => a - b);

      const isLower = direction.get(metricCode) === 'lower';

      for (const [playerId, rawValue] of valueByPlayer.entries()) {
        let pct = computePercentile(rawValue, distribution);
        if (isLower) pct = 100 - pct;
        rows.push({
          pool_id: poolId,
          player_id: playerId,
          position,
          metric_code: metricCode,
          raw_value: rawValue,
          percentile: pct,
        });
      }
    }
  }

  // ── DELETE existente + INSERT em batches (idempotente) ───────────────
  const { error: delErr } = await supabase
    .from('player_percentiles')
    .delete()
    .eq('pool_id', poolId);
  if (delErr) throw delErr;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from('player_percentiles').insert(batch);
    if (error) throw error;
    inserted += batch.length;
  }

  return {
    pool_id: poolId,
    positions_processed: playersByPosition.size,
    rows_inserted: inserted,
    duration_ms: Date.now() - t0,
  };
}
