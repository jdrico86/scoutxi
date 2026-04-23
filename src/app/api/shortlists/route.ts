import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, loadProfile } from '@/lib/scouting/db-helpers';
import { buildSnapshotEntries } from '@/lib/scouting/shortlist-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Schema: criar shortlist a partir de um perfil aplicado a um pool.
// Por agora só suportamos este modo (gerada por perfil) — manual/mista vem depois.
const CreateShortlistSchema = z.object({
  name: z.string().min(1).max(200),
  pool_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  // Quantos jogadores do top guardar. Default 30.
  limit: z.number().int().positive().max(200).optional(),
});

// ── GET /api/shortlists ──────────────────────────────────────────────────
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data: shortlists, error } = await supabase
    .from('shortlists')
    .select('id, name, pool_id, profile_id, created_at')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Contar jogadores por shortlist (uma query separada — RLS-friendly e evita join complexo)
  const ids = (shortlists ?? []).map((s) => s.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: spData } = await supabase
      .from('shortlist_players')
      .select('shortlist_id')
      .in('shortlist_id', ids);
    for (const row of spData ?? []) {
      counts.set(row.shortlist_id, (counts.get(row.shortlist_id) ?? 0) + 1);
    }
  }

  const enriched = (shortlists ?? []).map((s) => ({
    ...s,
    player_count: counts.get(s.id) ?? 0,
  }));

  return NextResponse.json({ shortlists: enriched });
}

// ── POST /api/shortlists ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof CreateShortlistSchema>;
  try {
    body = CreateShortlistSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Carregar perfil
  const profileData = await loadProfile(supabase, body.profile_id);
  if (!profileData) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });

  // Aplicar scoring
  const { players, stats, directions } = await loadPoolData(supabase, body.pool_id);
  const result = scoreProfile({
    pool_id: body.pool_id,
    profile: profileData.profile,
    players,
    stats,
    metric_directions: directions,
  });

  const limit = body.limit ?? 30;
  const top = result.ranked.slice(0, limit);

  // Criar shortlist
  const { data: created, error: createErr } = await supabase
    .from('shortlists')
    .insert({
      name: body.name,
      pool_id: body.pool_id,
      profile_id: body.profile_id,
    })
    .select('id, name, created_at')
    .single();
  if (createErr || !created) {
    return NextResponse.json(
      { error: `Falha a criar shortlist: ${createErr?.message ?? 'desconhecido'}` },
      { status: 500 }
    );
  }

  // Adicionar jogadores
  const entries = buildSnapshotEntries(top);
  if (entries.length > 0) {
    const rows = entries.map((e) => ({
      shortlist_id: created.id,
      player_id: e.player_id,
      snapshot_score: e.snapshot_score,
      snapshot_rank: e.snapshot_rank,
    }));
    const { error: spErr } = await supabase.from('shortlist_players').insert(rows);
    if (spErr) {
      // Rollback: apaga shortlist meio criada
      await supabase.from('shortlists').delete().eq('id', created.id);
      return NextResponse.json(
        { error: `Falha a adicionar jogadores: ${spErr.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { ok: true, shortlist: { ...created, player_count: entries.length } },
    { status: 201 }
  );
}