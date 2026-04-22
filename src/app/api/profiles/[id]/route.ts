import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database, Json } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

type ProfileUpdate = Database['public']['Tables']['scouting_profiles']['Update'];

const FiltersSchema = z
  .object({
    positions: z.array(z.string()).optional(),
    min_minutes: z.number().int().nonnegative().optional(),
    min_age: z.number().int().nonnegative().optional(),
    max_age: z.number().int().positive().optional(),
    contract_until_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    on_loan: z.boolean().optional(),
  })
  .strict();

const WeightsSchema = z
  .object({
    entries: z.array(
      z
        .object({
          metric_code: z.string().min(1),
          weight: z.number().min(0).max(100),
          direction: z.enum(['higher', 'lower']).optional(),
        })
        .strict()
    ),
    peer_group_positions: z.array(z.string()).optional().default([]),
  })
  .strict();

const UpdateProfileSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    filters: FiltersSchema.optional(),
    weights: WeightsSchema.optional(),
    tags: z.array(z.string()).max(20).nullable().optional(),
  })
  .strict();

type Params = { params: Promise<{ id: string }> };

// ── GET /api/profiles/[id] ───────────────────────────────────────────────
export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('scouting_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });
  return NextResponse.json({ profile: data });
}

// ── PUT /api/profiles/[id] ───────────────────────────────────────────────
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof UpdateProfileSchema>;
  try {
    body = UpdateProfileSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  if (body.weights) {
    const sum = body.weights.entries.reduce((s, e) => s + e.weight, 0);
    if (Math.abs(sum - 100) > 0.5) {
      return NextResponse.json(
        { error: `Pesos somam ${sum.toFixed(2)} em vez de 100.` },
        { status: 400 }
      );
    }
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const update: ProfileUpdate = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.filters !== undefined) update.filters = body.filters as unknown as Json;
  if (body.weights !== undefined) update.weights = body.weights as unknown as Json;
  if (body.tags !== undefined) update.tags = body.tags;

  const { data, error } = await supabase
    .from('scouting_profiles')
    .update(update)
    .eq('id', id)
    .select('id, name')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });
  return NextResponse.json({ ok: true, profile: data });
}

// ── DELETE /api/profiles/[id] ────────────────────────────────────────────
export async function DELETE(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { error } = await supabase.from('scouting_profiles').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}