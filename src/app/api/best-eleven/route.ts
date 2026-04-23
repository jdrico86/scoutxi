import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, loadProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';
import { getFormation } from '@/lib/best-eleven/formations';
import { assignPlayersToSlots, type PlayerScoreInSlot } from '@/lib/best-eleven/assignment';

export const runtime = 'nodejs';
export const maxDuration = 120;

const BestElevenSchema = z.object({
  pool_id: z.string().uuid(),
  formation_id: z.string(),
  slot_profiles: z.record(z.string(), z.string().uuid()), // slot_id → profile_id
  filters: z
    .object({
      max_age: z.number().int().positive().optional(),
      max_market_value_eur: z.number().int().positive().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof BestElevenSchema>;
  try {
    body = BestElevenSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const formation = getFormation(body.formation_id);
  if (!formation) return NextResponse.json({ error: 'Formação desconhecida.' }, { status: 400 });

  // Validar que todos os slots têm perfil
  const missingSlots = formation.slots.filter((s) => !body.slot_profiles[s.id]);
  if (missingSlots.length > 0) {
    return NextResponse.json(
      { error: `Faltam perfis para os slots: ${missingSlots.map((s) => s.label).join(', ')}` },
      { status: 400 }
    );
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Carregar pool data uma só vez
  const poolData = await loadPoolData(supabase, body.pool_id);

  // Aplicar filtros extra de idade/valor
  let eligiblePlayers = poolData.players;
  if (body.filters?.max_age != null) {
    const maxAge = body.filters.max_age;
    eligiblePlayers = eligiblePlayers.filter((p) => p.age != null && p.age <= maxAge);
  }
  if (body.filters?.max_market_value_eur != null) {
    const maxVal = body.filters.max_market_value_eur;
    eligiblePlayers = eligiblePlayers.filter(
      (p) => p.market_value_eur == null || p.market_value_eur <= maxVal
    );
  }
  const eligibleIds = new Set(eligiblePlayers.map((p) => p.id));

  // Para cada perfil único, carregar e calcular score uma só vez
  const uniqueProfileIds = Array.from(new Set(Object.values(body.slot_profiles)));
  const profileCache = new Map<
    string,
    { id: string; name: string; result: Awaited<ReturnType<typeof scoreProfile>> }
  >();

  for (const profileId of uniqueProfileIds) {
    const profileData = await loadProfile(supabase, profileId);
    if (!profileData) {
      return NextResponse.json(
        { error: `Perfil não encontrado: ${profileId}` },
        { status: 404 }
      );
    }
    const result = scoreProfile({
      pool_id: body.pool_id,
      profile: profileData.profile,
      players: poolData.players,
      stats: poolData.stats,
      metric_directions: poolData.directions,
    });
    profileCache.set(profileId, {
      id: profileId,
      name: profileData.profile.name,
      result,
    });
  }

  // Construir lista de candidatos (slot, jogador, score) respeitando slot.accepted_positions
  const candidates: PlayerScoreInSlot[] = [];
  const playerById = new Map(poolData.players.map((p) => [p.id, p]));

  for (const slot of formation.slots) {
    const profileId = body.slot_profiles[slot.id];
    const cached = profileCache.get(profileId);
    if (!cached) continue;

    for (const ranked of cached.result.ranked) {
      const player = playerById.get(ranked.player_id);
      if (!player) continue;
      if (!eligibleIds.has(player.id)) continue; // Filtros extra

      // Slot só aceita certas posições
      if (player.position_primary && !slot.accepted_positions.includes(player.position_primary)) {
        continue;
      }

      candidates.push({
        slot_id: slot.id,
        player_id: player.id,
        player_name: player.name,
        player_team: player.current_team,
        player_position: player.position_primary,
        player_age: player.age,
        player_minutes: player.minutes_played,
        player_market_value_eur: player.market_value_eur,
        player_contract_until: player.contract_until,
        profile_id: profileId,
        profile_name: cached.name,
        score: ranked.score,
      });
    }
  }

  // Construir mapa slot_id → {profile_id, profile_name}
  const slotProfiles: Record<string, { id: string; name: string }> = {};
  for (const slot of formation.slots) {
    const profileId = body.slot_profiles[slot.id];
    const cached = profileCache.get(profileId);
    slotProfiles[slot.id] = {
      id: profileId,
      name: cached?.name ?? '',
    };
  }

  const assignments = assignPlayersToSlots(formation.slots, slotProfiles, candidates);

  // Meta
  const totalScore = assignments.reduce((sum, a) => sum + (a.score ?? 0), 0);
  const unfilledCount = assignments.filter((a) => a.player_id == null).length;

  // Pool info
  const { data: pool } = await supabase
    .from('pools')
    .select('id, name, season, competition')
    .eq('id', body.pool_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    pool,
    formation: { id: formation.id, name: formation.name, description: formation.description },
    filters: body.filters ?? null,
    assignments,
    total_score: totalScore,
    unfilled_count: unfilledCount,
    eligible_pool_size: eligiblePlayers.length,
  });
}