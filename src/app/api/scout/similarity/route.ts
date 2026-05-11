import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';
import { runSimilarityQuery } from '@/lib/similarity/runner';
import type { SimilarityQuery } from '@/lib/similarity/similarity';

export const runtime = 'nodejs';
export const maxDuration = 30;

const LensSchema = z.union([
  z.object({ mode: z.literal('full') }),
  z.object({ mode: z.literal('profile'), profile_id: z.string().uuid() }),
  z.object({
    mode: z.literal('custom'),
    weights: z.record(z.string(), z.number().nonnegative()),
  }),
]);

const BodySchema = z.object({
  anchor: z.object({
    pool_id: z.string().uuid(),
    player_id: z.string().uuid(),
  }),
  target_pools: z.array(z.string().uuid()).min(1).max(8),
  positions: z.array(z.string()).min(1).max(30),
  min_minutes: z.number().int().nonnegative().default(600),
  age_range: z.tuple([z.number().int(), z.number().int()]).optional(),
  lens: LensSchema,
});

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Input inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  try {
    const result = await runSimilarityQuery(supabase, body as SimilarityQuery);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Falha: ${(err as Error).message}` },
      { status: 500 }
    );
  }
}
