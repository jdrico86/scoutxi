import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getFormation } from '@/lib/best-eleven/formations';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string; player_id: string }> };

const UpdatePlayerSchema = z
  .object({
    slot: z.string().min(1).max(20).nullable().optional(),
    is_starter: z.boolean().optional(),
    squad_note: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (b) => b.slot !== undefined || b.is_starter !== undefined || b.squad_note !== undefined,
    { message: 'Nada para actualizar.' }
  );

// ── PATCH /api/squads/[id]/players/[player_id] ───────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id, player_id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof UpdatePlayerSchema>;
  try {
    body = UpdatePlayerSchema.parse(await req.json());
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

  // Confirmar que o jogador está mesmo na squad
  const { data: existing } = await supabase
    .from('squad_players')
    .select('player_id, slot, is_starter, squad_note')
    .eq('squad_id', id)
    .eq('player_id', player_id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: 'Jogador não está nesta equipa.' }, { status: 404 });
  }

  let displacedPlayerId: string | null = null;
  const update: Record<string, string | boolean | null> = {};

  if (body.slot !== undefined) {
    if (body.slot === null) {
      update.slot = null;
      // Slot nulo → banco; só forçamos is_starter=false se o caller não passar explicitamente
      if (body.is_starter === undefined) update.is_starter = false;
    } else {
      const formation = getFormation(squad.formation);
      const validSlotIds = new Set((formation?.slots ?? []).map((s) => s.id));
      if (!validSlotIds.has(body.slot)) {
        return NextResponse.json(
          { error: `Slot '${body.slot}' inválido para formação ${squad.formation}.` },
          { status: 400 }
        );
      }
      update.slot = body.slot;
      // Atribuir slot promove a titular por defeito; um is_starter explícito override.
      if (body.is_starter === undefined) update.is_starter = true;

      // Deslocar outro jogador que estivesse no mesmo slot
      const { data: others } = await supabase
        .from('squad_players')
        .select('player_id')
        .eq('squad_id', id)
        .eq('slot', body.slot)
        .neq('player_id', player_id);
      if (others && others.length > 0) {
        displacedPlayerId = others[0].player_id;
        await supabase
          .from('squad_players')
          .update({ slot: null, is_starter: false })
          .eq('squad_id', id)
          .eq('player_id', displacedPlayerId);
      }
    }
  }

  if (body.is_starter !== undefined) update.is_starter = body.is_starter;
  if (body.squad_note !== undefined) update.squad_note = body.squad_note;

  const { data: updated, error: upErr } = await supabase
    .from('squad_players')
    .update(update)
    .eq('squad_id', id)
    .eq('player_id', player_id)
    .select('player_id, slot, is_starter, squad_note')
    .single();
  if (upErr || !updated) {
    return NextResponse.json(
      { error: `Falha a actualizar: ${upErr?.message ?? 'desconhecido'}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    player_id: updated.player_id,
    slot: updated.slot,
    is_starter: updated.is_starter,
    squad_note: updated.squad_note,
    displaced_player_id: displacedPlayerId,
  });
}

// ── DELETE /api/squads/[id]/players/[player_id] ──────────────────────────
export async function DELETE(_: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id, player_id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: squad } = await supabase
    .from('squads')
    .select('id')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!squad) return NextResponse.json({ error: 'Equipa não encontrada.' }, { status: 404 });

  const { error } = await supabase
    .from('squad_players')
    .delete()
    .eq('squad_id', id)
    .eq('player_id', player_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
