import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, loadProfile } from '@/lib/scouting/db-helpers';
import { scoreProfile, resolvePeerPositions } from '@/lib/scouting/scorer';
import { scorePlayerInProfile } from '@/lib/scouting/score-player';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BodySchema = z.object({
  pool_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  /** Limite de resultados. Sem limite, devolve todos os elegíveis. */
  limit: z.number().int().positive().max(5000).optional(),
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
 *
 * Três caminhos:
 *  - com `player_id`: detalhe de um jogador, com breakdown por métrica;
 *  - ranking lido de `profile_scores` (`cached: true`), sem breakdown — o
 *    cliente pede-o por jogador quando abre uma linha;
 *  - ranking calculado ao vivo, só quando o perfil não tem scores guardados.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

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

  // O perfil tem de ser seed (sem dono) ou do utilizador actual. Sem isto,
  // quem soubesse o id de um perfil alheio via o ranking e os pesos dele.
  const { data: ownerRow } = await supabase
    .from('scouting_profiles')
    .select('owner_id')
    .eq('id', body.profile_id)
    .maybeSingle();
  if (!ownerRow || (ownerRow.owner_id !== null && ownerRow.owner_id !== user.id)) {
    return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });
  }

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
  //    Carrega só o peer group e as métricas com peso — ver
  //    lib/scouting/score-player.ts.
  const peerPositions = resolvePeerPositions(profileData.profile);

  if (body.player_id) {
    let detail;
    try {
      detail = await scorePlayerInProfile(supabase, {
        poolId: body.pool_id,
        profile: profileData.profile,
        playerId: body.player_id,
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
    if (detail) {
      return NextResponse.json({
        ok: true,
        pool: poolData,
        profile: { id: profileData.id, name: profileData.profile.name },
        peer_group_size: detail.peer_group_size,
        // O rank e o total de elegíveis verdadeiros vêm de profile_scores, não
        // deste subconjunto — aqui só interessa o breakdown por métrica.
        ranked: detail.scored ? [detail.scored] : [],
        warnings: detail.warnings,
        partial: true,
      });
    }
    // Perfil sem peer group ou sem pesos: segue para o cálculo completo.
  }

  // ── Ranking a partir de profile_scores ────────────────────────────────
  //
  //    Os scores só mudam no import ou quando o perfil é editado, e já estão
  //    gravados. Até 14/11/2026 o separador Perfis recalculava-os a cada
  //    clique: pool inteira descarregada, 18 segundos em produção no CP. Aqui
  //    são duas leituras pequenas — as linhas do perfil e os jogadores delas.
  if (!body.player_id) {
    const cachedRows: Array<{ player_id: string; score: number; rank: number; total_eligible: number }> = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('profile_scores')
        .select('player_id, score, rank, total_eligible')
        .eq('pool_id', body.pool_id)
        .eq('profile_id', body.profile_id)
        .order('rank', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      cachedRows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }

    if (cachedRows.length > 0) {
      const wanted = body.limit ? cachedRows.slice(0, body.limit) : cachedRows;

      const RANK_COLS =
        'id, name, current_team, position_primary, positions_secondary, age, minutes_played, contract_until, market_value_eur';
      const pages = await Promise.all(
        chunk(wanted.map((r) => r.player_id), 100).map((ids) =>
          supabase.from('players').select(RANK_COLS).in('id', ids)
        )
      );
      const playerById = new Map<string, NonNullable<(typeof pages)[number]['data']>[number]>();
      for (const page of pages) {
        if (page.error) return NextResponse.json({ error: page.error.message }, { status: 500 });
        for (const p of page.data ?? []) playerById.set(p.id, p);
      }

      // Contagens para o cabeçalho, sem trazer linhas.
      const poolCount = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('pool_id', body.pool_id);
      let peerSize = poolCount.count ?? 0;
      if (peerPositions.length > 0) {
        const peerCount = await supabase
          .from('players')
          .select('id', { count: 'exact', head: true })
          .eq('pool_id', body.pool_id)
          .in('position_primary', peerPositions);
        peerSize = peerCount.count ?? 0;
      }

      // Os mesmos avisos que o scorer daria.
      const warnings: string[] = [];
      const totalWeight = profileData.profile.weights.reduce((sum, w) => sum + w.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        warnings.push(
          `Pesos do perfil somam ${totalWeight.toFixed(2)} em vez de 100. Os scores serão normalizados.`
        );
      }
      if (peerSize < 10) {
        warnings.push(
          `Peer group tem só ${peerSize} jogadores — percentis pouco fiáveis. Alarga peer_group_positions.`
        );
      }

      const ranked = wanted.flatMap((r) => {
        const p = playerById.get(r.player_id);
        if (!p) return [];
        return [
          {
            player_id: p.id,
            name: p.name,
            current_team: p.current_team,
            position_primary: p.position_primary,
            positions_secondary: p.positions_secondary,
            age: p.age,
            minutes_played: p.minutes_played,
            contract_until: p.contract_until,
            market_value_eur: p.market_value_eur,
            score: Number(r.score),
            rank: r.rank,
          },
        ];
      });

      return NextResponse.json({
        ok: true,
        cached: true,
        pool: poolData,
        profile: { id: profileData.id, name: profileData.profile.name },
        total_players_in_pool: poolCount.count ?? 0,
        peer_group_size: peerSize,
        eligible_count: cachedRows[0].total_eligible,
        warnings,
        ranked,
      });
    }
    // Sem linhas em cache (perfil acabado de editar): segue para o cálculo ao vivo.
  }

  // ── Caminho completo: ranking calculado ao vivo ─────────────────────────────────
  const { players, stats, directions } = await loadPoolData(supabase, body.pool_id);
  const secondaryById = new Map(players.map((p) => [p.id, p.positions_secondary ?? null]));

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

  return NextResponse.json({
    ok: true,
    cached: false,
    pool: poolData,
    profile: { id: profileData.id, name: profileData.profile.name },
    total_players_in_pool: result.total_players_in_pool,
    peer_group_size: result.peer_group_size,
    eligible_count: result.eligible_count,
    warnings: result.warnings,
    // As secundárias vão junto para o cliente marcar quem entra no perfil por elas.
    ranked: (body.limit ? result.ranked.slice(0, body.limit) : result.ranked).map((r) => ({
      ...r,
      positions_secondary: secondaryById.get(r.player_id) ?? null,
    })),
  });
}