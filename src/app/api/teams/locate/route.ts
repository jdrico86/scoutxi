import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { comparePools, formatPoolName } from '@/lib/pools';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * GET /api/teams/locate?team=...&competition_key=...
 *
 * Encontra a pool mais recente onde um clube aparece. Serve o atalho "Meu
 * clube": guarda-se o nome do clube, não a pool, e esta rota traduz o nome na
 * pool certa — a da época mais recente, de preferência na competição indicada.
 * Se o clube mudou de escalão, devolve a competição onde está agora.
 *
 * Returns: { located: { pool_id, pool_name, season, competition } | null }
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const team = (req.nextUrl.searchParams.get('team') ?? '').trim();
  const competitionKey = req.nextUrl.searchParams.get('competition_key');
  if (!team) return NextResponse.json({ error: 'Parâmetro team é obrigatório.' }, { status: 400 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Pools onde há jogadores deste clube. O clube é o `team_in_period`; o
  // `current_team` só conta quando o export não trouxe o clube do período.
  // Um clube tem poucas dezenas de jogadores por época, por isso mil linhas
  // chegam para muitas épocas — mas a ordem fica estável, por regra.
  const [period, legacy] = await Promise.all([
    supabase.from('players').select('pool_id').eq('team_in_period', team).order('id').range(0, 999),
    supabase
      .from('players')
      .select('pool_id')
      .is('team_in_period', null)
      .eq('current_team', team)
      .order('id')
      .range(0, 999),
  ]);
  const err = period.error ?? legacy.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  const poolIds = Array.from(
    new Set([...(period.data ?? []), ...(legacy.data ?? [])].map((r) => r.pool_id).filter((id): id is string => Boolean(id)))
  );
  if (poolIds.length === 0) return NextResponse.json({ located: null });

  const { data: pools, error: poolsErr } = await supabase
    .from('pools')
    .select('id, name, season, competition, country, tier, competition_key, in_pyramid')
    .in('id', poolIds);
  if (poolsErr) return NextResponse.json({ error: poolsErr.message }, { status: 500 });

  const sorted = [...(pools ?? [])].sort(comparePools);
  if (sorted.length === 0) return NextResponse.json({ located: null });

  // Época mais recente; dentro dela, a competição guardada se o clube lá estiver.
  const latestSeason = sorted[0].season;
  const latest = sorted.filter((p) => p.season === latestSeason);
  const chosen = latest.find((p) => competitionKey && p.competition_key === competitionKey) ?? latest[0];

  return NextResponse.json({
    located: {
      pool_id: chosen.id,
      pool_name: formatPoolName(chosen.name, chosen.season),
      season: chosen.season,
      competition: chosen.competition,
    },
  });
}
