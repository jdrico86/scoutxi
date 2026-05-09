import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getFormation } from '@/lib/best-eleven/formations';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const AddPlayerSchema = z.object({
  player_id: z.string().uuid(),
  slot: z.string().min(1).max(20).optional(),
  squad_note: z.string().max(2000).optional(),
});

// ── POST /api/squads/[id]/players ────────────────────────────────────────
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
    return NextResponse.json(
      { error: `Input inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: squad, error: sqErr } = await supabase
    .from('squads')
    .select('id, formation')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (sqErr) return NextResponse.json({ error: sqErr.message }, { status: 500 });
  if (!squad) return NextResponse.json({ error: 'Equipa não encontrada.' }, { status: 404 });

  if (body.slot) {
    const formation = getFormation(squad.formation);
    const validSlotIds = new Set((formation?.slots ?? []).map((s) => s.id));
    if (!validSlotIds.has(body.slot)) {
      return NextResponse.json(
        { error: `Slot '${body.slot}' inválido para formação ${squad.formation}.` },
        { status: 400 }
      );
    }

    // Deslocar qualquer jogador que esteja actualmente neste slot
    await supabase
      .from('squad_players')
      .update({ slot: null, is_starter: false })
      .eq('squad_id', id)
      .eq('slot', body.slot);
  }

  const { data: inserted, error: insErr } = await supabase
    .from('squad_players')
    .insert({
      squad_id: id,
      player_id: body.player_id,
      slot: body.slot ?? null,
      is_starter: body.slot ? true : false,
      squad_note: body.squad_note ?? null,
    })
    .select('player_id, slot, is_starter, added_at')
    .single();

  if (insErr) {
    if (insErr.code === '23505') {
      return NextResponse.json(
        { error: 'Jogador já está nesta equipa.' },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json(inserted, { status: 201 });
}
