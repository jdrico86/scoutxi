import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, loadProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BodySchema = z.object({
  pool_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  /** Limite de resultados. Default 50, max 500. */
  limit: z.number().int().positive().max(500).optional(),
});

/**
 * POST /api/score
 *
 * Body: { pool_id, profile_id, limit? }
 *
 * Aplica um perfil guardado a uma pool e devolve o ranking ordenado.
 * A resposta inclui breakdown por métrica para explicabilidade.
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY em falta no .env.local' },
      { status: 500 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Body inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Carregar perfil
  const profileData = await loadProfile(supabase, body.profile_id);
  if (!profileData) {
    return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });
  }

  // Carregar pool
  const { data: poolData, error: poolErr } = await supabase
    .from('pools')
    .select('id, name, season, competition')
    .eq('id', body.pool_id)
    .maybeSingle();
  if (poolErr) {
    return NextResponse.json({ error: `Erro a ler pool: ${poolErr.message}` }, { status: 500 });
  }
  if (!poolData) {
    return NextResponse.json({ error: 'Pool não encontrada.' }, { status: 404 });
  }

  // Carregar players + stats + directions
  const { players, stats, directions } = await loadPoolData(supabase, body.pool_id);

  // Correr scorer
  const result = scoreProfile({
    pool_id: body.pool_id,
    profile: profileData.profile,
    players,
    stats,
    metric_directions: directions,
  });

  const limit = body.limit ?? 50;
  return NextResponse.json({
    ok: true,
    pool: poolData,
    profile: { id: profileData.id, name: profileData.profile.name },
    total_players_in_pool: result.total_players_in_pool,
    peer_group_size: result.peer_group_size,
    eligible_count: result.eligible_count,
    warnings: result.warnings,
    ranked: result.ranked.slice(0, limit),
  });
}