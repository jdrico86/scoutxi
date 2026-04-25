import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, profileRowToProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ProfileScoreEntry = {
  profile_id: string;
  profile_name: string;
  is_seed: boolean;
  score: number;
  rank: number;
  total_eligible: number;
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

  // 2. Jogadores do clube no pool, com filtros
  let query = supabase
    .from('players')
    .select('id, name, position_primary, age, minutes_played, games_played, height_cm, foot, contract_until, market_value_eur')
    .eq('pool_id', poolId)
    .eq('current_team', teamName);

  if (minAge != null) query = query.gte('age', minAge);
  if (maxAge != null) query = query.lte('age', maxAge);
  if (minMinutes != null) query = query.gte('minutes_played', minMinutes);

  const { data: teamPlayers, error: tpErr } = await query;
  if (tpErr) return NextResponse.json({ error: tpErr.message }, { status: 500 });

  // 3. Perfis (todos)
  const { data: allProfiles } = await supabase
    .from('scouting_profiles')
    .select('*')
    .order('name');

  // 4. Pré-carregar pool data + correr todos os perfis UMA vez
  const { players: poolPlayers, stats: poolStats, directions } = await loadPoolData(supabase, poolId);

  // Mapa perfil_id → resultado (rank por player_id, total_eligible)
  const profileResults = new Map<string, { rankByPlayer: Map<string, { score: number; rank: number }>; total: number; name: string; isSeed: boolean }>();

  for (const profileRow of allProfiles ?? []) {
    const profile = profileRowToProfile(profileRow);
    const result = scoreProfile({
      pool_id: poolId,
      profile,
      players: poolPlayers,
      stats: poolStats,
      metric_directions: directions,
    });
    const rankByPlayer = new Map<string, { score: number; rank: number }>();
    result.ranked.forEach((r, idx) => {
      rankByPlayer.set(r.player_id, { score: r.score, rank: idx + 1 });
    });
    const tags = (profileRow.tags ?? []) as string[];
    profileResults.set(profileRow.id, {
      rankByPlayer,
      total: result.ranked.length,
      name: profileRow.name,
      isSeed: tags.includes('seed'),
    });
  }

  // 5. Para cada jogador da equipa, recolher scores em todos os perfis em que é elegível
  const enriched: TeamPlayer[] = (teamPlayers ?? []).map((p) => {
    const playerPos = p.position_primary;
    const profilesForPlayer: ProfileScoreEntry[] = [];

    for (const profileRow of allProfiles ?? []) {
      // Verificar se o perfil aceita esta posição
      const filters = profileRow.filters as { positions?: string[] } | null;
      const positions = filters?.positions ?? [];
      if (!playerPos || !positions.includes(playerPos)) continue;

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