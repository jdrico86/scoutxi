/**
 * Pré-cálculo dos scores de perfis para uma pool.
 *
 * O problema que isto resolve: até 12/11/2026, mostrar o plantel de uma equipa
 * obrigava o `/api/teams` a descarregar a pool inteira — 1261 jogadores e 46 612
 * linhas de estatística, em 47 idas e voltas sequenciais ao Supabase — e a correr
 * os 28 perfis sobre toda a gente, para descobrir a posição de 20 jogadores.
 * Demorava perto de dez segundos e estava no limite dos 10s das funções Netlify.
 *
 * Os scores só mudam quando a pool é importada ou um perfil é editado, por isso
 * não têm de ser recalculados a cada visita. Esta função calcula-os uma vez e
 * grava-os em `profile_scores`, do mesmo modo que `recalculatePoolPercentiles`
 * já fazia para os percentis.
 *
 * Idempotente: apaga as linhas da pool (ou só dos perfis indicados) antes de
 * inserir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPoolData, profileRowToProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';

export type RecalculateScoresResult = {
  pool_id: string;
  profiles_processed: number;
  rows_inserted: number;
  duration_ms: number;
  warnings: string[];
};

type ScoreRow = {
  pool_id: string;
  profile_id: string;
  player_id: string;
  score: number;
  rank: number;
  total_eligible: number;
};

const INSERT_BATCH = 1000;

export async function recalculateProfileScores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  poolId: string,
  options?: { profileIds?: string[] }
): Promise<RecalculateScoresResult> {
  const t0 = Date.now();
  const only = options?.profileIds && options.profileIds.length > 0 ? options.profileIds : null;

  // ── Perfis a calcular ────────────────────────────────────────────────
  let profileQuery = supabase.from('scouting_profiles').select('*');
  if (only) profileQuery = profileQuery.in('id', only);
  const { data: profileRows, error: profErr } = await profileQuery;
  if (profErr) throw profErr;

  if (!profileRows || profileRows.length === 0) {
    return {
      pool_id: poolId,
      profiles_processed: 0,
      rows_inserted: 0,
      duration_ms: Date.now() - t0,
      warnings: ['Nenhum perfil encontrado para calcular.'],
    };
  }

  // ── Carregar a pool UMA vez para todos os perfis ─────────────────────
  const { players, stats, directions } = await loadPoolData(supabase, poolId);

  const rows: ScoreRow[] = [];
  const warnings: string[] = [];

  for (const profileRow of profileRows as Array<{ id: string; name: string }>) {
    const profile = profileRowToProfile(
      profileRow as unknown as Parameters<typeof profileRowToProfile>[0]
    );
    const result = scoreProfile({
      pool_id: poolId,
      profile,
      players,
      stats,
      metric_directions: directions,
    });

    const total = result.ranked.length;
    result.ranked.forEach((r, idx) => {
      rows.push({
        pool_id: poolId,
        profile_id: profileRow.id,
        player_id: r.player_id,
        score: r.score,
        rank: idx + 1,
        total_eligible: total,
      });
    });

    for (const w of result.warnings) warnings.push(`${profileRow.name}: ${w}`);
  }

  // ── Apagar o que vai ser substituído ─────────────────────────────────
  let del = supabase.from('profile_scores').delete().eq('pool_id', poolId);
  if (only) del = del.in('profile_id', only);
  const { error: delErr } = await del;
  if (delErr) throw delErr;

  // ── Inserir em batches ───────────────────────────────────────────────
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from('profile_scores').insert(batch);
    if (error) throw error;
    inserted += batch.length;
  }

  return {
    pool_id: poolId,
    profiles_processed: profileRows.length,
    rows_inserted: inserted,
    duration_ms: Date.now() - t0,
    warnings,
  };
}

/**
 * Apaga o cache de um perfil em todas as pools. Chamado quando o perfil é
 * editado ou apagado: as rotas de leitura recalculam-no ao vivo na visita
 * seguinte — um perfil só, não os 28 — e voltam a gravá-lo.
 */
export async function invalidateProfileScores(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  profileId: string
): Promise<void> {
  const { error } = await supabase.from('profile_scores').delete().eq('profile_id', profileId);
  if (error) throw error;
}
