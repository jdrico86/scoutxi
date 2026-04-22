/**
 * Scorer: aplica um perfil a um conjunto de jogadores e devolve ranking.
 *
 * Função pura: recebe dados em memória, devolve resultado. Não toca no Supabase —
 * quem traz os dados é quem chama (rota API ou script).
 *
 * Algoritmo:
 *  1. Filtrar jogadores elegíveis (posição, minutos, idade, contrato, etc.)
 *  2. Definir peer_group (grupo de comparação para percentis)
 *  3. Para cada métrica do perfil:
 *     - Calcular distribuição dos valores no peer_group
 *     - Para cada jogador elegível, calcular o seu percentil nessa métrica
 *     - Multiplicar percentil × peso → contribuição
 *  4. Somar contribuições → score final (0-100)
 *  5. Ordenar descendente
 */

import type {
  MetricWeight,
  ScoredPlayer,
  ScoringResult,
  ScoutingProfile,
} from './profile-types';

/** Input mínimo de jogador para o scorer. */
export type PlayerInput = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  contract_until: string | null;
  market_value_eur: number | null;
  on_loan: boolean | null;
};

/** Input mínimo de stat. */
export type StatInput = {
  player_id: string;
  metric_code: string;
  metric_value: number | null;
};

/**
 * Calcula percentil de um valor numa distribuição.
 *
 * Percentil "midrank": se o valor é igual a outros, atribui a média das posições.
 * Isto é mais justo que "a percentage below" — evita penalizar empates.
 *
 * Ex: valores [10, 20, 20, 30], valor=20 → percentil = 50 (está no meio dos empates)
 */
function computePercentile(value: number, sortedValues: number[]): number {
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

/** Aplica perfil aos dados e devolve ranking. */
export function scoreProfile(args: {
  pool_id: string;
  profile: ScoutingProfile;
  players: PlayerInput[];
  stats: StatInput[];
  /** Mapa code -> direction (da tabela `metrics`). Default 'higher' se não estiver. */
  metric_directions?: Record<string, 'higher' | 'lower'>;
}): ScoringResult {
  const { pool_id, profile, players, stats, metric_directions = {} } = args;
  const warnings: string[] = [];

  // ── Validar pesos ──────────────────────────────────────────────────────
  const totalWeight = profile.weights.reduce((s, w) => s + w.weight, 0);
  if (Math.abs(totalWeight - 100) > 0.01) {
    warnings.push(
      `Pesos do perfil somam ${totalWeight.toFixed(2)} em vez de 100. Os scores serão normalizados.`
    );
  }

  // ── Indexar stats por (player_id, metric_code) para lookup O(1) ────────
  const statIndex = new Map<string, number>();
  for (const s of stats) {
    if (s.metric_value === null) continue;
    statIndex.set(`${s.player_id}::${s.metric_code}`, s.metric_value);
  }

  // ── Aplicar filtros de elegibilidade ───────────────────────────────────
  const eligible: PlayerInput[] = [];
  const filters = profile.filters;
  for (const p of players) {
    if (filters.positions && filters.positions.length > 0) {
      if (!p.position_primary || !filters.positions.includes(p.position_primary)) continue;
    }
    if (filters.min_minutes != null && (p.minutes_played ?? 0) < filters.min_minutes) continue;
    if (filters.min_age != null && (p.age ?? 0) < filters.min_age) continue;
    if (filters.max_age != null && (p.age ?? 999) > filters.max_age) continue;
    if (filters.contract_until_before && p.contract_until) {
      if (p.contract_until > filters.contract_until_before) continue;
    }
    if (filters.on_loan != null && p.on_loan !== filters.on_loan) continue;
    eligible.push(p);
  }

  // ── Definir peer_group (amostra para percentis) ────────────────────────
  const peerPositions = profile.peer_group_positions ?? profile.filters.positions ?? [];
  const peerGroup: PlayerInput[] =
    peerPositions.length > 0
      ? players.filter((p) => p.position_primary && peerPositions.includes(p.position_primary))
      : players;

  if (peerGroup.length < 10) {
    warnings.push(
      `Peer group tem só ${peerGroup.length} jogadores — percentis pouco fiáveis. Alarga peer_group_positions.`
    );
  }

  // ── Pre-computar distribuição por métrica no peer_group ───────────────
  const distribs = new Map<string, number[]>(); // metric_code -> sorted values
  for (const w of profile.weights) {
    const vals: number[] = [];
    for (const p of peerGroup) {
      const v = statIndex.get(`${p.id}::${w.metric_code}`);
      if (v != null) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    distribs.set(w.metric_code, vals);
  }

  // ── Score por jogador ─────────────────────────────────────────────────
  const ranked: ScoredPlayer[] = [];
  const weightSum = totalWeight > 0 ? totalWeight : 1;

  for (const p of eligible) {
    const contributions: ScoredPlayer['contributions'] = [];
    const missing: string[] = [];
    let score = 0;

    for (const w of profile.weights) {
      const raw = statIndex.get(`${p.id}::${w.metric_code}`) ?? null;
      if (raw == null) {
        missing.push(w.metric_code);
        contributions.push({
          metric_code: w.metric_code,
          raw_value: null,
          percentile: 0,
          weight: w.weight,
          contribution: 0,
        });
        continue;
      }

      const dist = distribs.get(w.metric_code) ?? [];
      let pct = computePercentile(raw, dist);

      // Direcção: se 'lower' é melhor, inverte o percentil
      const dir = w.direction ?? metric_directions[w.metric_code] ?? 'higher';
      if (dir === 'lower') pct = 100 - pct;

      // Peso normalizado (se pesos não somam 100)
      const normalizedWeight = (w.weight / weightSum) * 100;
      const contrib = (pct * normalizedWeight) / 100;

      contributions.push({
        metric_code: w.metric_code,
        raw_value: raw,
        percentile: pct,
        weight: w.weight,
        contribution: Math.round(contrib * 100) / 100,
      });
      score += contrib;
    }

    ranked.push({
      player_id: p.id,
      name: p.name,
      current_team: p.current_team,
      position_primary: p.position_primary,
      age: p.age,
      minutes_played: p.minutes_played,
      contract_until: p.contract_until,
      market_value_eur: p.market_value_eur,
      score: Math.round(score * 100) / 100,
      contributions,
      missing_metrics: missing,
    });
  }

  ranked.sort((a, b) => b.score - a.score);

  return {
    profile,
    pool_id,
    total_players_in_pool: players.length,
    eligible_count: eligible.length,
    peer_group_size: peerGroup.length,
    ranked,
    warnings,
  };
}