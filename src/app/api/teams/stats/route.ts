import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/supabase/server';
import {
  GROUP_LABELS,
  TEAM_METRICS,
  aggregateTeams,
  matchTeamName,
  rankIn,
  teamGroups,
  type MetricGroup,
  type TeamAggregate,
  type TeamGameRow,
} from '@/lib/team-stats/metrics';

export const runtime = 'nodejs';

/**
 * GET /api/teams/stats?pool=&team=[&vs=][&scope=serie|pool]
 *
 * Estatística de uma equipa a partir dos ficheiros "Team Stats": médias por
 * jogo, lugar e média entre as equipas com que se compara. `vs` junta uma
 * segunda equipa, com os mesmos números, para o comparativo.
 *
 * O conjunto de comparação é a série (as equipas ligadas por jogos entre si)
 * ou, com scope=pool, todas as equipas da pool.
 *
 * Sem dados para a pool ou para a equipa responde { available: false }.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const sp = req.nextUrl.searchParams;
  const poolId = (sp.get('pool') ?? '').trim();
  const teamParam = (sp.get('team') ?? '').trim();
  const vsParam = (sp.get('vs') ?? '').trim();
  const scope = sp.get('scope') === 'pool' ? 'pool' : 'serie';
  if (!poolId || !teamParam) return NextResponse.json({ error: 'Faltam a pool e a equipa.' }, { status: 400 });

  // Leitura paginada, com ordem estável.
  const rows: TeamGameRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('team_match_stats')
      .select('team, opponent, match_date, duration, stats')
      .eq('pool_id', poolId)
      .order('match_date')
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    rows.push(...(data as TeamGameRow[]));
    if (data.length < PAGE) break;
  }
  if (rows.length === 0) return NextResponse.json({ available: false, reason: 'pool' });

  const all = aggregateTeams(rows);
  const names = [...all.keys()];
  const team = matchTeamName(teamParam, names);
  if (!team) return NextResponse.json({ available: false, reason: 'team' });

  const groups = teamGroups(rows).filter((g) => g.some((t) => all.has(t)));
  const serie = (groups.find((g) => g.includes(team)) ?? [team]).filter((t) => all.has(t));
  const setNames = scope === 'pool' ? names : serie;
  const set = setNames.map((t) => all.get(t) as TeamAggregate);

  const { data: meta } = await supabase.from('team_stats_meta').select('round_label').eq('pool_id', poolId).maybeSingle();
  const lastDate = set.reduce<string | null>((acc, a) => (a.last_date && (!acc || a.last_date > acc) ? a.last_date : acc), null);

  const describe = (name: string) => {
    const agg = all.get(name) as TeamAggregate;
    return {
      team: name,
      games: agg.games,
      level: {
        xg: rankIn(name, (a) => a.values.xg, set),
        xg_against: rankIn(name, (a) => a.values.xg_against, set, true),
        xg_diff: rankIn(name, (a) => a.xg_diff, set),
      },
      metrics: Object.fromEntries(
        TEAM_METRICS.map((m) => [m.code, rankIn(name, (a) => a.values[m.code], set, m.lower_first)])
      ),
    };
  };

  const vs = vsParam ? matchTeamName(vsParam, setNames) : null;

  return NextResponse.json({
    available: true,
    scope,
    /** Há mais de uma série na pool: faz sentido oferecer "Campeonato". */
    has_series: groups.length > 1,
    teams: [...setNames].sort((a, b) => a.localeCompare(b, 'pt')),
    updated: { round_label: (meta as { round_label?: string | null } | null)?.round_label ?? null, last_date: lastDate },
    groups: (Object.keys(GROUP_LABELS) as MetricGroup[]).map((g) => ({ key: g, label: GROUP_LABELS[g] })),
    metrics: TEAM_METRICS.map((m) => ({
      code: m.code,
      label: m.label,
      short: m.short ?? m.label,
      group: m.group,
      chart: m.chart,
      lower_first: Boolean(m.lower_first),
      format: m.format,
    })),
    team: describe(team),
    vs: vs && vs !== team ? describe(vs) : null,
  });
}
