import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';
import { getMetricsForPosition, POSITION_METRICS, SUPPORTED_POSITIONS } from '@/lib/similarity/position-metrics';

export const runtime = 'nodejs';
export const maxDuration = 15;

/**
 * GET /api/scout/similarity-detail?a=<player_id>&b=<player_id>
 *
 * Devolve detalhe lado-a-lado para drill-down comparativo:
 *   - Info de ambos os jogadores (nome, equipa, pool, posição, idade, min)
 *   - Para cada métrica do arquétipo do A: raw_value + percentile de ambos
 *   - delta_percentile = candidate.percentile - anchor.percentile
 *
 * A posição de avaliação:
 *   - Anchor: position_primary do A
 *   - Candidate: posição do B no mesmo arquétipo do A (primary se possível,
 *     senão primeira secondary que pertence ao arquétipo). Sem match → 404.
 *
 * Sem dependência da lens — o caller pode filtrar/agregar como quiser.
 */
const QuerySchema = z.object({
  a: z.string().uuid(),
  b: z.string().uuid(),
});

type PlayerInfo = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  positions_secondary: string[] | null;
  age: number | null;
  minutes_played: number | null;
  pool_id: string;
  pool_name: string | null;
};

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const parsed = QuerySchema.safeParse({
    a: req.nextUrl.searchParams.get('a'),
    b: req.nextUrl.searchParams.get('b'),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'a e b têm de ser UUIDs.' }, { status: 400 });
  }
  if (parsed.data.a === parsed.data.b) {
    return NextResponse.json({ error: 'a e b são o mesmo jogador.' }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── Carregar ambos os jogadores ──────────────────────────────────────
  const { data: playersData, error: pErr } = await supabase
    .from('players')
    .select(
      'id, name, current_team, team_in_period, position_primary, positions_secondary, age, minutes_played, pool_id'
    )
    .in('id', [parsed.data.a, parsed.data.b]);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const rows = (playersData ?? []) as Array<{
    id: string;
    name: string;
    current_team: string | null;
    team_in_period: string | null;
    position_primary: string | null;
    positions_secondary: string[] | null;
    age: number | null;
    minutes_played: number | null;
    pool_id: string;
  }>;

  const anchorRow = rows.find((r) => r.id === parsed.data.a);
  const candRow = rows.find((r) => r.id === parsed.data.b);
  if (!anchorRow || !candRow) {
    return NextResponse.json({ error: 'Um ou ambos os jogadores não existem.' }, { status: 404 });
  }
  if (!anchorRow.position_primary || !SUPPORTED_POSITIONS.has(anchorRow.position_primary)) {
    return NextResponse.json(
      { error: 'Âncora sem posição válida ou sem métricas configuradas.' },
      { status: 400 }
    );
  }

  const anchorArquetype = POSITION_METRICS[anchorRow.position_primary];
  const arquetypePositions = Object.keys(POSITION_METRICS).filter(
    (p) => POSITION_METRICS[p] === anchorArquetype
  );

  // Determinar posição do B no arquétipo da âncora
  const candPositions = [
    candRow.position_primary,
    ...(candRow.positions_secondary ?? []),
  ].filter((p): p is string => p != null);
  const candPosition = candPositions.find((p) => arquetypePositions.includes(p));
  if (!candPosition) {
    return NextResponse.json(
      {
        error: `Jogador B não joga em nenhuma posição do arquétipo de A (${arquetypePositions.join(', ')}).`,
      },
      { status: 400 }
    );
  }

  // ── Pool names ───────────────────────────────────────────────────────
  const poolIds = Array.from(new Set([anchorRow.pool_id, candRow.pool_id]));
  const { data: poolsData } = await supabase
    .from('pools')
    .select('id, name, season')
    .in('id', poolIds);
  const poolNameById = new Map<string, string>();
  for (const p of (poolsData ?? []) as Array<{ id: string; name: string; season: string }>) {
    poolNameById.set(p.id, `${p.name} ${p.season}`);
  }

  // ── Percentis dos dois ───────────────────────────────────────────────
  const { data: pctRows, error: pctErr } = await supabase
    .from('player_percentiles')
    .select('player_id, position, metric_code, raw_value, percentile')
    .or(
      `and(player_id.eq.${parsed.data.a},position.eq.${anchorRow.position_primary}),and(player_id.eq.${parsed.data.b},position.eq.${candPosition})`
    );
  if (pctErr) return NextResponse.json({ error: pctErr.message }, { status: 500 });

  const anchorByMetric = new Map<string, { raw_value: number | null; percentile: number }>();
  const candByMetric = new Map<string, { raw_value: number | null; percentile: number }>();
  for (const r of (pctRows ?? []) as Array<{
    player_id: string;
    position: string;
    metric_code: string;
    raw_value: number | null;
    percentile: number;
  }>) {
    if (r.player_id === parsed.data.a) {
      anchorByMetric.set(r.metric_code, { raw_value: r.raw_value, percentile: r.percentile });
    } else {
      candByMetric.set(r.metric_code, { raw_value: r.raw_value, percentile: r.percentile });
    }
  }

  if (anchorByMetric.size === 0) {
    return NextResponse.json(
      { error: 'Âncora sem percentis calculados. Pede admin para recalcular.' },
      { status: 400 }
    );
  }

  // ── Metric metadata (label_pt, category) ────────────────────────────
  const metricCodes = getMetricsForPosition(anchorRow.position_primary);
  const { data: metricsData } = await supabase
    .from('metrics')
    .select('code, label_pt, category, direction, unit')
    .in('code', metricCodes);
  const metricMeta = new Map<
    string,
    { label_pt: string; category: string; direction: string | null; unit: string | null }
  >();
  for (const m of (metricsData ?? []) as Array<{
    code: string;
    label_pt: string;
    category: string;
    direction: string | null;
    unit: string | null;
  }>) {
    metricMeta.set(m.code, {
      label_pt: m.label_pt,
      category: m.category,
      direction: m.direction,
      unit: m.unit,
    });
  }

  // ── Compor resposta ──────────────────────────────────────────────────
  const metrics = metricCodes.map((code) => {
    const a = anchorByMetric.get(code) ?? null;
    const b = candByMetric.get(code) ?? null;
    const meta = metricMeta.get(code);
    const delta =
      a != null && b != null ? Math.round((b.percentile - a.percentile) * 100) / 100 : null;
    return {
      metric_code: code,
      label_pt: meta?.label_pt ?? code,
      category: meta?.category ?? 'unknown',
      direction: meta?.direction ?? null,
      unit: meta?.unit ?? null,
      anchor: a,
      candidate: b,
      delta_percentile: delta,
    };
  });

  const anchor: PlayerInfo = {
    id: anchorRow.id,
    name: anchorRow.name,
    current_team: anchorRow.current_team,
    team_in_period: anchorRow.team_in_period,
    position_primary: anchorRow.position_primary,
    positions_secondary: anchorRow.positions_secondary,
    age: anchorRow.age,
    minutes_played: anchorRow.minutes_played,
    pool_id: anchorRow.pool_id,
    pool_name: poolNameById.get(anchorRow.pool_id) ?? null,
  };
  const candidate: PlayerInfo = {
    id: candRow.id,
    name: candRow.name,
    current_team: candRow.current_team,
    team_in_period: candRow.team_in_period,
    position_primary: candRow.position_primary,
    positions_secondary: candRow.positions_secondary,
    age: candRow.age,
    minutes_played: candRow.minutes_played,
    pool_id: candRow.pool_id,
    pool_name: poolNameById.get(candRow.pool_id) ?? null,
  };

  return NextResponse.json({
    anchor,
    candidate,
    arquetype_position_anchor: anchorRow.position_primary,
    arquetype_position_candidate: candPosition,
    metrics,
  });
}
