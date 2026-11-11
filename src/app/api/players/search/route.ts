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

  // 2. Equipas (combinações distintas equipa + pool_id).
  //    A equipa é o `team_in_period` — o clube por quem o jogador alinhou naquela
  //    competição — com recurso ao `current_team` quando o export não o trouxe.
  //    Procurar só pelo `current_team` devolvia clubes que nem sequer disputam a
  //    prova, e falhava clubes cujos jogadores estão todos emprestados de fora.
  const [periodRows, legacyRows] = await Promise.all([
    supabase
      .from('players')
      .select('team_in_period, current_team, pool_id')
      .ilike('team_in_period', `%${q}%`)
      .limit(200),
    supabase
      .from('players')
      .select('team_in_period, current_team, pool_id')
      .is('team_in_period', null)
      .ilike('current_team', `%${q}%`)
      .limit(200),
  ]);

  const tErr = periodRows.error ?? legacyRows.error;
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 });

  // Deduplicar pares (equipa, pool_id)
  const teamSet = new Map<string, { current_team: string; pool_id: string }>();
  for (const row of [...(periodRows.data ?? []), ...(legacyRows.data ?? [])]) {
    const team = (row.team_in_period ?? row.current_team ?? '').trim();
    if (!team) continue;
    const key = `${row.pool_id}::${team}`;
    if (!teamSet.has(key)) {
      teamSet.set(key, { current_team: team, pool_id: row.pool_id });
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