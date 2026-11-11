import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';
import { recalculateProfileScores } from '@/lib/scouting/recalculate-scores';
import { formatPoolName } from '@/lib/pools';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/admin/recalculate-scores
 *
 * Body: { pool_id: <uuid> }  ou  { all: true } para todas as pools.
 *       Opcionalmente { profile_ids: [<uuid>] } para recalcular só alguns perfis.
 *
 * Preenche a tabela profile_scores. O import já faz isto sozinho no fim; este
 * endpoint existe para quando se editam perfis ou se quer forçar o recálculo.
 *
 * ATENÇÃO: correr com { all: true } sobre todas as pools demora bem mais que os
 * 10 segundos das funções Netlify — em produção vai dar 504 a meio, deixando
 * parte das pools por calcular. Para um recálculo geral, correr em localhost.
 * Uma pool de cada vez passa bem em produção.
 *
 * Restrito a admin (verifica allowed_users.is_admin).
 */
const BodySchema = z.union([
  z.object({ pool_id: z.string().uuid(), profile_ids: z.array(z.string().uuid()).optional() }),
  z.object({ all: z.literal(true), profile_ids: z.array(z.string().uuid()).optional() }),
]);

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

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

  const options = body.profile_ids ? { profileIds: body.profile_ids } : undefined;

  if ('pool_id' in body) {
    try {
      const result = await recalculateProfileScores(supabase, body.pool_id, options);
      return NextResponse.json({ ok: true, results: [result] });
    } catch (err) {
      return NextResponse.json({ error: `Falha: ${(err as Error).message}` }, { status: 500 });
    }
  }

  const { data: pools, error: poolsErr } = await supabase.from('pools').select('id, name, season');
  if (poolsErr) return NextResponse.json({ error: poolsErr.message }, { status: 500 });

  const results = [];
  const errors: Array<{ pool_id: string; error: string }> = [];
  for (const p of (pools ?? []) as Array<{ id: string; name: string; season: string }>) {
    try {
      const r = await recalculateProfileScores(supabase, p.id, options);
      results.push({ ...r, name: formatPoolName(p.name, p.season) });
    } catch (err) {
      errors.push({ pool_id: p.id, error: (err as Error).message });
    }
  }

  return NextResponse.json({ ok: errors.length === 0, results, errors });
}
