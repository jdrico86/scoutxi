import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const VALID_STATUSES = ['tracking', 'scouted', 'agent_contacted', 'in_negotiation', 'recruited', 'rejected'] as const;

const NoteSchema = z.object({
  status: z.enum(VALID_STATUSES).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  contact_info: z.unknown().optional(),
});

// ── GET /api/players/[id]/note ───────────────────────────────────────────
// Devolve só a nota do user actual.
export async function GET(_: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('player_notes')
    .select('*')
    .eq('player_id', id)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data ?? null });
}

// ── PUT /api/players/[id]/note ───────────────────────────────────────────
// Upsert da nota do user actual.
export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof NoteSchema>;
  try {
    body = NoteSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Verificar se já existe nota do user para este jogador
  const { data: existing } = await supabase
    .from('player_notes')
    .select('id')
    .eq('player_id', id)
    .eq('owner_id', user.id)
    .maybeSingle();

  const payload = {
    player_id: id,
    owner_id: user.id,
    status: body.status ?? null,
    note: body.note ?? null,
    contact_info: body.contact_info ?? null,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from('player_notes')
      .update(payload)
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'updated' });
  } else {
    const { error } = await supabase.from('player_notes').insert(payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'created' }, { status: 201 });
  }
}