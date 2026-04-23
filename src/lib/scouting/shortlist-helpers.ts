/**
 * Scoring helpers para shortlists.
 *
 * Diferente de scoreProfile (que usa pool inteiro): aqui aplicamos um perfil
 * apenas a um conjunto específico de player_ids. Útil para "recalcular" uma
 * shortlist com dados actuais — mantemos os mesmos jogadores mas actualizamos
 * scores e percentis (estes últimos calculados ainda no peer group do pool).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { ScoutingProfile } from './profile-types';
import { loadPoolData } from './db-helpers';
import { scoreProfile } from './scorer';

/**
 * Aplica perfil ao pool e devolve apenas os jogadores cujos IDs estão na lista.
 * Útil para "actualizar" uma shortlist: os percentis continuam calculados sobre
 * o peer group inteiro, mas devolvemos só os que interessam.
 */
export async function scoreSpecificPlayers(args: {
  supabase: SupabaseClient<Database>;
  profile: ScoutingProfile;
  poolId: string;
  playerIds: string[];
}) {
  const { supabase, profile, poolId, playerIds } = args;
  const { players, stats, directions } = await loadPoolData(supabase, poolId);

  // Aplicar scoring ao pool inteiro (para percentis correctos)
  const result = scoreProfile({
    pool_id: poolId,
    profile,
    players,
    stats,
    metric_directions: directions,
  });

  // Filtrar para jogadores pedidos, mantendo a ordem do ranking
  const wanted = new Set(playerIds);
  const filtered = result.ranked.filter((p) => wanted.has(p.player_id));

  return {
    ...result,
    ranked: filtered,
    // Indicador útil: dos N jogadores pedidos, quantos estavam elegíveis
    requested: playerIds.length,
    found: filtered.length,
    missing_ids: playerIds.filter((id) => !filtered.some((p) => p.player_id === id)),
  };
}

/**
 * Versão "snapshot": para guardar o estado actual de cada jogador da shortlist.
 * Devolve { player_id, score, rank } ordenado pelo rank.
 */
export function buildSnapshotEntries(
  ranked: Array<{ player_id: string; score: number }>
) {
  return ranked.map((p, i) => ({
    player_id: p.player_id,
    snapshot_score: p.score,
    snapshot_rank: i + 1,
  }));
}