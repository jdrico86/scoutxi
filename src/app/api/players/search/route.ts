import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

// GET /api/players/search?q=Joel
export async function GET(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
  if (q.length < 2) {
    return NextResponse.json({ players: [] });
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data: players, error } = await supabase
    .from('players')
    .select('id, name, current_team, position_primary, age, pool_id, minutes_played')
    .ilike('name', `%${q}%`)
    .order('minutes_played', { ascending: false, nullsFirst: false })
    .limit(15);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fetch separado dos pools para enriquecer
  const poolIds = Array.from(new Set((players ?? []).map((p) => p.pool_id)));
  let poolMap = new Map<string, string>();
  if (poolIds.length > 0) {
    const { data: pools } = await supabase
      .from('pools')
      .select('id, name')
      .in('id', poolIds);
    poolMap = new Map((pools ?? []).map((p) => [p.id, p.name]));
  }

  const enriched = (players ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    current_team: p.current_team,
    position_primary: p.position_primary,
    age: p.age,
    pool_id: p.pool_id,
    pool_name: poolMap.get(p.pool_id) ?? null,
  }));

  return NextResponse.json({ players: enriched });
}