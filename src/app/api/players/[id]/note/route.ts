import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database, Json } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

const VALID_STATUSES = ['tracking', 'scouted', 'agent_contacted', 'in_negotiation', 'recruited', 'rejected'] as const;

const NoteSchema = z.object({
  status: z.enum(VALID_STATUSES).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  contact_info: z.unknown().optional(), // free-form JSON
});

// ── GET /api/players/[id]/note ───────────────────────────────────────────
export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('player_notes')
    .select('*')
    .eq('player_id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data ?? null });
}

// ── PUT /api/players/[id]/note ───────────────────────────────────────────
// Upsert: se já existe, actualiza; se não, cria.
export async function PUT(req: NextRequest, { params }: Params) {
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

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Verificar se já existe
  const { data: existing } = await supabase
    .from('player_notes')
    .select('id')
    .eq('player_id', id)
    .maybeSingle();

  const payload = {
    player_id: id,
    status: body.status ?? null,
    note: body.note ?? null,
    contact_info: (body.contact_info ?? null) as Json | null,
  };

  if (existing?.id) {
    const { error } = await supabase.from('player_notes').update(payload).eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'updated' });
  } else {
    const { error } = await supabase.from('player_notes').insert(payload);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'created' }, { status: 201 });
  }
}