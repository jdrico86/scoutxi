import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const FAVORITES_NAME = 'Favoritos';

const AddFavSchema = z.object({
  player_id: z.string().uuid(),
});

/**
 * Garante que existe shortlist "Favoritos" para o user dado e devolve o ID.
 * Cada user tem a sua própria shortlist Favoritos (owner_id = user.id).
 */
async function ensureFavoritesShortlist(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  const { data: existing } = await supabase
    .from('shortlists')
    .select('id')
    .eq('name', FAVORITES_NAME)
    .eq('owner_id', userId)
    .is('pool_id', null)
    .is('profile_id', null)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('shortlists')
    .insert({
      name: FAVORITES_NAME,
      pool_id: null,
      profile_id: null,
      owner_id: userId,
    })
    .select('id')
    .single();

  if (error || !created) throw new Error(`Falha a criar shortlist Favoritos: ${error?.message}`);
  return created.id;
}

// GET /api/favorites — devolve { shortlist_id, player_ids } do user actual
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const shortlistId = await ensureFavoritesShortlist(supabase, user.id);

    const { data: rows, error } = await supabase
      .from('shortlist_players')
      .select('player_id')
      .eq('shortlist_id', shortlistId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      shortlist_id: shortlistId,
      player_ids: (rows ?? []).map((r) => r.player_id),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/favorites { player_id }
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof AddFavSchema>;
  try {
    body = AddFavSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const shortlistId = await ensureFavoritesShortlist(supabase, user.id);

    const { error } = await supabase
      .from('shortlist_players')
      .insert({ shortlist_id: shortlistId, player_id: body.player_id });

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ ok: true, already_in: true });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, shortlist_id: shortlistId });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/favorites?player_id=xxx
export async function DELETE(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const playerId = req.nextUrl.searchParams.get('player_id');
  if (!playerId) return NextResponse.json({ error: 'player_id obrigatório.' }, { status: 400 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const shortlistId = await ensureFavoritesShortlist(supabase, user.id);

    const { error } = await supabase
      .from('shortlist_players')
      .delete()
      .eq('shortlist_id', shortlistId)
      .eq('player_id', playerId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}