import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const AddPlayerSchema = z.object({
  player_id: z.string().uuid(),
});

// ── POST /api/shortlists/[id]/players — adicionar um player ──────────────
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof AddPlayerSchema>;
  try {
    body = AddPlayerSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Verificar que a shortlist pertence ao user
  const { data: sl } = await supabase
    .from('shortlists')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!sl) return NextResponse.json({ error: 'Shortlist não encontrada.' }, { status: 404 });

  // Insert ignorando duplicado (PK composta evita repetidos)
  const { error } = await supabase
    .from('shortlist_players')
    .insert({ shortlist_id: id, player_id: body.player_id });

  if (error) {
    // Se já existir é uma 'feature', não erro real
    if (error.code === '23505') {
      return NextResponse.json({ ok: true, already_in: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// ── DELETE /api/shortlists/[id]/players?player_id=xxx ────────────────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const playerId = req.nextUrl.searchParams.get('player_id');
  if (!playerId) return NextResponse.json({ error: 'player_id em query string obrigatório.' }, { status: 400 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Verificar que a shortlist pertence ao user
  const { data: sl } = await supabase
    .from('shortlists')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!sl) return NextResponse.json({ error: 'Shortlist não encontrada.' }, { status: 404 });

  const { error } = await supabase
    .from('shortlist_players')
    .delete()
    .eq('shortlist_id', id)
    .eq('player_id', playerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}