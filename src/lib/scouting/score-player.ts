/**
 * Score de UM jogador num perfil, com o detalhe por métrica.
 *
 * O score de um jogador depende apenas dos valores dele e da distribuição das
 * métricas do perfil dentro do peer group. Não é preciso a pool toda: basta o
 * peer group (posição primária) e as métricas com peso. Num perfil de AMF são
 * ~47 jogadores × 6 métricas, contra 1261 × 45.
 *
 * Usado pelo `/api/score` (detalhe de uma linha, radar da ficha) e pela
 * evolução entre épocas (`/api/players/[id]/history`), para os percentis serem
 * os mesmos em todo o lado.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScoredPlayer, ScoutingProfile } from './profile-types';
import { resolvePeerPositions, scoreProfile, type PlayerInput } from './scorer';

const PLAYER_COLS =
  'id, name, current_team, position_primary, positions_secondary, age, minutes_played, contract_until, market_value_eur, on_loan';

/** Divide ids em blocos, para o `.in()` não gerar URLs demasiado longas. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PlayerScoreDetail = {
  /** null quando o jogador não é elegível no perfil (posição, minutos, idade…). */
  scored: ScoredPlayer | null;
  peer_group_size: number;
  warnings: string[];
};

/**
 * Devolve null quando o caminho rápido não se aplica — perfil sem posições de
 * peer group ou sem métricas com peso. Quem chama decide o que fazer nesse caso.
 */
export async function scorePlayerInProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  args: { poolId: string; profile: ScoutingProfile; playerId: string }
): Promise<PlayerScoreDetail | null> {
  const { poolId, profile, playerId } = args;
  const peerPositions = resolvePeerPositions(profile);
  const weightedCodes = Array.from(new Set(profile.weights.map((w) => w.metric_code)));
  if (peerPositions.length === 0 || weightedCodes.length === 0) return null;

  const { data: peerRows, error: peerErr } = await supabase
    .from('players')
    .select(PLAYER_COLS)
    .eq('pool_id', poolId)
    .in('position_primary', peerPositions);
  if (peerErr) throw new Error(peerErr.message);

  // O jogador pode ser elegível por posição secundária e não estar no peer group.
  const subset = [...((peerRows ?? []) as unknown as PlayerInput[])];
  if (!subset.some((p) => p.id === playerId)) {
    const { data: target } = await supabase.from('players').select(PLAYER_COLS).eq('id', playerId).maybeSingle();
    if (target) subset.push(target as unknown as PlayerInput);
  }

  const { data: metricsRows } = await supabase.from('metrics').select('code, direction');
  const directions: Record<string, 'higher' | 'lower'> = {};
  for (const m of (metricsRows ?? []) as Array<{ code: string; direction: string | null }>) {
    directions[m.code] = m.direction === 'lower' || m.direction === 'lower_better' ? 'lower' : 'higher';
  }

  const stats: Array<{ player_id: string; metric_code: string; metric_value: number | null }> = [];
  const pages = await Promise.all(
    chunk(subset.map((p) => p.id), 100).map((ids) =>
      supabase
        .from('player_stats')
        .select('player_id, metric_code, metric_value')
        .in('player_id', ids)
        .in('metric_code', weightedCodes)
    )
  );
  for (const page of pages) {
    if (page.error) throw new Error(page.error.message);
    stats.push(...((page.data ?? []) as typeof stats));
  }

  const result = scoreProfile({
    pool_id: poolId,
    profile,
    players: subset,
    stats,
    metric_directions: directions,
  });

  return {
    scored: result.ranked.find((p) => p.player_id === playerId) ?? null,
    peer_group_size: result.peer_group_size,
    warnings: result.warnings,
  };
}
