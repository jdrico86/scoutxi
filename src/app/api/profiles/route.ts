import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database, Json } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

// ── Schemas de validação ─────────────────────────────────────────────────
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

const WeightEntrySchema = z
  .object({
    metric_code: z.string().min(1),
    weight: z.number().min(0).max(100),
    direction: z.enum(['higher', 'lower']).optional(),
  })
  .strict();

const WeightsSchema = z
  .object({
    entries: z.array(WeightEntrySchema).min(1),
    peer_group_positions: z.array(z.string()).optional().default([]),
  })
  .strict();

const CreateProfileSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  filters: FiltersSchema,
  weights: WeightsSchema,
  tags: z.array(z.string()).max(20).optional(),
});

/** Validação extra: pesos somam ~100 (tolerância 0.5). */
function validateWeightSum(entries: Array<{ weight: number }>): string | null {
  const sum = entries.reduce((s, e) => s + e.weight, 0);
  if (Math.abs(sum - 100) > 0.5) {
    return `Pesos somam ${sum.toFixed(2)} em vez de 100.`;
  }
  return null;
}

// ── GET /api/profiles ────────────────────────────────────────────────────
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from('scouting_profiles')
    .select('id, name, description, tags, created_at, updated_at, filters, weights')
    .order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ profiles: data ?? [] });
}

// ── POST /api/profiles ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  }

  let body: z.infer<typeof CreateProfileSchema>;
  try {
    body = CreateProfileSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const sumError = validateWeightSum(body.weights.entries);
  if (sumError) return NextResponse.json({ error: sumError }, { status: 400 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from('scouting_profiles')
    .insert({
      name: body.name,
      description: body.description ?? null,
      filters: body.filters as unknown as Json,
      weights: body.weights as unknown as Json,
      tags: body.tags ?? null,
    })
    .select('id, name')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, profile: data }, { status: 201 });
}