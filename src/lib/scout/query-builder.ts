/**
 * Pesquisa avançada (ad-hoc) — lógica pura.
 *
 * Função pura: recebe dados em memória (jogadores + stats) e uma query, devolve
 * o conjunto filtrado + percentis + thresholds. Não toca em Supabase. Espelha o
 * estilo de scoreProfile mas sem score composto: a feature de pesquisa avançada
 * é "filtros + lista", não "filtros + ranking ponderado".
 *
 * Algoritmo:
 *  1. Aplicar filtros gerais (idade, minutos, on_loan, posições) → eligible.
 *  2. Calcular peer group (jogadores na pool com pelo menos uma das posições da
 *     query, ou pool inteira se não houver posições).
 *  3. Para cada métrica filtrada: calcular distribuição no peer group +
 *     thresholds (min/max/p10/p25/p50/p75/p90/p95).
 *  4. Aplicar filtros de métrica:
 *       gte             → raw_value >= value
 *       lte             → raw_value <= value
 *       between         → value_range[0] <= raw_value <= value_range[1]
 *       top_percentile  → percentile >= percentile_param
 *     Jogadores SEM valor para uma métrica filtrada são EXCLUÍDOS dessa pesquisa.
 *  5. Para os matched: incluir metric_values (raw + percentil) das métricas filtradas.
 *  6. Ordenar por sort_by (default: nome ASC).
 *
 * Em modo preview, devolve apenas count + thresholds + warnings (sem players[]).
 */

import { computePercentile } from '@/lib/scouting/percentile';
import type { PlayerInput, StatInput } from '@/lib/scouting/scorer';

export type ScoutGeneralFilters = {
  min_age?: number;
  max_age?: number;
  min_minutes?: number;
  on_loan?: boolean;
};

export type ScoutMetricFilter = {
  metric_code: string;
  operator: 'gte' | 'lte' | 'between' | 'top_percentile';
  value?: number;
  value_range?: [number, number];
  percentile?: number;
};

export type ScoutSortBy = {
  /** 'name' | 'age' | 'minutes_played' | <metric_code> */
  field: string;
  direction: 'asc' | 'desc';
};

export type ScoutQueryInput = {
  positions?: string[];
  general_filters?: ScoutGeneralFilters;
  metric_filters?: ScoutMetricFilter[];
  sort_by?: ScoutSortBy;
};

export type MetricThresholds = {
  min: number;
  max: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
};

export type ScoutMetricValue = {
  metric_code: string;
  raw_value: number | null;
  percentile: number | null;
};

export type ScoutPlayerResult = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  metric_values: ScoutMetricValue[];
};

export type ScoutResult = {
  count: number;
  peer_group_size: number;
  warnings: string[];
  metric_thresholds: Record<string, MetricThresholds>;
  /** Omitido em preview. */
  players?: ScoutPlayerResult[];
};

function quantile(sortedAsc: number[], q: number): number {
  // Quantile linear interpolation. q em [0, 1].
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

function computeThresholds(sortedAsc: number[]): MetricThresholds {
  return {
    min: sortedAsc.length > 0 ? sortedAsc[0] : 0,
    max: sortedAsc.length > 0 ? sortedAsc[sortedAsc.length - 1] : 0,
    p10: quantile(sortedAsc, 0.10),
    p25: quantile(sortedAsc, 0.25),
    p50: quantile(sortedAsc, 0.50),
    p75: quantile(sortedAsc, 0.75),
    p90: quantile(sortedAsc, 0.90),
    p95: quantile(sortedAsc, 0.95),
  };
}

export function runScoutQuery(args: {
  players: PlayerInput[];
  stats: StatInput[];
  query: ScoutQueryInput;
  preview?: boolean;
}): ScoutResult {
  const { players, stats, query, preview = false } = args;
  const warnings: string[] = [];

  // ── Index stats por (player_id, metric_code) → O(1) lookup ──────────
  const statIndex = new Map<string, number>();
  for (const s of stats) {
    if (s.metric_value === null) continue;
    statIndex.set(`${s.player_id}::${s.metric_code}`, s.metric_value);
  }

  // ── Filtros gerais → eligible ──────────────────────────────────────
  const positions = query.positions ?? [];
  const gf = query.general_filters ?? {};
  const eligible: PlayerInput[] = [];
  for (const p of players) {
    if (positions.length > 0) {
      if (!p.position_primary || !positions.includes(p.position_primary)) continue;
    }
    if (gf.min_minutes != null && (p.minutes_played ?? 0) < gf.min_minutes) continue;
    if (gf.min_age != null && (p.age ?? 0) < gf.min_age) continue;
    if (gf.max_age != null && (p.age ?? 999) > gf.max_age) continue;
    if (gf.on_loan != null && p.on_loan !== gf.on_loan) continue;
    eligible.push(p);
  }

  // ── Peer group ─────────────────────────────────────────────────────
  // Sem posições: peer group = pool inteira (com warning).
  const peerGroup: PlayerInput[] =
    positions.length > 0
      ? players.filter((p) => p.position_primary && positions.includes(p.position_primary))
      : players;

  if (positions.length === 0) {
    warnings.push('Sem posições escolhidas — percentis baseados na pool inteira.');
  } else if (peerGroup.length < 10) {
    warnings.push(
      `Peer group tem só ${peerGroup.length} jogadores — percentis pouco fiáveis.`
    );
  }

  // ── Pre-compute distribuições + thresholds das métricas filtradas ──
  const metricFilters = query.metric_filters ?? [];
  const distribs = new Map<string, number[]>();
  const thresholds: Record<string, MetricThresholds> = {};
  for (const mf of metricFilters) {
    if (distribs.has(mf.metric_code)) continue; // já computado
    const vals: number[] = [];
    for (const p of peerGroup) {
      const v = statIndex.get(`${p.id}::${mf.metric_code}`);
      if (v != null) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    distribs.set(mf.metric_code, vals);
    thresholds[mf.metric_code] = computeThresholds(vals);
  }

  // ── Aplicar filtros de métrica → matched ───────────────────────────
  const matched: Array<{ player: PlayerInput; values: ScoutMetricValue[] }> = [];
  for (const p of eligible) {
    const values: ScoutMetricValue[] = [];
    let pass = true;
    for (const mf of metricFilters) {
      const raw = statIndex.get(`${p.id}::${mf.metric_code}`);
      if (raw == null) {
        // Excluído: jogador não tem valor para esta métrica.
        pass = false;
        break;
      }
      const dist = distribs.get(mf.metric_code) ?? [];
      const pct = computePercentile(raw, dist);
      let ok = false;
      switch (mf.operator) {
        case 'gte':
          ok = mf.value != null && raw >= mf.value;
          break;
        case 'lte':
          ok = mf.value != null && raw <= mf.value;
          break;
        case 'between':
          ok =
            mf.value_range != null &&
            raw >= mf.value_range[0] &&
            raw <= mf.value_range[1];
          break;
        case 'top_percentile':
          ok = mf.percentile != null && pct >= mf.percentile;
          break;
      }
      if (!ok) {
        pass = false;
        break;
      }
      values.push({ metric_code: mf.metric_code, raw_value: raw, percentile: pct });
    }
    if (pass) matched.push({ player: p, values });
  }

  const count = matched.length;

  if (preview) {
    return {
      count,
      peer_group_size: peerGroup.length,
      warnings,
      metric_thresholds: thresholds,
    };
  }

  // ── Build players[] e ordenar ──────────────────────────────────────
  const playersOut: ScoutPlayerResult[] = matched.map(({ player, values }) => ({
    id: player.id,
    name: player.name,
    current_team: player.current_team,
    position_primary: player.position_primary,
    age: player.age,
    minutes_played: player.minutes_played,
    metric_values: values,
  }));

  const sort = query.sort_by ?? { field: 'name', direction: 'asc' as const };
  const dir = sort.direction === 'desc' ? -1 : 1;

  playersOut.sort((a, b) => {
    let av: string | number | null;
    let bv: string | number | null;
    if (sort.field === 'name') {
      av = a.name;
      bv = b.name;
    } else if (sort.field === 'age') {
      av = a.age;
      bv = b.age;
    } else if (sort.field === 'minutes_played') {
      av = a.minutes_played;
      bv = b.minutes_played;
    } else {
      // Assume metric_code
      av = a.metric_values.find((v) => v.metric_code === sort.field)?.raw_value ?? null;
      bv = b.metric_values.find((v) => v.metric_code === sort.field)?.raw_value ?? null;
    }
    // Nulls sempre no fim (independente de asc/desc) — convenção do scorer.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') {
      return av.localeCompare(bv, 'pt') * dir;
    }
    return ((av as number) - (bv as number)) * dir;
  });

  return {
    count,
    peer_group_size: peerGroup.length,
    warnings,
    metric_thresholds: thresholds,
    players: playersOut,
  };
}
