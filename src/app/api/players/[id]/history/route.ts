import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { profileRowToProfile } from '@/lib/scouting/db-helpers';
import { scorePlayerInProfile } from '@/lib/scouting/score-player';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

type SeasonEntry = {
  player_id: string;
  is_current: boolean;
  season: string;
  pool_id: string;
  competition: string;
  country: string | null;
  tier: number | null;
  team: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  games_played: number | null;
  /**
   * Posição secundária pela qual entra no perfil nessa época; null se entra
   * pela primária (ou se não há perfil). Um central que depois passou a
   * lateral aparece num perfil de lateral nas duas épocas, mas só numa delas
   * é comparado com quem joga na posição dele.
   */
  via_position: string | null;
  /** Score no perfil pedido; null se não for elegível nessa época. */
  score: number | null;
  rank: number | null;
  total_eligible: number | null;
  metrics: Array<{ metric_code: string; raw_value: number | null; percentile: number | null }>;
};

/**
 * GET /api/players/[id]/history?profile_id=<uuid>
 *
 * As épocas em que o mesmo jogador aparece (ligadas por `players.identity_id`,
 * ver a função `link_player_identities` na base de dados) e, se vier um perfil,
 * o score e os percentis das métricas desse perfil em cada uma.
 *
 * Os percentis de cada época são medidos contra o peer group DESSA pool: quando
 * o jogador muda de liga, os valores não são directamente comparáveis. A
 * resposta traz o escalão de cada época para a interface o poder dizer.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { id } = await ctx.params;
  const profileId = req.nextUrl.searchParams.get('profile_id');

  const { data: me, error: meErr } = await supabase
    .from('players')
    .select('id, identity_id')
    .eq('id', id)
    .maybeSingle();
  if (meErr) return NextResponse.json({ error: meErr.message }, { status: 500 });
  if (!me) return NextResponse.json({ error: 'Jogador não encontrado.' }, { status: 404 });

  // Todas as linhas da mesma pessoa; sem identidade, só a própria.
  const COLS =
    'id, pool_id, position_primary, positions_secondary, age, minutes_played, games_played, current_team, team_in_period';
  let rowsQuery = supabase.from('players').select(COLS);
  rowsQuery = me.identity_id ? rowsQuery.eq('identity_id', me.identity_id) : rowsQuery.eq('id', id);
  const { data: rows, error: rowsErr } = await rowsQuery;
  if (rowsErr) return NextResponse.json({ error: rowsErr.message }, { status: 500 });

  type Row = {
    id: string;
    pool_id: string;
    position_primary: string | null;
    positions_secondary: string[] | null;
    age: number | null;
    minutes_played: number | null;
    games_played: number | null;
    current_team: string | null;
    team_in_period: string | null;
  };
  const playerRows = (rows ?? []) as Row[];

  const { data: pools } = await supabase
    .from('pools')
    .select('id, name, season, competition, country, tier');
  type PoolRow = {
    id: string;
    name: string;
    season: string;
    competition: string | null;
    country: string | null;
    tier: number | null;
  };
  const poolById = new Map(((pools ?? []) as PoolRow[]).map((p) => [p.id, p]));
  const latestSeason = ((pools ?? []) as PoolRow[]).map((p) => p.season).sort().pop() ?? null;

  // Perfil: tem de ser seed ou do utilizador, como no /api/score.
  let profile: ReturnType<typeof profileRowToProfile> | null = null;
  let profileName: string | null = null;
  if (profileId) {
    const { data: profileRow } = await supabase
      .from('scouting_profiles')
      .select('id, name, description, filters, weights, owner_id')
      .eq('id', profileId)
      .maybeSingle();
    if (profileRow && (profileRow.owner_id === null || profileRow.owner_id === user.id)) {
      profile = profileRowToProfile(profileRow);
      profileName = profileRow.name;
    }
  }

  // Score e posição guardados, e detalhe por métrica calculado contra o peer
  // group de cada pool.
  const cached = new Map<string, { score: number; rank: number; total_eligible: number }>();
  const details = new Map<string, Awaited<ReturnType<typeof scorePlayerInProfile>>>();
  if (profile && profileId && playerRows.length > 0) {
    const { data: scoreRows } = await supabase
      .from('profile_scores')
      .select('player_id, score, rank, total_eligible')
      .eq('profile_id', profileId)
      .in(
        'player_id',
        playerRows.map((r) => r.id)
      );
    for (const r of (scoreRows ?? []) as Array<{
      player_id: string;
      score: number;
      rank: number;
      total_eligible: number;
    }>) {
      cached.set(r.player_id, { score: Number(r.score), rank: r.rank, total_eligible: r.total_eligible });
    }

    const currentProfile = profile;
    await Promise.all(
      playerRows.map(async (r) => {
        try {
          details.set(
            r.id,
            await scorePlayerInProfile(supabase, { poolId: r.pool_id, profile: currentProfile, playerId: r.id })
          );
        } catch {
          details.set(r.id, null);
        }
      })
    );
  }

  const accepted = profile?.filters.positions ?? [];
  const viaPositionOf = (r: Row): string | null => {
    if (accepted.length === 0) return null;
    const primary = (r.position_primary ?? '').trim();
    if (primary && accepted.includes(primary)) return null;
    return (r.positions_secondary ?? []).find((pos) => accepted.includes(pos)) ?? null;
  };

  const seasons: SeasonEntry[] = playerRows.flatMap((r) => {
    const pool = poolById.get(r.pool_id);
    if (!pool) return [];
    const detail = details.get(r.id) ?? null;
    const hit = cached.get(r.id);
    const scored = detail?.scored ?? null;
    return [
      {
        player_id: r.id,
        is_current: r.id === id,
        season: pool.season,
        pool_id: pool.id,
        competition: pool.competition ?? pool.name,
        country: pool.country,
        tier: pool.tier,
        team: r.team_in_period ?? r.current_team,
        position_primary: r.position_primary,
        via_position: viaPositionOf(r),
        age: r.age,
        minutes_played: r.minutes_played,
        games_played: r.games_played,
        score: hit?.score ?? scored?.score ?? null,
        rank: hit?.rank ?? null,
        total_eligible: hit?.total_eligible ?? null,
        metrics: (scored?.contributions ?? []).map((c) => ({
          metric_code: c.metric_code,
          raw_value: c.raw_value,
          percentile: c.raw_value == null ? null : c.percentile,
        })),
      },
    ];
  });

  // Da época mais antiga para a mais recente; na mesma época, pelo escalão.
  seasons.sort(
    (a, b) => a.season.localeCompare(b.season) || (a.tier ?? 99) - (b.tier ?? 99) || a.competition.localeCompare(b.competition)
  );

  // Nomes das métricas, para a interface não mostrar códigos.
  const { data: metricRows } = await supabase.from('metrics').select('code, label_pt');
  const labels: Record<string, string> = {};
  for (const m of (metricRows ?? []) as Array<{ code: string; label_pt: string }>) labels[m.code] = m.label_pt;

  return NextResponse.json({
    linked: Boolean(me.identity_id),
    latest_season: latestSeason,
    profile: profile
      ? {
          id: profileId,
          name: profileName,
          metrics: profile.weights.map((w) => ({
            metric_code: w.metric_code,
            label: labels[w.metric_code] ?? w.metric_code,
            weight: w.weight,
          })),
        }
      : null,
    seasons,
  });
}
