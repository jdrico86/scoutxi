import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';
import { recalculatePoolPercentiles } from '@/lib/similarity/recalculate';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/recalculate-percentiles
 *
 * Body: { pool_id: <uuid> }  ou  { all: true } para todas as pools.
 *
 * Recalcula a tabela player_percentiles para uma pool específica ou todas.
 * Restrito a admin (verifica allowed_users.is_admin).
 */
const BodySchema = z.union([
  z.object({ pool_id: z.string().uuid() }),
  z.object({ all: z.literal(true) }),
]);

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Verificar admin
  const { data: adminCheck } = await supabase
    .from('allowed_users')
    .select('is_admin')
    .eq('email', user.email ?? '')
    .maybeSingle();
  const isAdmin = (adminCheck as { is_admin?: boolean } | null)?.is_admin ?? false;
  if (!isAdmin) return NextResponse.json({ error: 'Apenas admin pode recalcular.' }, { status: 403 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  if ('pool_id' in body) {
    try {
      const result = await recalculatePoolPercentiles(supabase, body.pool_id);
      return NextResponse.json({ ok: true, results: [result] });
    } catch (err) {
      return NextResponse.json({ error: `Falha: ${(err as Error).message}` }, { status: 500 });
    }
  }

  // Todas as pools
  const { data: pools, error: poolsErr } = await supabase.from('pools').select('id, name, season');
  if (poolsErr) return NextResponse.json({ error: poolsErr.message }, { status: 500 });

  const results = [];
  const errors: Array<{ pool_id: string; error: string }> = [];
  for (const p of (pools ?? []) as Array<{ id: string; name: string; season: string }>) {
    try {
      const r = await recalculatePoolPercentiles(supabase, p.id);
      results.push({ ...r, name: `${p.name} ${p.season}` });
    } catch (err) {
      errors.push({ pool_id: p.id, error: (err as Error).message });
    }
  }

  return NextResponse.json({ ok: errors.length === 0, results, errors });
}
