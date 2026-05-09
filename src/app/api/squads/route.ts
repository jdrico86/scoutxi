import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const FORMATION_IDS = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3'] as const;

const CreateSquadSchema = z.object({
  name: z.string().min(1).max(200),
  formation: z.enum(FORMATION_IDS).default('4-3-3'),
  notes: z.string().max(2000).optional(),
});

// ── GET /api/squads ──────────────────────────────────────────────────────
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: squads, error } = await supabase
    .from('squads')
    .select('id, name, formation, notes, created_at, updated_at')
    .eq('owner_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (squads ?? []).map((s) => s.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: spData } = await supabase
      .from('squad_players')
      .select('squad_id')
      .in('squad_id', ids);
    for (const row of spData ?? []) {
      counts.set(row.squad_id, (counts.get(row.squad_id) ?? 0) + 1);
    }
  }

  const enriched = (squads ?? []).map((s) => ({
    ...s,
    player_count: counts.get(s.id) ?? 0,
  }));

  return NextResponse.json({ squads: enriched });
}

// ── POST /api/squads ─────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof CreateSquadSchema>;
  try {
    body = CreateSquadSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Input inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: created, error } = await supabase
    .from('squads')
    .insert({
      name: body.name,
      formation: body.formation,
      notes: body.notes ?? null,
      owner_id: user.id,
    })
    .select('id, name, formation, notes, created_at, updated_at')
    .single();

  if (error || !created) {
    return NextResponse.json(
      { error: `Falha a criar equipa: ${error?.message ?? 'desconhecido'}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, squad: { ...created, player_count: 0 } }, { status: 201 });
}
