import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadPoolData, profileRowToProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';
import { getAuthUser } from '@/lib/supabase/server';

type ProfileFilters = {
  positions?: string[];
  min_minutes?: number;
  min_age?: number;
  max_age?: number;
};

function getEligibilityReason(
  player: { age: number | null; minutes_played: number | null; position_primary: string | null },
  filters: ProfileFilters | null
): string | null {
  if (!filters) return null;
  const { min_age, max_age, min_minutes, positions } = filters;
  if (positions && positions.length > 0 && player.position_primary && !positions.includes(player.position_primary)) {
    return `posição ${player.position_primary} fora das aceites (${positions.join(', ')})`;
  }
  if (max_age != null && player.age != null && player.age > max_age) {
    return `idade acima do limite (${player.age} vs ${max_age})`;
  }
  if (min_age != null && player.age != null && player.age < min_age) {
    return `idade abaixo do limite (${player.age} vs ${min_age})`;
  }
  if (min_minutes != null && player.minutes_played != null && player.minutes_played < min_minutes) {
    return `minutos abaixo do mínimo (${player.minutes_played} vs ${min_minutes})`;
  }
  return null;
}

export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

// GET /api/players/[id]
export async function GET(_: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // 1. Player
  const { data: player, error: pErr } = await supabase
    .from('players')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!player) return NextResponse.json({ error: 'Jogador não encontrado.' }, { status: 404 });

  // 2. Pool (fetch separado)
  const { data: pool } = await supabase
    .from('pools')
    .select('id, name, season, competition')
    .eq('id', player.pool_id)
    .maybeSingle();

  // 3. Stats brutas
  const { data: stats } = await supabase
    .from('player_stats')
    .select('metric_code, value, metric_source')
    .eq('player_id', id);

  // 4. Nota do user actual
  const { data: noteData } = await supabase
    .from('player_notes')
    .select('note, status, contact_info, updated_at')
    .eq('player_id', id)
    .eq('owner_id', user.id)
    .maybeSingle();

  // 5. Shortlists em que o jogador está (apenas as do user actual)
  let shortlists: Array<{
    shortlist_id: string;
    shortlist_name: string | null;
    snapshot_score: number | null;
    snapshot_rank: number | null;
  }> = [];

  // Primeiro, IDs das shortlists do user
  const { data: ownedSl } = await supabase
    .from('shortlists')
    .select('id, name')
    .eq('owner_id', user.id);

  const ownedIds = (ownedSl ?? []).map((s) => s.id);

  if (ownedIds.length > 0) {
    const { data: spRows } = await supabase
      .from('shortlist_players')
      .select('shortlist_id, snapshot_score, snapshot_rank')
      .eq('player_id', id)
      .in('shortlist_id', ownedIds);

    if (spRows && spRows.length > 0) {
      const slMap = new Map((ownedSl ?? []).map((s) => [s.id, s.name]));
      shortlists = spRows.map((r) => ({
        shortlist_id: r.shortlist_id,
        shortlist_name: slMap.get(r.shortlist_id) ?? null,
        snapshot_score: r.snapshot_score,
        snapshot_rank: r.snapshot_rank,
      }));
    }
  }

  // 6. Perfis aplicáveis
  const { data: allProfiles } = await supabase
    .from('scouting_profiles')
    .select('*')
    .order('name');

  const playerPos = player.position_primary;
  const applicableProfiles = (allProfiles ?? []).filter((row) => {
    if (!playerPos) return false;
    const filters = row.filters as { positions?: string[] } | null;
    const positions = filters?.positions ?? [];
    return positions.includes(playerPos);
  });

  // 7. Calcular scores
  const poolScores: Array<{
    profile_id: string;
    profile_name: string;
    profile_description: string | null;
    is_seed: boolean;
    score: number | null;
    rank: number | null;
    eligible: boolean;
    eligibility_reason: string | null;
    total_eligible: number;
  }> = [];

  if (pool && applicableProfiles.length > 0) {
    const { players: poolPlayers, stats: poolStats, directions } = await loadPoolData(supabase, pool.id);

    for (const profileRow of applicableProfiles) {
      const profile = profileRowToProfile(profileRow);
      const result = scoreProfile({
        pool_id: pool.id,
        profile,
        players: poolPlayers,
        stats: poolStats,
        metric_directions: directions,
      });

      const found = result.ranked.find((p) => p.player_id === id);
      const tags = (profileRow.tags ?? []) as string[];
      const isSeed = tags.includes('seed');

      if (found) {
        const rank = result.ranked.indexOf(found) + 1;
        poolScores.push({
          profile_id: profileRow.id,
          profile_name: profileRow.name,
          profile_description: profileRow.description,
          is_seed: isSeed,
          score: found.score,
          rank,
          eligible: true,
          eligibility_reason: null,
          total_eligible: result.ranked.length,
        });
      } else {
        const reason = getEligibilityReason(player, profileRow.filters as ProfileFilters | null);
        poolScores.push({
          profile_id: profileRow.id,
          profile_name: profileRow.name,
          profile_description: profileRow.description,
          is_seed: isSeed,
          score: null,
          rank: null,
          eligible: false,
          eligibility_reason: reason,
          total_eligible: result.ranked.length,
        });
      }
    }

    poolScores.sort((a, b) => {
      if (a.eligible && !b.eligible) return -1;
      if (!a.eligible && b.eligible) return 1;
      if (a.score == null && b.score == null) return 0;
      if (a.score == null) return 1;
      if (b.score == null) return -1;
      return b.score - a.score;
    });
  }

  return NextResponse.json({
      player: {
        id: player.id,
        name: player.name,
        current_team: player.current_team,
        team_in_period: player.team_in_period,
        position_primary: player.position_primary,
        positions_secondary: player.positions_secondary,
        age: player.age,
        height_cm: player.height_cm,
        weight_kg: player.weight_kg,
        foot: player.foot,
        nationality: player.nationality,
        naturality: player.naturality,
        on_loan: player.on_loan,
        contract_until: player.contract_until,
        market_value_eur: player.market_value_eur,
        minutes_played: player.minutes_played,
        games_played: player.games_played,
      },
      pool,
      stats: stats ?? [],
      note: noteData ?? null,
      shortlists,
      applicable_profiles: poolScores,
    });
  }