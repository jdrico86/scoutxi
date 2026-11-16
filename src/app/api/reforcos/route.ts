import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { profileRowToProfile } from '@/lib/scouting/db-helpers';
import { hasStep, LOW_REPEAT_METRICS, stepFactor } from '@/lib/scouting/league-step';
import { computePercentile } from '@/lib/scouting/percentile';
import { familyByKey } from '@/lib/scouting/position-families';
import { matchesPositions } from '@/lib/scouting/positions';
import type { ScoutingProfile } from '@/lib/scouting/profile-types';
import { recalculateProfileScores } from '@/lib/scouting/recalculate-scores';
import { resolvePeerPositions } from '@/lib/scouting/scorer';
import { formatPoolName } from '@/lib/pools';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/reforcos?pool=&team=&pos=&from=[&profile_id=&max_age=&min_minutes=&limit=]
 *
 * Reforços para uma posição de uma equipa: o que o plantel tem, e os candidatos
 * de outra pool ordenados por um perfil.
 *
 * Não tem motor próprio. A ordem dos candidatos é o ranking do perfil que já
 * existe (`profile_scores`), e os percentis saem da mesma conta do scorer —
 * peer group por posição primária, percentil midrank. O que esta rota junta por
 * cima é: comparação com o plantel, ajuste entre escalões em intervalo
 * (lib/scouting/league-step.ts) e os avisos de leitura fraca.
 *
 *  - pool, team: a equipa que procura (a pool é a liga de destino).
 *  - pos: família de posição (lib/scouting/position-families.ts).
 *  - from: pool onde procurar. Pode ser a mesma.
 *  - profile_id: perfil que ordena; sem ele, o primeiro disponível para a posição.
 */

type Supa = SupabaseClient<Database>;

const PLAYER_COLS =
  'id, name, current_team, team_in_period, position_primary, positions_secondary, age, minutes_played, games_played, contract_until, market_value_eur';

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
  contract_until: string | null;
  market_value_eur: number | null;
};

type MetricCell = {
  raw: number | null;
  /** Percentil na liga do próprio jogador, já com a direcção certa (100 = melhor). */
  percentile: number | null;
  /** Valor ajustado para a liga de destino; null quando não há casos. */
  adjusted: { low: number; mid: number; high: number; pct_low: number; pct_mid: number; pct_high: number } | null;
};

const LOW_MINUTES = 1500;
/** Peso mínimo do perfil coberto por métricas com ajuste para haver score no destino. */
const MIN_STEP_COVERAGE = 0.8;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const teamOf = (p: { team_in_period: string | null; current_team: string | null }) =>
  (p.team_in_period ?? p.current_team ?? '').trim();

/**
 * Distribuições das métricas do perfil no peer group de uma pool, e os valores
 * dos jogadores pedidos. É a conta de `scorePlayerInProfile`, feita uma vez para
 * vários jogadores em vez de uma vez por jogador.
 */
async function loadMetricContext(
  supabase: Supa,
  poolId: string,
  profile: ScoutingProfile,
  wantedIds: string[]
): Promise<{ dist: Map<string, number[]>; values: Map<string, Map<string, number>>; peerSize: number }> {
  const codes = Array.from(new Set(profile.weights.map((w) => w.metric_code)));
  const peerPositions = resolvePeerPositions(profile);

  // Ids do peer group (posição primária), paginados e com ordem estável.
  const peerIds: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from('players').select('id').eq('pool_id', poolId);
    if (peerPositions.length > 0) q = q.in('position_primary', peerPositions);
    const { data, error } = await q.order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    peerIds.push(...(data ?? []).map((r) => r.id));
    if (!data || data.length < PAGE) break;
  }

  const peerSet = new Set(peerIds);
  const allIds = Array.from(new Set([...peerIds, ...wantedIds]));
  const values = new Map<string, Map<string, number>>();

  if (codes.length > 0 && allIds.length > 0) {
    // Cada pedido devolve no máximo 1000 linhas: o bloco de ids é dimensionado
    // para ids × métricas ficar abaixo disso, senão o resto perdia-se em silêncio.
    const perChunk = Math.max(1, Math.floor(900 / codes.length));
    const pages = await Promise.all(
      chunk(allIds, perChunk).map((ids) =>
        supabase
          .from('player_stats')
          .select('player_id, metric_code, metric_value')
          .in('player_id', ids)
          .in('metric_code', codes)
      )
    );
    for (const page of pages) {
      if (page.error) throw new Error(page.error.message);
      for (const row of page.data ?? []) {
        if (row.metric_value == null) continue;
        let m = values.get(row.player_id);
        if (!m) values.set(row.player_id, (m = new Map()));
        m.set(row.metric_code, Number(row.metric_value));
      }
    }
  }

  const dist = new Map<string, number[]>();
  for (const code of codes) {
    const vals: number[] = [];
    for (const [playerId, m] of values) {
      if (!peerSet.has(playerId)) continue;
      const v = m.get(code);
      if (v != null) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    dist.set(code, vals);
  }

  return { dist, values, peerSize: peerIds.length };
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const sp = req.nextUrl.searchParams;
  const teamPoolId = sp.get('pool');
  const teamName = (sp.get('team') ?? '').trim();
  const family = familyByKey(sp.get('pos'));
  const sourcePoolId = sp.get('from');
  const profileParam = sp.get('profile_id');
  const maxAge = sp.get('max_age') ? parseInt(sp.get('max_age')!, 10) : null;
  const minMinutes = sp.get('min_minutes') ? parseInt(sp.get('min_minutes')!, 10) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(sp.get('limit') ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT));

  if (!teamPoolId || !teamName || !family || !sourcePoolId) {
    return NextResponse.json({ error: 'Parâmetros pool, team, pos e from são obrigatórios.' }, { status: 400 });
  }

  const supabase: Supa = createClient<Database>(url, key, { auth: { persistSession: false } });

  try {
    // ── Pools ────────────────────────────────────────────────────────────
    const { data: poolRows, error: poolErr } = await supabase
      .from('pools')
      .select('id, name, season, competition, country, tier, competition_key, in_pyramid')
      .in('id', Array.from(new Set([teamPoolId, sourcePoolId])));
    if (poolErr) throw new Error(poolErr.message);
    const teamPool = (poolRows ?? []).find((p) => p.id === teamPoolId);
    const sourcePool = (poolRows ?? []).find((p) => p.id === sourcePoolId);
    if (!teamPool || !sourcePool) return NextResponse.json({ error: 'Pool não encontrada.' }, { status: 404 });

    const samePool = teamPool.id === sourcePool.id;

    // ── Perfis disponíveis para a posição: os seed e os do utilizador ────
    const { data: profileRows, error: profErr } = await supabase
      .from('scouting_profiles')
      .select('id, name, description, filters, weights, tags, owner_id')
      .or(`owner_id.is.null,owner_id.eq.${user.id}`)
      .order('name');
    if (profErr) throw new Error(profErr.message);

    const forFamily = (profileRows ?? []).filter((row) => {
      const positions = ((row.filters ?? {}) as { positions?: string[] }).positions ?? [];
      return positions.some((p) => family.positions.includes(p));
    });
    const profiles = forFamily.map((row) => ({
      id: row.id,
      name: row.name,
      is_seed: ((row.tags ?? []) as string[]).includes('seed'),
    }));

    const selectedRow = forFamily.find((r) => r.id === profileParam) ?? forFamily[0] ?? null;

    const base = {
      team_pool: { id: teamPool.id, name: formatPoolName(teamPool.name, teamPool.season), tier: teamPool.tier },
      source_pool: { id: sourcePool.id, name: formatPoolName(sourcePool.name, sourcePool.season), tier: sourcePool.tier },
      team_name: teamName,
      family: { key: family.key, label: family.label },
      profiles,
    };

    if (!selectedRow) {
      return NextResponse.json({ ...base, profile: null, step: { mode: 'none' as const }, squad: [], candidates: [] });
    }

    const profile = profileRowToProfile(selectedRow);
    const profileId = selectedRow.id;
    const profilePositions = profile.filters.positions ?? [];
    const totalWeight = profile.weights.reduce((s, w) => s + w.weight, 0) || 1;

    // ── Métricas do perfil: nome, unidade, direcção ──────────────────────
    const codes = Array.from(new Set(profile.weights.map((w) => w.metric_code)));
    const { data: metricRows, error: metErr } = await supabase
      .from('metrics')
      .select('code, label_pt, unit, direction')
      .in('code', codes);
    if (metErr) throw new Error(metErr.message);
    const metricMeta = new Map((metricRows ?? []).map((m) => [m.code, m]));
    const isLower = (code: string) => {
      const override = profile.weights.find((w) => w.metric_code === code)?.direction;
      if (override) return override === 'lower';
      const d = metricMeta.get(code)?.direction;
      return d === 'lower' || d === 'lower_better';
    };

    // ── Ajuste entre escalões: só dentro da mesma pirâmide e com tabela ──
    const stepApplies =
      !samePool &&
      Boolean(teamPool.in_pyramid) &&
      Boolean(sourcePool.in_pyramid) &&
      Boolean(teamPool.country) &&
      teamPool.country === sourcePool.country &&
      hasStep(sourcePool.tier, teamPool.tier);
    const sameLevel = samePool || (teamPool.country === sourcePool.country && teamPool.tier === sourcePool.tier && teamPool.tier != null);
    const stepMode: 'adjusted' | 'same_level' | 'none' = stepApplies ? 'adjusted' : sameLevel ? 'same_level' : 'none';

    // ── Plantel na posição ───────────────────────────────────────────────
    const [periodRes, legacyRes] = await Promise.all([
      supabase.from('players').select(PLAYER_COLS).eq('pool_id', teamPool.id).eq('team_in_period', teamName),
      supabase
        .from('players')
        .select(PLAYER_COLS)
        .eq('pool_id', teamPool.id)
        .is('team_in_period', null)
        .eq('current_team', teamName),
    ]);
    const teamErr = periodRes.error ?? legacyRes.error;
    if (teamErr) throw new Error(teamErr.message);
    const squadById = new Map<string, PlayerRow>();
    for (const p of [...(periodRes.data ?? []), ...(legacyRes.data ?? [])] as unknown as PlayerRow[]) squadById.set(p.id, p);
    const squadRows = Array.from(squadById.values())
      .filter((p) => family.positions.includes((p.position_primary ?? '').trim()))
      .sort((a, b) => (b.minutes_played ?? 0) - (a.minutes_played ?? 0));

    // ── Ranking do perfil na pool de procura (profile_scores) ────────────
    const readRanking = async (poolId: string) => {
      const rows: Array<{ player_id: string; score: number; rank: number; total_eligible: number }> = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('profile_scores')
          .select('player_id, score, rank, total_eligible')
          .eq('pool_id', poolId)
          .eq('profile_id', profileId)
          .order('rank', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    };
    const rankingOf = async (poolId: string) => {
      let rows = await readRanking(poolId);
      if (rows.length === 0) {
        // Perfil novo ou acabado de editar: ainda sem scores gravados nesta pool.
        await recalculateProfileScores(supabase, poolId, { profileIds: [profileId] });
        rows = await readRanking(poolId);
      }
      return rows;
    };

    const sourceRanking = await rankingOf(sourcePool.id);
    const teamRanking = samePool ? sourceRanking : await rankingOf(teamPool.id);
    const teamRankById = new Map(teamRanking.map((r) => [r.player_id, r]));

    // Candidatos: percorre o ranking por ordem e pára quando tem os que precisa.
    const candidateRows: Array<{ player: PlayerRow; score: number; rank: number; total: number }> = [];
    for (const block of chunk(sourceRanking, 100)) {
      if (candidateRows.length >= limit) break;
      const { data, error } = await supabase
        .from('players')
        .select(PLAYER_COLS)
        .in('id', block.map((r) => r.player_id));
      if (error) throw new Error(error.message);
      const byId = new Map(((data ?? []) as unknown as PlayerRow[]).map((p) => [p.id, p]));
      for (const r of block) {
        if (candidateRows.length >= limit) break;
        const p = byId.get(r.player_id);
        if (!p) continue;
        if (samePool && teamOf(p) === teamName) continue; // já é do plantel
        if (maxAge != null && (p.age ?? 999) > maxAge) continue;
        if (minMinutes != null && (p.minutes_played ?? 0) < minMinutes) continue;
        candidateRows.push({ player: p, score: Number(r.score), rank: r.rank, total: r.total_eligible });
      }
    }

    // ── Valores e percentis ──────────────────────────────────────────────
    const candidateIds = candidateRows.map((c) => c.player.id);
    const squadIds = squadRows.map((p) => p.id);
    const sourceCtx = await loadMetricContext(supabase, sourcePool.id, profile, samePool ? [...candidateIds, ...squadIds] : candidateIds);
    const teamCtx = samePool ? sourceCtx : await loadMetricContext(supabase, teamPool.id, profile, squadIds);

    const pctIn = (ctx: typeof sourceCtx, code: string, value: number) => {
      const p = computePercentile(value, ctx.dist.get(code) ?? []);
      return isLower(code) ? Math.round((100 - p) * 100) / 100 : p;
    };
    const isPercentage = (code: string) => metricMeta.get(code)?.unit === 'percentage';

    const cellsFor = (ctx: typeof sourceCtx, playerId: string, adjust: boolean): Record<string, MetricCell> => {
      const out: Record<string, MetricCell> = {};
      const mine = ctx.values.get(playerId);
      for (const code of codes) {
        const raw = mine?.get(code) ?? null;
        if (raw == null) {
          out[code] = { raw: null, percentile: null, adjusted: null };
          continue;
        }
        let adjusted: MetricCell['adjusted'] = null;
        if (adjust) {
          const f = stepFactor(sourcePool.tier, teamPool.tier, family.key, code);
          if (f) {
            const cap = (v: number) => (isPercentage(code) ? Math.min(100, v) : v);
            const low = cap(raw * f.q25);
            const mid = cap(raw * f.q50);
            const high = cap(raw * f.q75);
            // Percentil na liga de DESTINO. Numa métrica em que menos é melhor,
            // o valor mais alto dá o percentil mais baixo — daí o min/max.
            const pcts = [pctIn(teamCtx, code, low), pctIn(teamCtx, code, mid), pctIn(teamCtx, code, high)];
            adjusted = {
              low,
              mid,
              high,
              pct_low: Math.min(pcts[0], pcts[2]),
              pct_mid: pcts[1],
              pct_high: Math.max(pcts[0], pcts[2]),
            };
          }
        }
        out[code] = { raw, percentile: pctIn(ctx, code, raw), adjusted };
      }
      return out;
    };

    const metrics = profile.weights.map((w) => {
      const f = stepApplies ? stepFactor(sourcePool.tier, teamPool.tier, family.key, w.metric_code) : null;
      return {
        code: w.metric_code,
        label: metricMeta.get(w.metric_code)?.label_pt ?? w.metric_code,
        unit: metricMeta.get(w.metric_code)?.unit ?? null,
        weight: w.weight,
        lower_is_better: isLower(w.metric_code),
        low_repeat: LOW_REPEAT_METRICS.has(w.metric_code),
        step: f ? { cases: f.cases, group_label: f.group_label, specific: f.specific } : null,
      };
    });

    const squad = squadRows.map((p) => {
      const r = teamRankById.get(p.id);
      return {
        id: p.id,
        name: p.name,
        position_primary: p.position_primary,
        age: p.age,
        minutes_played: p.minutes_played,
        contract_until: p.contract_until,
        score: r ? Number(r.score) : null,
        rank: r?.rank ?? null,
        total: r?.total_eligible ?? null,
        cells: cellsFor(teamCtx, p.id, false),
      };
    });

    const candidates = candidateRows.map(({ player: p, score, rank, total }) => {
      const cells = cellsFor(sourceCtx, p.id, stepApplies);

      // Score projectado na liga de destino: calculado com as métricas que têm
      // ajuste, desde que cubram pelo menos MIN_STEP_COVERAGE do peso do perfil.
      // As que ficam de fora (têm valor mas não têm factor) saem da conta e o
      // peso é redistribuído pelas restantes; a resposta diz quais foram.
      // O intervalo junta os extremos de todas as métricas ao mesmo tempo, por
      // isso é largo de propósito.
      let projected: { low: number; mid: number; high: number } | null = null;
      let projectedLeftOut: string[] = [];
      if (stepApplies) {
        let low = 0;
        let mid = 0;
        let high = 0;
        let leftOutWeight = 0;
        const leftOut: string[] = [];
        for (const w of profile.weights) {
          const cell = cells[w.metric_code];
          if (cell.raw == null) continue; // métrica em falta conta zero, como no scorer
          if (!cell.adjusted) {
            leftOutWeight += w.weight;
            leftOut.push(w.metric_code);
            continue;
          }
          const share = w.weight / totalWeight;
          low += cell.adjusted.pct_low * share;
          mid += cell.adjusted.pct_mid * share;
          high += cell.adjusted.pct_high * share;
        }
        const coverage = totalWeight > 0 ? 1 - leftOutWeight / totalWeight : 0;
        if (coverage >= MIN_STEP_COVERAGE - 1e-9) {
          const r = (v: number) => Math.round((v / coverage) * 10) / 10;
          projected = { low: r(low), mid: r(mid), high: r(high) };
          projectedLeftOut = leftOut;
        }
      }

      const primary = (p.position_primary ?? '').trim();
      const viaSecondary =
        profilePositions.length > 0 && !profilePositions.includes(primary) && matchesPositions(p, profilePositions);

      return {
        id: p.id,
        name: p.name,
        team: teamOf(p) || null,
        position_primary: p.position_primary,
        age: p.age,
        minutes_played: p.minutes_played,
        contract_until: p.contract_until,
        market_value_eur: p.market_value_eur,
        score,
        rank,
        total,
        projected,
        projected_left_out: projectedLeftOut,
        cells,
        flags: {
          low_minutes: (p.minutes_played ?? 0) < LOW_MINUTES,
          via_secondary: viaSecondary,
        },
      };
    });

    return NextResponse.json({
      ...base,
      profile: { id: profileId, name: profile.name, metrics },
      step: { mode: stepMode },
      low_minutes_threshold: LOW_MINUTES,
      peer_group_size: { source: sourceCtx.peerSize, team: teamCtx.peerSize },
      squad,
      candidates,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
