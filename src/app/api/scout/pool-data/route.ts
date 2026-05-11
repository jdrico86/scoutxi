import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/supabase/server';
import { getCached, setCached, invalidateCached } from '@/lib/scouting/pool-cache';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/scout/pool-data?pool_id=<uuid>&refresh=1
 *
 * Devolve players + stats + pool_name em bruto, paginado. Cliente cacheia
 * em React state durante a sessão. Filtros, percentis e ordenação correm
 * todos no browser (query-builder é pura).
 *
 * Use ?refresh=1 para o botão "Recarregar dados" (limpa cache server-side
 * antes de fazer fetch).
 *
 * Players inclui team_in_period (não está em PlayerInput de scorer.ts), por
 * isso fazemos o fetch directamente aqui em vez de reutilizar loadPoolData.
 */
type PoolDataPlayer = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  on_loan: boolean | null;
  // Não usados na filtragem mas exigidos pelo tipo PlayerInput de scorer.ts
  contract_until: string | null;
  market_value_eur: number | null;
};

type PoolDataStat = {
  player_id: string;
  metric_code: string;
  metric_value: number | null;
};

type PoolDataResponse = {
  pool_name: string;
  players: PoolDataPlayer[];
  stats: PoolDataStat[];
  generated_at: string;
};

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const poolId = req.nextUrl.searchParams.get('pool_id');
  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (!poolId || !/^[0-9a-f-]{36}$/i.test(poolId)) {
    return NextResponse.json({ error: 'pool_id inválido.' }, { status: 400 });
  }

  if (refresh) invalidateCached(poolId);

  const cached = getCached<PoolDataResponse>(poolId);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { 'x-cache': 'HIT' },
    });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── Pool name ─────────────────────────────────────────────────────────
  const { data: poolRow, error: poolErr } = await supabase
    .from('pools')
    .select('name, season')
    .eq('id', poolId)
    .maybeSingle();
  if (poolErr) return NextResponse.json({ error: poolErr.message }, { status: 500 });
  if (!poolRow) return NextResponse.json({ error: 'Pool não encontrada.' }, { status: 404 });
  const pool_name = `${poolRow.name} ${poolRow.season}`;

  // ── Players paginados (com team_in_period) ────────────────────────────
  const players: PoolDataPlayer[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('players')
      .select('id, name, current_team, team_in_period, position_primary, age, minutes_played, on_loan, contract_until, market_value_eur')
      .eq('pool_id', poolId)
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!page || page.length === 0) break;
    players.push(...(page as PoolDataPlayer[]));
    if (page.length < PAGE) break;
    from += PAGE;
  }

  // ── Stats paginados (via inner join no pool) ──────────────────────────
  const stats: PoolDataStat[] = [];
  let sFrom = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('player_stats')
      .select('player_id, metric_code, metric_value, players!inner(pool_id)')
      .eq('players.pool_id', poolId)
      .range(sFrom, sFrom + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!page || page.length === 0) break;
    for (const row of page as Array<{ player_id: string; metric_code: string; metric_value: number | null }>) {
      stats.push({ player_id: row.player_id, metric_code: row.metric_code, metric_value: row.metric_value });
    }
    if (page.length < PAGE) break;
    sFrom += PAGE;
  }

  const response: PoolDataResponse = {
    pool_name,
    players,
    stats,
    generated_at: new Date().toISOString(),
  };

  setCached(poolId, response);

  return NextResponse.json(response, {
    headers: { 'x-cache': 'MISS' },
  });
}
