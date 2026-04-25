import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

// GET /api/players/search?q=Joel
// Devolve { players: [...], teams: [...] }
export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ players: [], teams: [] });
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // 1. Jogadores
  const { data: players, error: pErr } = await supabase
    .from('players')
    .select('id, name, current_team, position_primary, age, pool_id, minutes_played')
    .ilike('name', `%${q}%`)
    .order('minutes_played', { ascending: false, nullsFirst: false })
    .limit(15);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  // 2. Equipas (combinações distintas current_team + pool_id)
  const { data: teamRows, error: tErr } = await supabase
    .from('players')
    .select('current_team, pool_id')
    .ilike('current_team', `%${q}%`)
    .not('current_team', 'is', null)
    .limit(200); // lemos um pouco mais para depois deduplicar

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  // Deduplicar pares (current_team, pool_id)
  const teamSet = new Map<string, { current_team: string; pool_id: string }>();
  for (const row of teamRows ?? []) {
    if (!row.current_team) continue;
    const key = `${row.pool_id}::${row.current_team}`;
    if (!teamSet.has(key)) {
      teamSet.set(key, { current_team: row.current_team, pool_id: row.pool_id });
    }
  }
  const teamList = Array.from(teamSet.values()).slice(0, 10);

  // 3. Pools (para enriquecer ambos)
  const allPoolIds = Array.from(
    new Set([
      ...(players ?? []).map((p) => p.pool_id),
      ...teamList.map((t) => t.pool_id),
    ])
  );

  let poolMap = new Map<string, string>();
  if (allPoolIds.length > 0) {
    const { data: pools } = await supabase
      .from('pools')
      .select('id, name')
      .in('id', allPoolIds);
    poolMap = new Map((pools ?? []).map((p) => [p.id, p.name]));
  }

  const enrichedPlayers = (players ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    current_team: p.current_team,
    position_primary: p.position_primary,
    age: p.age,
    pool_id: p.pool_id,
    pool_name: poolMap.get(p.pool_id) ?? null,
  }));

  const enrichedTeams = teamList.map((t) => ({
    name: t.current_team,
    pool_id: t.pool_id,
    pool_name: poolMap.get(t.pool_id) ?? null,
  }));

  return NextResponse.json({ players: enrichedPlayers, teams: enrichedTeams });
}