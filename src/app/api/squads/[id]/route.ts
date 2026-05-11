import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getFormation } from '@/lib/best-eleven/formations';
import { getAuthUser } from '@/lib/supabase/server';
import { formatPoolName } from '@/lib/pools';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const FORMATION_IDS = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3'] as const;

const UpdateSquadSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    formation: z.enum(FORMATION_IDS).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => b.name !== undefined || b.formation !== undefined || b.notes !== undefined, {
    message: 'Nada para actualizar.',
  });

// ── GET /api/squads/[id] ─────────────────────────────────────────────────
export async function GET(_: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: squad, error: sqErr } = await supabase
    .from('squads')
    .select('id, name, formation, notes, created_at, updated_at')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (sqErr) return NextResponse.json({ error: sqErr.message }, { status: 500 });
  if (!squad) return NextResponse.json({ error: 'Equipa não encontrada.' }, { status: 404 });

  const { data: spRows, error: spErr } = await supabase
    .from('squad_players')
    .select('player_id, slot, is_starter, squad_note, added_at')
    .eq('squad_id', id);
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });

  const playerIds = (spRows ?? []).map((r) => r.player_id);

  type PlayerRow = {
    id: string;
    name: string;
    current_team: string | null;
    team_in_period: string | null;
    position_primary: string | null;
    age: number | null;
    minutes_played: number | null;
    pool_id: string;
  };

  let players: PlayerRow[] = [];
  if (playerIds.length > 0) {
    const { data: pData, error: pErr } = await supabase
      .from('players')
      .select('id, name, current_team, team_in_period, position_primary, age, minutes_played, pool_id')
      .in('id', playerIds);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    players = (pData ?? []) as PlayerRow[];
  }

  const poolIds = Array.from(new Set(players.map((p) => p.pool_id))).filter(Boolean);
  const poolNameById = new Map<string, string>();
  if (poolIds.length > 0) {
    const { data: pools } = await supabase
      .from('pools')
      .select('id, name, season')
      .in('id', poolIds);
    for (const pool of pools ?? []) {
      poolNameById.set(pool.id, formatPoolName(pool.name, pool.season));
    }
  }

  const playerById = new Map(players.map((p) => [p.id, p]));
  const items = (spRows ?? []).map((sp) => {
    const p = playerById.get(sp.player_id);
    return {
      player_id: sp.player_id,
      name: p?.name ?? null,
      current_team: p?.current_team ?? null,
      team_in_period: p?.team_in_period ?? null,
      position_primary: p?.position_primary ?? null,
      age: p?.age ?? null,
      minutes_played: p?.minutes_played ?? null,
      pool_id: p?.pool_id ?? null,
      pool_name: p?.pool_id ? poolNameById.get(p.pool_id) ?? null : null,
      slot: sp.slot,
      is_starter: sp.is_starter,
      squad_note: sp.squad_note,
      added_at: sp.added_at,
    };
  });

  return NextResponse.json({ ...squad, players: items });
}

// ── PATCH /api/squads/[id] ───────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof UpdateSquadSchema>;
  try {
    body = UpdateSquadSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Input inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: existing, error: exErr } = await supabase
    .from('squads')
    .select('id, formation')
    .eq('id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Equipa não encontrada.' }, { status: 404 });

  const update: Record<string, string | null> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.formation !== undefined) update.formation = body.formation;
  if (body.notes !== undefined) update.notes = body.notes;

  const { data: updated, error: upErr } = await supabase
    .from('squads')
    .update(update)
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('id, name, formation, notes, updated_at')
    .single();
  if (upErr || !updated) {
    return NextResponse.json(
      { error: `Falha a actualizar: ${upErr?.message ?? 'desconhecido'}` },
      { status: 500 }
    );
  }

  let slotsInvalidated = 0;
  if (body.formation !== undefined && body.formation !== existing.formation) {
    const newFormation = getFormation(body.formation);
    const validSlotIds = new Set((newFormation?.slots ?? []).map((s) => s.id));

    const { data: assigned } = await supabase
      .from('squad_players')
      .select('player_id, slot')
      .eq('squad_id', id)
      .not('slot', 'is', null);

    const toInvalidate = (assigned ?? []).filter((r) => r.slot && !validSlotIds.has(r.slot));
    if (toInvalidate.length > 0) {
      const playerIds = toInvalidate.map((r) => r.player_id);
      const { error: invErr } = await supabase
        .from('squad_players')
        .update({ slot: null, is_starter: false })
        .eq('squad_id', id)
        .in('player_id', playerIds);
      if (invErr) {
        return NextResponse.json(
          { error: `Falha a invalidar slots: ${invErr.message}` },
          { status: 500 }
        );
      }
      slotsInvalidated = toInvalidate.length;
    }
  }

  return NextResponse.json({ ...updated, slots_invalidated: slotsInvalidated });
}

// ── DELETE /api/squads/[id] ──────────────────────────────────────────────
export async function DELETE(_: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await supabase
    .from('squads')
    .delete()
    .eq('id', id)
    .eq('owner_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
