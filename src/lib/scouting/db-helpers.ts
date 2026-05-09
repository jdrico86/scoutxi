/**
 * Helpers para carregar dados do Supabase para o scorer.
 *
 * Usados pelas rotas API e pelos scripts. Isolar aqui evita duplicação
 * entre `test-profile.ts`, `/api/score` e futuras rotas.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { MetricWeight, ScoutingProfile } from './profile-types';
import type { PlayerInput, StatInput } from './scorer';

type ProfileRow = Database['public']['Tables']['scouting_profiles']['Row'];

/** Converte linha da BD para ScoutingProfile, com validação mínima. */
export function profileRowToProfile(row: ProfileRow): ScoutingProfile {
  const filters = (row.filters ?? {}) as ScoutingProfile['filters'];
  // weights foi guardado como { entries, peer_group_positions } — ler assim
  const weightsObj = (row.weights ?? { entries: [], peer_group_positions: [] }) as {
    entries?: MetricWeight[];
    peer_group_positions?: string[];
  };
  return {
    name: row.name,
    description: row.description ?? undefined,
    filters,
    weights: weightsObj.entries ?? [],
    peer_group_positions: weightsObj.peer_group_positions,
  };
}

/** Busca um perfil por ID, incluindo os campos necessários. */
export async function loadProfile(
  supabase: SupabaseClient<Database>,
  profileId: string
): Promise<{ profile: ScoutingProfile; id: string } | null> {
  const { data, error } = await supabase
    .from('scouting_profiles')
    .select('id, name, description, filters, weights, tags, owner, created_at, updated_at')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { profile: profileRowToProfile(data), id: data.id };
}

/**
 * Carrega tudo o que o scorer precisa para uma pool, com paginação correcta
 * (evita o bug do limite silencioso de 1000 linhas).
 */
export async function loadPoolData(
  supabase: SupabaseClient<Database>,
  poolId: string
): Promise<{
  players: PlayerInput[];
  stats: StatInput[];
  directions: Record<string, 'higher' | 'lower'>;
}> {
  // Players — paginado para evitar o limite implícito de 1000 linhas do PostgREST.
  // Pools como CdP excedem 1000.
  const players: PlayerInput[] = [];
  const PLAYERS_PAGE = 1000;
  let playersFrom = 0;
  while (true) {
    const { data: page, error: playersErr } = await supabase
      .from('players')
      .select(
        'id, name, current_team, position_primary, age, minutes_played, contract_until, market_value_eur, on_loan'
      )
      .eq('pool_id', poolId)
      .range(playersFrom, playersFrom + PLAYERS_PAGE - 1);
    if (playersErr) throw playersErr;
    if (!page || page.length === 0) break;
    players.push(...(page as unknown as PlayerInput[]));
    if (page.length < PLAYERS_PAGE) break;
    playersFrom += PLAYERS_PAGE;
  }

  // Stats via inner join + paginação
  const stats: StatInput[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('player_stats')
      .select('player_id, metric_code, metric_value, players!inner(pool_id)')
      .eq('players.pool_id', poolId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!page || page.length === 0) break;
    for (const row of page as Array<{ player_id: string; metric_code: string; metric_value: number | null }>) {
      stats.push({
        player_id: row.player_id,
        metric_code: row.metric_code,
        metric_value: row.metric_value,
      });
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }

  // Directions das métricas
  const { data: metricsData, error: metricsErr } = await supabase
    .from('metrics')
    .select('code, direction');
  if (metricsErr) throw metricsErr;
  const directions: Record<string, 'higher' | 'lower'> = {};
  for (const m of (metricsData ?? []) as Array<{ code: string; direction: string | null }>) {
    if (m.direction === 'higher' || m.direction === 'lower') directions[m.code] = m.direction;
  }

  return { players, stats, directions };
}