import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, loadProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile, resolvePeerPositions } from '@/lib/scouting/scorer';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BodySchema = z.object({
  pool_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  /** Limite de resultados. Default 50, max 500. */
  limit: z.number().int().positive().max(500).optional(),
  /**
   * Quando indicado, devolve só este jogador — e carrega apenas o peer group e
   * as métricas do perfil, em vez da pool inteira. É o que a ficha do jogador
   * usa para o radar: antes puxava 46 612 linhas de estatística em 47 pedidos
   * paginados para mostrar o detalhe de um jogador só.
   */
  player_id: z.string().uuid().optional(),
});

/** Divide ids em blocos, para o `.in()` não gerar URLs demasiado longas. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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

  // ── Caminho rápido: detalhe de um jogador só ──────────────────────────
  //
  //    O score de um jogador depende apenas dos valores dele e da distribuição
  //    das métricas do perfil dentro do peer group. Não é preciso a pool toda:
  //    basta o peer group (posição primária) e as métricas com peso. Num perfil
  //    de AMF são ~47 jogadores × 6 métricas, contra 1261 × 45.
  const peerPositions = resolvePeerPositions(profileData.profile);
  const weightedCodes = Array.from(new Set(profileData.profile.weights.map((w) => w.metric_code)));

  if (body.player_id && peerPositions.length > 0 && weightedCodes.length > 0) {
    const PLAYER_COLS =
      'id, name, current_team, position_primary, positions_secondary, age, minutes_played, contract_until, market_value_eur, on_loan';

    const { data: peerRows, error: peerErr } = await supabase
      .from('players')
      .select(PLAYER_COLS)
      .eq('pool_id', body.pool_id)
      .in('position_primary', peerPositions);
    if (peerErr) return NextResponse.json({ error: peerErr.message }, { status: 500 });

    // O jogador pode ser elegível por posição secundária e não estar no peer group.
    const subset = [...(peerRows ?? [])];
    if (!subset.some((p) => p.id === body.player_id)) {
      const { data: target } = await supabase
        .from('players')
        .select(PLAYER_COLS)
        .eq('id', body.player_id)
        .maybeSingle();
      if (target) subset.push(target);
    }

    const { data: metricsRows } = await supabase.from('metrics').select('code, direction');
    const subsetDirections: Record<string, 'higher' | 'lower'> = {};
    for (const m of (metricsRows ?? []) as Array<{ code: string; direction: string | null }>) {
      subsetDirections[m.code] =
        m.direction === 'lower' || m.direction === 'lower_better' ? 'lower' : 'higher';
    }

    const subsetStats: Array<{ player_id: string; metric_code: string; metric_value: number | null }> = [];
    for (const ids of chunk(subset.map((p) => p.id), 100)) {
      const { data, error } = await supabase
        .from('player_stats')
        .select('player_id, metric_code, metric_value')
        .in('player_id', ids)
        .in('metric_code', weightedCodes);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      subsetStats.push(...(data ?? []));
    }

    const subsetResult = scoreProfile({
      pool_id: body.pool_id,
      profile: profileData.profile,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      players: subset as any,
      stats: subsetStats,
      metric_directions: subsetDirections,
    });

    const found = subsetResult.ranked.find((p) => p.player_id === body.player_id);
    return NextResponse.json({
      ok: true,
      pool: poolData,
      profile: { id: profileData.id, name: profileData.profile.name },
      peer_group_size: subsetResult.peer_group_size,
      // O rank e o total de elegíveis verdadeiros vêm de profile_scores, não
      // deste subconjunto — aqui só interessa o breakdown por métrica.
      ranked: found ? [found] : [],
      warnings: subsetResult.warnings,
      partial: true,
    });
  }

  // ── Caminho completo: ranking da pool ─────────────────────────────────
  const { players, stats, directions } = await loadPoolData(supabase, body.pool_id);

  // Correr scorer
  const result = scoreProfile({
    pool_id: body.pool_id,
    profile: profileData.profile,
    players,
    stats,
    metric_directions: directions,
  });

  // Com `player_id`, devolve-se esse jogador e não o topo da tabela. Sem isto,
  // um `limit` pequeno cortava-o fora e o cliente ficava sem breakdown — era o
  // que acontecia nos perfis que caíam para aqui por terem peer group vazio.
  if (body.player_id) {
    const found = result.ranked.find((p) => p.player_id === body.player_id);
    return NextResponse.json({
      ok: true,
      pool: poolData,
      profile: { id: profileData.id, name: profileData.profile.name },
      peer_group_size: result.peer_group_size,
      ranked: found ? [found] : [],
      warnings: result.warnings,
      partial: false,
    });
  }

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