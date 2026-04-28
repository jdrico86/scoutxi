import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadProfile } from '@/lib/scouting/db-helpers';
import { scoreSpecificPlayers, buildSnapshotEntries } from '@/lib/scouting/shortlist-helpers';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: Promise<{ id: string }> };

const UpdateShortlistSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  // recalculate=true → re-aplica perfil, actualiza snapshot_score/rank dos jogadores
  recalculate: z.boolean().optional(),
});

// ── GET /api/shortlists/[id] ─────────────────────────────────────────────
// Devolve a shortlist + jogadores com dados completos + snapshot scores
export async function GET(_: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Shortlist (filtra por owner — só vês as tuas)
  const { data: shortlist, error: slErr } = await supabase
    .from('shortlists')
    .select('id, name, pool_id, profile_id, created_at')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (slErr) return NextResponse.json({ error: slErr.message }, { status: 500 });
  if (!shortlist) return NextResponse.json({ error: 'Shortlist não encontrada.' }, { status: 404 });

  // Pool
  const { data: pool } = shortlist.pool_id
    ? await supabase.from('pools').select('id, name, season, competition').eq('id', shortlist.pool_id).maybeSingle()
    : { data: null };

  // Perfil (nome + filtros para mostrar contexto)
  const { data: profile } = shortlist.profile_id
    ? await supabase
        .from('scouting_profiles')
        .select('id, name, description, filters, weights, tags')
        .eq('id', shortlist.profile_id)
        .maybeSingle()
    : { data: null };

  // Jogadores na shortlist
  const { data: spRows, error: spErr } = await supabase
    .from('shortlist_players')
    .select('player_id, added_at, snapshot_score, snapshot_rank, shortlist_note')
    .eq('shortlist_id', id)
    .order('snapshot_rank', { ascending: true, nullsFirst: false });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });

  const playerIds = (spRows ?? []).map((r) => r.player_id);

  // Detalhes dos jogadores
  let players: Array<{
    id: string;
    name: string;
    current_team: string | null;
    position_primary: string | null;
    age: number | null;
    minutes_played: number | null;
    contract_until: string | null;
    market_value_eur: number | null;
  }> = [];

  if (playerIds.length > 0) {
    const { data: pData, error: pErr } = await supabase
      .from('players')
      .select('id, name, current_team, position_primary, age, minutes_played, contract_until, market_value_eur')
      .in('id', playerIds);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    players = pData ?? [];
  }

  // Notas globais por player
  const { data: notes } = playerIds.length > 0
    ? await supabase
        .from('player_notes')
        .select('player_id, note, status, contact_info, updated_at')
        .in('player_id', playerIds)
    : { data: [] as Array<{ player_id: string; note: string | null; status: string | null; contact_info: unknown; updated_at: string | null }> };

  const notesByPlayer = new Map<string, { note: string | null; status: string | null; contact_info: unknown; updated_at: string | null }>();
  for (const n of notes ?? []) notesByPlayer.set(n.player_id, n);

  // Combinar tudo, mantendo ordem do snapshot_rank
  const playerById = new Map(players.map((p) => [p.id, p]));
  const items = (spRows ?? []).map((sp) => {
    const p = playerById.get(sp.player_id);
    const note = notesByPlayer.get(sp.player_id);
    return {
      player: p ?? null,
      added_at: sp.added_at,
      snapshot_score: sp.snapshot_score,
      snapshot_rank: sp.snapshot_rank,
      shortlist_note: sp.shortlist_note,
      note: note?.note ?? null,
      status: note?.status ?? null,
      contact_info: note?.contact_info ?? null,
      note_updated_at: note?.updated_at ?? null,
    };
  });

  return NextResponse.json({
    shortlist,
    pool,
    profile,
    items,
  });
}

// ── PUT /api/shortlists/[id] ─────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof UpdateShortlistSchema>;
  try {
    body = UpdateShortlistSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Rename (verifica owner)
  if (body.name) {
    const { error } = await supabase
      .from('shortlists')
      .update({ name: body.name })
      .eq('id', id)
      .eq('owner_id', user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Recalculate: re-aplica perfil ao pool e actualiza snapshot scores/ranks
  if (body.recalculate) {
    const { data: shortlist } = await supabase
      .from('shortlists')
      .select('pool_id, profile_id')
      .eq('id', id)
      .eq('owner_id', user.id)
      .maybeSingle();
    if (!shortlist?.pool_id || !shortlist.profile_id) {
      return NextResponse.json({ error: 'Shortlist sem pool ou perfil — não dá para recalcular.' }, { status: 400 });
    }

    const profileData = await loadProfile(supabase, shortlist.profile_id);
    if (!profileData) return NextResponse.json({ error: 'Perfil já não existe.' }, { status: 404 });

    const { data: spRows } = await supabase
      .from('shortlist_players')
      .select('player_id')
      .eq('shortlist_id', id);
    const playerIds = (spRows ?? []).map((r) => r.player_id);

    const result = await scoreSpecificPlayers({
      supabase,
      profile: profileData.profile,
      poolId: shortlist.pool_id,
      playerIds,
    });

    const entries = buildSnapshotEntries(result.ranked);

    // Update one by one (poucos registos, simples)
    await Promise.all(
      entries.map((e) =>
        supabase
          .from('shortlist_players')
          .update({ snapshot_score: e.snapshot_score, snapshot_rank: e.snapshot_rank })
          .eq('shortlist_id', id)
          .eq('player_id', e.player_id)
      )
    );

    return NextResponse.json({
      ok: true,
      recalculated: entries.length,
      missing: result.missing_ids,
    });
  }

  return NextResponse.json({ ok: true });
}

// ── DELETE /api/shortlists/[id] ──────────────────────────────────────────
export async function DELETE(_: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  // shortlist_players tem ON DELETE CASCADE, apaga sozinho. Filtra por owner.
  const { error } = await supabase
    .from('shortlists')
    .delete()
    .eq('id', id)
    .eq('owner_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}