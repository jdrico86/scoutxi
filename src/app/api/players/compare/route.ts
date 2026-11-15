import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';
import { profileRowToProfile } from '@/lib/scouting/db-helpers';
import { matchesPositions, matchesPrimaryPosition } from '@/lib/scouting/positions';
import { scorePlayerInProfile } from '@/lib/scouting/score-player';
import { getMetricsForPosition, POSITION_METRICS, SUPPORTED_POSITIONS } from '@/lib/similarity/position-metrics';
import { competitionId, competitionLabel, formatPoolName } from '@/lib/pools';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/players/compare?a=<player_id>&b=<player_id>[&profile_id=<uuid>]
 *
 * A comparação entre dois jogadores, numa rota só (página `/comparar`). Duas
 * lentes:
 *
 *  - `profile` (vem `profile_id`): as métricas e os pesos de um perfil. Score e
 *    posição no ranking lidos de `profile_scores`; percentis por métrica
 *    calculados contra o peer group da pool de cada um (posição primária), com
 *    `scorePlayerInProfile` — os mesmos números da ficha e do ranking.
 *  - `position` (sem `profile_id`): as métricas fixas da posição do jogador A,
 *    com os percentis de `player_percentiles` (a régua da similaridade, que
 *    inclui quem joga lá por posição secundária).
 *
 * As duas réguas não são a mesma; a resposta diz qual foi usada.
 *
 * O perfil tem de ser de origem (sem dono) ou do utilizador. Cada percentil é
 * medido dentro da pool do próprio jogador: entre ligas diferentes não são
 * directamente comparáveis, e a resposta traz a competição de cada um para a
 * página o dizer.
 */
const QuerySchema = z.object({
  a: z.string().uuid(),
  b: z.string().uuid(),
  profile_id: z.string().uuid().nullish(),
});

type PlayerRow = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  positions_secondary: string[] | null;
  age: number | null;
  minutes_played: number | null;
  games_played: number | null;
  market_value_eur: number | null;
  contract_until: string | null;
  pool_id: string;
};

type PoolRow = {
  id: string;
  name: string;
  season: string;
  competition: string | null;
  country: string | null;
  tier: number | null;
  competition_key: string | null;
};

type Side = { raw_value: number | null; percentile: number } | null;

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const parsed = QuerySchema.safeParse({
    a: req.nextUrl.searchParams.get('a'),
    b: req.nextUrl.searchParams.get('b'),
    profile_id: req.nextUrl.searchParams.get('profile_id') || null,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Faltam os dois jogadores a comparar.' }, { status: 400 });
  }
  const { a: aId, b: bId } = parsed.data;
  const profileId = parsed.data.profile_id ?? null;
  if (aId === bId) {
    return NextResponse.json({ error: 'Escolhe dois jogadores diferentes.' }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── Jogadores e pools ────────────────────────────────────────────────
  const { data: playersData, error: pErr } = await supabase
    .from('players')
    .select(
      'id, name, current_team, team_in_period, position_primary, positions_secondary, age, minutes_played, games_played, market_value_eur, contract_until, pool_id'
    )
    .in('id', [aId, bId]);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  const rows = (playersData ?? []) as PlayerRow[];
  const rowA = rows.find((r) => r.id === aId);
  const rowB = rows.find((r) => r.id === bId);
  if (!rowA || !rowB) {
    return NextResponse.json({ error: 'Um ou ambos os jogadores não existem.' }, { status: 404 });
  }

  const { data: poolsData } = await supabase
    .from('pools')
    .select('id, name, season, competition, country, tier, competition_key')
    .in('id', Array.from(new Set([rowA.pool_id, rowB.pool_id])));
  const poolById = new Map(((poolsData ?? []) as PoolRow[]).map((p) => [p.id, p]));
  const poolA = poolById.get(rowA.pool_id) ?? null;
  const poolB = poolById.get(rowB.pool_id) ?? null;

  // ── Perfis que servem aos dois (de origem ou do utilizador) ──────────
  const { data: profileRows } = await supabase
    .from('scouting_profiles')
    .select('id, name, description, filters, weights, owner_id')
    .or(`owner_id.is.null,owner_id.eq.${user.id}`)
    .order('name');
  type ProfileRow = {
    id: string;
    name: string;
    description: string | null;
    filters: unknown;
    weights: unknown;
    owner_id: string | null;
  };
  const allProfiles = ((profileRows ?? []) as ProfileRow[]).map((row) => ({
    row,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profile: profileRowToProfile(row as any),
  }));

  const viaOf = (r: PlayerRow, accepted: string[]): string | null => {
    if (accepted.length === 0 || matchesPrimaryPosition(r, accepted)) return null;
    return (r.positions_secondary ?? []).find((pos) => accepted.includes(pos)) ?? null;
  };

  const availableProfiles = allProfiles
    .filter(({ profile }) => {
      const accepted = profile.filters.positions ?? [];
      return matchesPositions(rowA, accepted) && matchesPositions(rowB, accepted);
    })
    .map(({ row, profile }) => {
      const accepted = profile.filters.positions ?? [];
      return {
        id: row.id,
        name: row.name,
        a_via: viaOf(rowA, accepted),
        b_via: viaOf(rowB, accepted),
      };
    })
    // Primeiro os perfis em que ambos entram pela posição primária.
    .sort(
      (x, y) =>
        Number(Boolean(x.a_via || x.b_via)) - Number(Boolean(y.a_via || y.b_via)) || x.name.localeCompare(y.name, 'pt')
    );

  // ── A lente da posição está disponível? ──────────────────────────────
  let positionLens: { available: boolean; reason: string | null; position_a: string | null; position_b: string | null } = {
    available: false,
    reason: null,
    position_a: null,
    position_b: null,
  };
  if (!rowA.position_primary || !SUPPORTED_POSITIONS.has(rowA.position_primary)) {
    positionLens.reason = `${rowA.name} não tem uma posição com métricas definidas.`;
  } else {
    const archetype = POSITION_METRICS[rowA.position_primary];
    const archetypePositions = Object.keys(POSITION_METRICS).filter((p) => POSITION_METRICS[p] === archetype);
    const bPositions = [rowB.position_primary, ...(rowB.positions_secondary ?? [])].filter(
      (p): p is string => p != null
    );
    const bPosition = bPositions.find((p) => archetypePositions.includes(p)) ?? null;
    if (!bPosition) {
      positionLens.reason = `${rowB.name} não joga em nenhuma posição do mesmo tipo que ${rowA.name} (${archetypePositions.join(', ')}).`;
    } else {
      positionLens = { available: true, reason: null, position_a: rowA.position_primary, position_b: bPosition };
    }
  }

  // ── Nomes e categorias das métricas ──────────────────────────────────
  const { data: metricRows } = await supabase.from('metrics').select('code, label_pt, category');
  const metricMeta = new Map(
    ((metricRows ?? []) as Array<{ code: string; label_pt: string; category: string | null }>).map((m) => [m.code, m])
  );

  const playerInfo = (r: PlayerRow, pool: PoolRow | null) => ({
    id: r.id,
    name: r.name,
    team: r.team_in_period ?? r.current_team,
    position_primary: r.position_primary,
    age: r.age,
    minutes_played: r.minutes_played,
    games_played: r.games_played,
    market_value_eur: r.market_value_eur,
    contract_until: r.contract_until,
    pool: pool
      ? {
          id: pool.id,
          label: formatPoolName(pool.name, pool.season),
          season: pool.season,
          competition: competitionLabel(pool),
          country: pool.country,
          competition_id: competitionId(pool),
        }
      : null,
  });

  const base = {
    a: playerInfo(rowA, poolA),
    b: playerInfo(rowB, poolB),
    same_pool: rowA.pool_id === rowB.pool_id,
    same_competition: Boolean(poolA && poolB && competitionId(poolA) === competitionId(poolB)),
    available_profiles: availableProfiles,
    position_lens: positionLens,
  };

  const buildMetrics = (
    codes: string[],
    sideA: Map<string, Side>,
    sideB: Map<string, Side>,
    weights?: Map<string, number>
  ) =>
    codes.map((code) => {
      const meta = metricMeta.get(code);
      return {
        metric_code: code,
        label: meta?.label_pt ?? code,
        category: meta?.category ?? 'unknown',
        weight: weights?.get(code) ?? null,
        a: sideA.get(code) ?? null,
        b: sideB.get(code) ?? null,
      };
    });

  // ── Lente: perfil ────────────────────────────────────────────────────
  if (profileId) {
    const chosen = allProfiles.find((p) => p.row.id === profileId);
    // Perfil de outro utilizador responde como se não existisse.
    if (!chosen) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });
    const { profile, row } = chosen;
    const accepted = profile.filters.positions ?? [];

    const [detailA, detailB, cachedRows] = await Promise.all([
      scorePlayerInProfile(supabase, { poolId: rowA.pool_id, profile, playerId: aId }).catch(() => null),
      scorePlayerInProfile(supabase, { poolId: rowB.pool_id, profile, playerId: bId }).catch(() => null),
      supabase
        .from('profile_scores')
        .select('player_id, score, rank, total_eligible')
        .eq('profile_id', profileId)
        .in('player_id', [aId, bId]),
    ]);
    const cached = new Map(
      ((cachedRows.data ?? []) as Array<{ player_id: string; score: number; rank: number; total_eligible: number }>).map(
        (r) => [r.player_id, r]
      )
    );

    const sideOf = (detail: typeof detailA) => {
      const map = new Map<string, Side>();
      for (const c of detail?.scored?.contributions ?? []) {
        if (c.raw_value != null) map.set(c.metric_code, { raw_value: c.raw_value, percentile: c.percentile });
      }
      return map;
    };
    const resultOf = (r: PlayerRow, detail: typeof detailA) => {
      const hit = cached.get(r.id);
      const scored = detail?.scored ?? null;
      const score = hit ? Number(hit.score) : scored?.score ?? null;
      return {
        eligible: score != null,
        score,
        rank: hit?.rank ?? null,
        total_eligible: hit?.total_eligible ?? null,
        via_position: viaOf(r, accepted),
        peer_group_size: detail?.peer_group_size ?? null,
      };
    };

    return NextResponse.json({
      ...base,
      lens: 'profile',
      profile: { id: row.id, name: row.name, description: row.description },
      result_a: resultOf(rowA, detailA),
      result_b: resultOf(rowB, detailB),
      metrics: buildMetrics(
        profile.weights.map((w) => w.metric_code),
        sideOf(detailA),
        sideOf(detailB),
        new Map(profile.weights.map((w) => [w.metric_code, w.weight]))
      ),
    });
  }

  // ── Lente: métricas da posição ───────────────────────────────────────
  if (!positionLens.available || !positionLens.position_a || !positionLens.position_b) {
    return NextResponse.json({ ...base, lens: 'none', profile: null, result_a: null, result_b: null, metrics: [] });
  }

  const { data: pctRows, error: pctErr } = await supabase
    .from('player_percentiles')
    .select('player_id, position, metric_code, raw_value, percentile')
    .or(
      `and(player_id.eq.${aId},position.eq.${positionLens.position_a}),and(player_id.eq.${bId},position.eq.${positionLens.position_b})`
    );
  if (pctErr) return NextResponse.json({ error: pctErr.message }, { status: 500 });

  const sideA = new Map<string, Side>();
  const sideB = new Map<string, Side>();
  for (const r of (pctRows ?? []) as Array<{
    player_id: string;
    metric_code: string;
    raw_value: number | null;
    percentile: number;
  }>) {
    (r.player_id === aId ? sideA : sideB).set(r.metric_code, {
      raw_value: r.raw_value,
      percentile: Number(r.percentile),
    });
  }

  const viaForPosition = (r: PlayerRow, pos: string) => (r.position_primary === pos ? null : pos);
  const emptyResult = (r: PlayerRow, pos: string) => ({
    eligible: true,
    score: null,
    rank: null,
    total_eligible: null,
    via_position: viaForPosition(r, pos),
    peer_group_size: null,
  });

  return NextResponse.json({
    ...base,
    lens: 'position',
    profile: null,
    result_a: emptyResult(rowA, positionLens.position_a),
    result_b: emptyResult(rowB, positionLens.position_b),
    metrics: buildMetrics(getMetricsForPosition(positionLens.position_a), sideA, sideB),
  });
}
