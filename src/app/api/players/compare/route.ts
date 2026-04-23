import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, loadProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CompareSchema = z.object({
  player_a_id: z.string().uuid(),
  player_b_id: z.string().uuid(),
  profile_id: z.string().uuid(),
});

/**
 * POST /api/players/compare
 * Aplica um perfil aos pools de ambos os jogadores e devolve os breakdowns.
 *
 * Se forem de pools diferentes, aplica separadamente a cada pool
 * (percentis calculados dentro do respectivo pool).
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof CompareSchema>;
  try {
    body = CompareSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Carregar ambos os jogadores
  const { data: players } = await supabase
    .from('players')
    .select('id, name, current_team, position_primary, age, pool_id')
    .in('id', [body.player_a_id, body.player_b_id]);

  const playerA = players?.find((p) => p.id === body.player_a_id);
  const playerB = players?.find((p) => p.id === body.player_b_id);

  if (!playerA || !playerB) {
    return NextResponse.json({ error: 'Um ou ambos os jogadores não encontrados.' }, { status: 404 });
  }

  const profileData = await loadProfile(supabase, body.profile_id);
  if (!profileData) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });

  const profile = profileData.profile;

  // Validar que ambos os jogadores são elegíveis pela posição
  const filterPositions = profile.filters.positions ?? [];
  if (filterPositions.length > 0) {
    if (playerA.position_primary && !filterPositions.includes(playerA.position_primary)) {
      return NextResponse.json({ error: `${playerA.name} não é elegível a este perfil (posição: ${playerA.position_primary}).` }, { status: 400 });
    }
    if (playerB.position_primary && !filterPositions.includes(playerB.position_primary)) {
      return NextResponse.json({ error: `${playerB.name} não é elegível a este perfil (posição: ${playerB.position_primary}).` }, { status: 400 });
    }
  }

  // Aplicar scoring (pode ser aos 2 pools se forem diferentes)
  const samePool = playerA.pool_id === playerB.pool_id;

  const poolAData = await loadPoolData(supabase, playerA.pool_id);
  const resultA = scoreProfile({
    pool_id: playerA.pool_id,
    profile,
    players: poolAData.players,
    stats: poolAData.stats,
    metric_directions: poolAData.directions,
  });
  const foundA = resultA.ranked.find((p) => p.player_id === playerA.id);

  let resultB = resultA;
  let foundB = resultA.ranked.find((p) => p.player_id === playerB.id);

  if (!samePool) {
    const poolBData = await loadPoolData(supabase, playerB.pool_id);
    resultB = scoreProfile({
      pool_id: playerB.pool_id,
      profile,
      players: poolBData.players,
      stats: poolBData.stats,
      metric_directions: poolBData.directions,
    });
    foundB = resultB.ranked.find((p) => p.player_id === playerB.id);
  }

  if (!foundA || !foundB) {
    return NextResponse.json({
      error: 'Um ou ambos os jogadores não são elegíveis no perfil (provavelmente falham filtros de minutos/idade).',
    }, { status: 400 });
  }

  // Fetch pools' names for display
  const poolIds = Array.from(new Set([playerA.pool_id, playerB.pool_id]));
  const { data: pools } = await supabase
    .from('pools')
    .select('id, name')
    .in('id', poolIds);
  const poolMap = new Map((pools ?? []).map((p) => [p.id, p.name]));

  return NextResponse.json({
    ok: true,
    same_pool: samePool,
    profile: { id: profileData.id, name: profile.name, description: profile.description ?? null },
    player_a: {
      ...playerA,
      pool_name: poolMap.get(playerA.pool_id) ?? null,
      score: foundA.score,
      rank: resultA.ranked.indexOf(foundA) + 1,
      total_eligible: resultA.ranked.length,
      contributions: foundA.contributions,
      missing_metrics: foundA.missing_metrics,
    },
    player_b: {
      ...playerB,
      pool_name: poolMap.get(playerB.pool_id) ?? null,
      score: foundB.score,
      rank: resultB.ranked.indexOf(foundB) + 1,
      total_eligible: resultB.ranked.length,
      contributions: foundB.contributions,
      missing_metrics: foundB.missing_metrics,
    },
  });
}