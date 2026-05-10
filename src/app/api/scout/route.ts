import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';
import { loadPoolData } from '@/lib/scouting/db-helpers';
import { runScoutQuery, type ScoutQueryInput } from '@/lib/scout/query-builder';

export const runtime = 'nodejs';
export const maxDuration = 30;

// ── Schemas ──────────────────────────────────────────────────────────────
const MetricFilterSchema = z
  .object({
    metric_code: z.string().min(1),
    operator: z.enum(['gte', 'lte', 'between', 'top_percentile']),
    value: z.number().optional(),
    value_range: z.tuple([z.number(), z.number()]).optional(),
    percentile: z.number().min(0).max(100).optional(),
    mode: z.enum(['absolute', 'percentile']).optional(),
  })
  .refine(
    (d) => {
      if (d.operator === 'gte' || d.operator === 'lte') return d.value != null;
      if (d.operator === 'between')
        return d.value_range != null && d.value_range[0] <= d.value_range[1];
      if (d.operator === 'top_percentile') return d.percentile != null;
      return true;
    },
    { message: 'Operador requer parâmetro correspondente.' }
  );

const ScoutBodySchema = z.object({
  pool_id: z.string().uuid(),
  positions: z.array(z.string()).optional(),
  general_filters: z
    .object({
      min_age: z.number().int().nonnegative().optional(),
      max_age: z.number().int().positive().optional(),
      min_minutes: z.number().int().nonnegative().optional(),
      on_loan: z.boolean().optional(),
    })
    .optional(),
  metric_filters: z.array(MetricFilterSchema).max(20).optional(),
  sort_by: z
    .object({
      field: z.string().min(1),
      direction: z.enum(['asc', 'desc']),
    })
    .optional(),
  preview: z.boolean().optional(),
});

// ── POST /api/scout ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof ScoutBodySchema>;
  try {
    body = ScoutBodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Input inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Carregar dados da pool (paginado em loadPoolData).
  const { players, stats } = await loadPoolData(supabase, body.pool_id);

  // Correr query (lógica pura).
  const query: ScoutQueryInput = {
    positions: body.positions,
    general_filters: body.general_filters,
    metric_filters: body.metric_filters,
    sort_by: body.sort_by,
  };
  const result = runScoutQuery({
    players,
    stats,
    query,
    preview: body.preview ?? false,
  });

  // ── Modo preview: devolver só count + thresholds + warnings ────────
  if (body.preview) {
    return NextResponse.json({
      count: result.count,
      peer_group_size: result.peer_group_size,
      warnings: result.warnings,
      metric_thresholds: result.metric_thresholds,
    });
  }

  // ── Enriquecer matched com team_in_period + pool_name ──────────────
  const matchedIds = (result.players ?? []).map((p) => p.id);

  const teamInPeriodById = new Map<string, string | null>();
  if (matchedIds.length > 0) {
    // ≤1000 IDs num pool → uma query chega. Se algum dia houver matches >1000
    // (pouco provável após filtros), paginar aqui.
    const { data: tip } = await supabase
      .from('players')
      .select('id, team_in_period')
      .in('id', matchedIds);
    for (const row of (tip ?? []) as Array<{ id: string; team_in_period: string | null }>) {
      teamInPeriodById.set(row.id, row.team_in_period);
    }
  }

  const { data: poolData } = await supabase
    .from('pools')
    .select('name, season')
    .eq('id', body.pool_id)
    .maybeSingle();
  const poolName = poolData ? `${poolData.name} ${poolData.season}` : '';

  const enriched = (result.players ?? []).map((p) => ({
    ...p,
    team_in_period: teamInPeriodById.get(p.id) ?? null,
    pool_name: poolName,
  }));

  return NextResponse.json({
    count: result.count,
    peer_group_size: result.peer_group_size,
    warnings: result.warnings,
    metric_thresholds: result.metric_thresholds,
    players: enriched,
  });
}
