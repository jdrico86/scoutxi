import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const MAX_TEAMS = 12;
const MAX_PLAYERS = 15;
/** Linhas de jogadores lidas antes de agrupar: um jogador tem uma por época. */
const PLAYER_ROWS = 300;

type PoolRow = { id: string; name: string; season: string; tier: number | null };
type PlayerRow = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  pool_id: string;
  minutes_played: number | null;
  identity_id: string | null;
};

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** 0 = nome igual ao pesquisado, 1 = começa por ele, 2 = contém. */
const relevance = (name: string, q: string) => {
  const n = fold(name);
  return n === q ? 0 : n.startsWith(q) ? 1 : 2;
};

/**
 * GET /api/players/search?q=Nacional
 *
 * Devolve { players, teams }, uma linha por jogador e uma por equipa, mesmo
 * que existam em várias épocas. Cada linha aponta para a época mais recente e
 * diz em quantas aparece (`seasons`).
 */
export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ players: [], teams: [] });
  const folded = fold(q);

  // Cliente sem tipos: a função search_teams não está em database.types.ts.
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [playersRes, teamsRes, poolsRes] = await Promise.all([
    supabase
      .from('players')
      .select('id, name, current_team, team_in_period, position_primary, age, pool_id, minutes_played, identity_id')
      .ilike('name', `%${q}%`)
      .order('minutes_played', { ascending: false, nullsFirst: false })
      .order('id')
      .limit(PLAYER_ROWS),
    supabase.rpc('search_teams', { q }),
    supabase.from('pools').select('id, name, season, tier'),
  ]);
  const failure = playersRes.error ?? teamsRes.error ?? poolsRes.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 500 });

  const pools = new Map(((poolsRes.data ?? []) as PoolRow[]).map((p) => [p.id, p]));
  const season = (poolId: string) => pools.get(poolId)?.season ?? '';
  const tier = (poolId: string) => pools.get(poolId)?.tier ?? 99;
  /** Mais recente primeiro; na mesma época, o escalão mais alto. */
  const newer = (a: string, b: string) =>
    season(a) !== season(b) ? season(a) > season(b) : tier(a) < tier(b);

  // ── Equipas: uma linha por nome ────────────────────────────────────────
  const teamGroups = new Map<string, { name: string; pool_id: string; seasons: Set<string> }>();
  for (const row of (teamsRes.data ?? []) as Array<{ team: string; pool_id: string }>) {
    if (!pools.has(row.pool_id)) continue;
    const g = teamGroups.get(row.team);
    if (!g) {
      teamGroups.set(row.team, { name: row.team, pool_id: row.pool_id, seasons: new Set([season(row.pool_id)]) });
    } else {
      g.seasons.add(season(row.pool_id));
      if (newer(row.pool_id, g.pool_id)) g.pool_id = row.pool_id;
    }
  }
  const teams = [...teamGroups.values()]
    .sort(
      (a, b) =>
        relevance(a.name, folded) - relevance(b.name, folded) ||
        season(b.pool_id).localeCompare(season(a.pool_id)) ||
        a.name.localeCompare(b.name, 'pt')
    )
    .slice(0, MAX_TEAMS)
    .map((g) => ({
      name: g.name,
      pool_id: g.pool_id,
      pool_name: pools.get(g.pool_id)?.name ?? null,
      seasons: g.seasons.size,
    }));

  // ── Jogadores: uma linha por identidade ────────────────────────────────
  // Sem identidade atribuída (jogador que só existe numa época ou que ainda
  // não foi ligado), cada registo conta como um jogador.
  const playerGroups = new Map<string, { latest: PlayerRow; seasons: Set<string> }>();
  for (const row of (playersRes.data ?? []) as PlayerRow[]) {
    const k = row.identity_id ?? row.id;
    const g = playerGroups.get(k);
    if (!g) {
      playerGroups.set(k, { latest: row, seasons: new Set([season(row.pool_id)]) });
    } else {
      g.seasons.add(season(row.pool_id));
      if (newer(row.pool_id, g.latest.pool_id)) g.latest = row;
    }
  }
  const players = [...playerGroups.values()]
    .sort(
      (a, b) =>
        relevance(a.latest.name, folded) - relevance(b.latest.name, folded) ||
        season(b.latest.pool_id).localeCompare(season(a.latest.pool_id)) ||
        (b.latest.minutes_played ?? 0) - (a.latest.minutes_played ?? 0)
    )
    .slice(0, MAX_PLAYERS)
    .map(({ latest: p, seasons }) => ({
      id: p.id,
      name: p.name,
      current_team: p.team_in_period ?? p.current_team,
      position_primary: p.position_primary,
      age: p.age,
      pool_id: p.pool_id,
      pool_name: pools.get(p.pool_id)?.name ?? null,
      seasons: seasons.size,
    }));

  return NextResponse.json({ players, teams });
}
