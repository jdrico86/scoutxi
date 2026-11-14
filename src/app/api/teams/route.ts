import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, profileRowToProfile } from '@/lib/scouting/db-helpers';
import { matchesPositions, playerPositions } from '@/lib/scouting/positions';
import { recalculateProfileScores } from '@/lib/scouting/recalculate-scores';
import { scoreProfile } from '@/lib/scouting/scorer';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ProfileScoreEntry = {
  profile_id: string;
  profile_name: string;
  is_seed: boolean;
  score: number;
  rank: number;
  total_eligible: number;
  /** null se o perfil aceita a posição primária; senão, a secundária pela qual entra. */
  via_position: string | null;
};

type TeamPlayer = {
  id: string;
  name: string;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  games_played: number | null;
  height_cm: number | null;
  foot: string | null;
  contract_until: string | null;
  market_value_eur: number | null;
  profiles: ProfileScoreEntry[];
};

// GET /api/teams?pool=...&team=...&min_age=&max_age=&min_minutes=
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const sp = req.nextUrl.searchParams;
  const poolId = sp.get('pool');
  const teamName = sp.get('team');

  if (!poolId || !teamName) {
    return NextResponse.json({ error: 'Parâmetros pool e team são obrigatórios.' }, { status: 400 });
  }

  const minAge = sp.get('min_age') ? parseInt(sp.get('min_age')!, 10) : null;
  const maxAge = sp.get('max_age') ? parseInt(sp.get('max_age')!, 10) : null;
  const minMinutes = sp.get('min_minutes') ? parseInt(sp.get('min_minutes')!, 10) : null;

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // 1. Pool
  const { data: pool, error: poolErr } = await supabase
    .from('pools')
    .select('id, name, season, competition')
    .eq('id', poolId)
    .maybeSingle();

  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (!pool) return NextResponse.json({ error: 'Pool não encontrada.' }, { status: 404 });

  // 2. Jogadores do clube no pool, com filtros.
  //    A equipa é o `team_in_period` — o clube por quem o jogador alinhou NAQUELA
  //    competição. O `current_team` é onde está inscrito, que para emprestados é
  //    outro clube: filtrar por ele deixava de fora os emprestados que jogam cá e
  //    trazia jogadores que já não jogam. Só se recorre ao `current_team` quando o
  //    export não trouxe clube do período.
  //    São duas queries em vez de um `.or()` porque nomes de clubes com vírgulas
  //    ou parênteses partem a sintaxe de filtros do PostgREST.
  const SELECT_COLS =
    'id, name, position_primary, positions_secondary, age, minutes_played, games_played, height_cm, foot, contract_until, market_value_eur';

  let periodQuery = supabase
    .from('players')
    .select(SELECT_COLS)
    .eq('pool_id', poolId)
    .eq('team_in_period', teamName);
  if (minAge != null) periodQuery = periodQuery.gte('age', minAge);
  if (maxAge != null) periodQuery = periodQuery.lte('age', maxAge);
  if (minMinutes != null) periodQuery = periodQuery.gte('minutes_played', minMinutes);

  let legacyQuery = supabase
    .from('players')
    .select(SELECT_COLS)
    .eq('pool_id', poolId)
    .is('team_in_period', null)
    .eq('current_team', teamName);
  if (minAge != null) legacyQuery = legacyQuery.gte('age', minAge);
  if (maxAge != null) legacyQuery = legacyQuery.lte('age', maxAge);
  if (minMinutes != null) legacyQuery = legacyQuery.gte('minutes_played', minMinutes);

  const [periodRes, legacyRes] = await Promise.all([periodQuery, legacyQuery]);

  const tpErr = periodRes.error ?? legacyRes.error;
  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  const byId = new Map<string, NonNullable<typeof periodRes.data>[number]>();
  for (const p of [...(periodRes.data ?? []), ...(legacyRes.data ?? [])]) byId.set(p.id, p);
  const teamPlayers = Array.from(byId.values());

  // 3. Perfis que este utilizador pode ver: os seed (sem dono) e os seus.
  //    Até 14/11/2026 vinham todos, e os perfis de um utilizador apareciam nos
  //    plantéis vistos por outro. É a mesma regra do GET /api/profiles.
  const { data: allProfiles } = await supabase
    .from('scouting_profiles')
    .select('*')
    .or(`owner_id.is.null,owner_id.eq.${user.id}`)
    .order('name');

  // 4. Scores — lidos de profile_scores, não recalculados.
  //
  //    Antes, esta rota carregava a pool inteira (1261 jogadores, 46 612 stats,
  //    47 pedidos paginados) e corria os 28 perfis sobre toda a gente para
  //    descobrir a posição de 20 jogadores. Perto de dez segundos, e no limite
  //    dos 10s das funções Netlify. Os scores só mudam no import ou quando um
  //    perfil é editado, por isso vêm agora pré-calculados.
  const profileResults = new Map<
    string,
    { rankByPlayer: Map<string, { score: number; rank: number }>; total: number; name: string; isSeed: boolean }
  >();
  const metaOf = (profileRow: { id: string; name: string; tags: unknown }) => ({
    name: profileRow.name,
    isSeed: ((profileRow.tags ?? []) as string[]).includes('seed'),
  });

  const teamPlayerIds = teamPlayers.map((p) => p.id);

  // 4a. Que perfis já estão em cache nesta pool, e com que total de elegíveis.
  //     Uma linha por perfil (a do primeiro classificado) chega para saber as
  //     duas coisas — são 28 linhas, não 35 mil.
  const { data: cachedHeads, error: headsErr } = await supabase
    .from('profile_scores')
    .select('profile_id, total_eligible')
    .eq('pool_id', poolId)
    .eq('rank', 1);
  if (headsErr) return NextResponse.json({ error: headsErr.message }, { status: 500 });

  const totalByProfile = new Map<string, number>();
  for (const row of cachedHeads ?? []) totalByProfile.set(row.profile_id, row.total_eligible);

  // 4b. Scores dos jogadores desta equipa — só deles.
  if (teamPlayerIds.length > 0 && totalByProfile.size > 0) {
    const { data: scoreRows, error: scoresErr } = await supabase
      .from('profile_scores')
      .select('profile_id, player_id, score, rank')
      .eq('pool_id', poolId)
      .in('player_id', teamPlayerIds);
    if (scoresErr) return NextResponse.json({ error: scoresErr.message }, { status: 500 });

    for (const row of scoreRows ?? []) {
      let entry = profileResults.get(row.profile_id);
      if (!entry) {
        const profileRow = (allProfiles ?? []).find((pr) => pr.id === row.profile_id);
        if (!profileRow) continue;
        entry = {
          rankByPlayer: new Map(),
          total: totalByProfile.get(row.profile_id) ?? 0,
          ...metaOf(profileRow),
        };
        profileResults.set(row.profile_id, entry);
      }
      entry.rankByPlayer.set(row.player_id, { score: Number(row.score), rank: row.rank });
    }
  }

  // 4c. Perfis ainda sem cache nesta pool (perfil novo ou acabado de editar):
  //     calcula-os ao vivo — só esses — e grava para a visita seguinte ser rápida.
  const missing = (allProfiles ?? []).filter((pr) => !totalByProfile.has(pr.id));
  if (missing.length > 0) {
    const { players: poolPlayers, stats: poolStats, directions } = await loadPoolData(supabase, poolId);
    for (const profileRow of missing) {
      const result = scoreProfile({
        pool_id: poolId,
        profile: profileRowToProfile(profileRow),
        players: poolPlayers,
        stats: poolStats,
        metric_directions: directions,
      });
      const rankByPlayer = new Map<string, { score: number; rank: number }>();
      result.ranked.forEach((r, idx) => {
        rankByPlayer.set(r.player_id, { score: r.score, rank: idx + 1 });
      });
      profileResults.set(profileRow.id, {
        rankByPlayer,
        total: result.ranked.length,
        ...metaOf(profileRow),
      });
    }
    // Gravar em segundo plano; se falhar, a página responde na mesma.
    recalculateProfileScores(supabase, poolId, { profileIds: missing.map((m) => m.id) }).catch(
      (err) => console.error('[teams] falha a gravar profile_scores:', (err as Error).message)
    );
  }

  // 5. Para cada jogador da equipa, recolher scores em todos os perfis em que é elegível
  const enriched: TeamPlayer[] = (teamPlayers ?? []).map((p) => {
    const profilesForPlayer: ProfileScoreEntry[] = [];

    for (const profileRow of allProfiles ?? []) {
      // O perfil aceita o jogador se aceitar qualquer uma das posições dele,
      // primária ou secundária — ver lib/scouting/positions.ts
      const filters = profileRow.filters as { positions?: string[] } | null;
      const positions = filters?.positions ?? [];
      if (positions.length === 0 || !matchesPositions(p, positions)) continue;

      const profileResult = profileResults.get(profileRow.id);
      if (!profileResult) continue;

      const found = profileResult.rankByPlayer.get(p.id);
      if (!found) continue; // não elegível neste perfil → omitir

      profilesForPlayer.push({
        profile_id: profileRow.id,
        profile_name: profileResult.name,
        is_seed: profileResult.isSeed,
        score: found.score,
        rank: found.rank,
        total_eligible: profileResult.total,
        via_position:
          p.position_primary && positions.includes(p.position_primary.trim())
            ? null
            : (playerPositions(p).find((pos) => positions.includes(pos)) ?? null),
      });
    }

    // Ordenar perfis pelo melhor rank (rank ascendente)
    profilesForPlayer.sort((a, b) => a.rank - b.rank);

    return {
      id: p.id,
      name: p.name,
      position_primary: p.position_primary,
      age: p.age,
      minutes_played: p.minutes_played,
      games_played: p.games_played,
      height_cm: p.height_cm,
      foot: p.foot,
      contract_until: p.contract_until,
      market_value_eur: p.market_value_eur,
      profiles: profilesForPlayer,
    };
  });

  return NextResponse.json({
    pool,
    team_name: teamName,
    filters: { min_age: minAge, max_age: maxAge, min_minutes: minMinutes },
    players: enriched,
  });
}