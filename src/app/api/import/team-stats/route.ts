import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/supabase/server';
import { parseTeamStatsXlsx, type TeamStatsRow } from '@/lib/team-stats/parser';
import { normalizeTeamName } from '@/lib/team-stats/metrics';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH = 500;

/**
 * POST /api/import/team-stats
 *
 * multipart/form-data:
 *   files:       um ou mais XLSX "Team Stats" do Wyscout (um por equipa)
 *   pool_id:     pool a que os jogos pertencem (obrigatório)
 *   mode:        'preview' (por omissão) só lê e resume; 'import' grava
 *   competition: nome da competição tal como vem nos ficheiros. Obrigatório
 *                quando os ficheiros trazem mais de uma (liga e taça, p. ex.)
 *   round:       texto livre para o rótulo "Atualizado à jornada …" (opcional)
 *
 * Cada ficheiro traz duas linhas por jogo: a equipa e o adversário. Guardam-se
 * as duas, por isso uma equipa sem ficheiro próprio fica reconstruída pelos
 * ficheiros dos adversários. Reimportar actualiza, não duplica.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  // Cliente sem tipos: as duas tabelas novas não estão em database.types.ts.
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: allowed } = await supabase.from('allowed_users').select('is_admin').eq('email', user.email ?? '').maybeSingle();
  if (!(allowed as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: 'Apenas administradores podem importar.' }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  }
  const poolId = String(form.get('pool_id') ?? '').trim();
  const mode = form.get('mode') === 'import' ? 'import' : 'preview';
  const wantedCompetition = String(form.get('competition') ?? '').trim();
  const round = String(form.get('round') ?? '').trim();
  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);

  if (!poolId) return NextResponse.json({ error: 'Falta a pool.' }, { status: 400 });
  if (files.length === 0) return NextResponse.json({ error: 'Falta pelo menos um ficheiro.' }, { status: 400 });

  const { data: pool, error: poolError } = await supabase.from('pools').select('id, name, season').eq('id', poolId).maybeSingle();
  if (poolError) return NextResponse.json({ error: poolError.message }, { status: 500 });
  if (!pool) return NextResponse.json({ error: 'Pool não encontrada.' }, { status: 404 });

  // ── Ler os ficheiros ───────────────────────────────────────────────────
  const fileErrors: Array<{ file: string; error: string }> = [];
  const unknownHeaders = new Set<string>();
  const all: TeamStatsRow[] = [];
  for (const file of files) {
    try {
      const parsed = parseTeamStatsXlsx(Buffer.from(await file.arrayBuffer()));
      parsed.unknown_headers.forEach((h) => unknownHeaders.add(h));
      all.push(...parsed.rows);
    } catch (e) {
      fileErrors.push({ file: file.name, error: (e as Error).message });
    }
  }

  // ── Fora da época da pool ──────────────────────────────────────────────
  const window = seasonWindow(String(pool.season));
  const inSeason = window ? all.filter((r) => r.match_date >= window.from && r.match_date <= window.to) : all;
  const outsideSeason = all.length - inSeason.length;

  // ── Competições presentes ──────────────────────────────────────────────
  const gamesByCompetition = new Map<string, Set<string>>();
  for (const r of inSeason) {
    if (!gamesByCompetition.has(r.competition)) gamesByCompetition.set(r.competition, new Set());
    gamesByCompetition.get(r.competition)!.add(`${r.match_date}|${r.match_label}`);
  }
  const competitions = [...gamesByCompetition.entries()]
    .map(([name, games]) => ({ name, games: games.size }))
    .sort((a, b) => b.games - a.games);
  const selected =
    wantedCompetition && gamesByCompetition.has(wantedCompetition)
      ? wantedCompetition
      : competitions.length === 1
        ? competitions[0].name
        : null;

  // ── Juntar as duas metades de cada jogo ────────────────────────────────
  const rows = selected ? inSeason.filter((r) => r.competition === selected) : [];
  const games = new Map<string, Map<string, TeamStatsRow>>();
  for (const r of rows) {
    const k = `${r.match_date}|${r.match_label}`;
    if (!games.has(k)) games.set(k, new Map());
    games.get(k)!.set(r.team, r); // o mesmo jogo vem em dois ficheiros: fica uma linha por equipa
  }
  let unpaired = 0;
  const records: Array<Record<string, unknown>> = [];
  const gamesPerTeam = new Map<string, number>();
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  for (const halves of games.values()) {
    if (halves.size !== 2) {
      unpaired++;
      continue;
    }
    const [a, b] = [...halves.values()];
    for (const [mine, other] of [
      [a, b],
      [b, a],
    ] as const) {
      records.push({
        pool_id: poolId,
        match_date: mine.match_date,
        match_label: mine.match_label,
        team: mine.team,
        opponent: other.team,
        duration: mine.duration && mine.duration > 0 ? Math.round(mine.duration) : null,
        scheme: mine.scheme,
        stats: mine.stats,
      });
      gamesPerTeam.set(mine.team, (gamesPerTeam.get(mine.team) ?? 0) + 1);
    }
    if (!firstDate || a.match_date < firstDate) firstDate = a.match_date;
    if (!lastDate || a.match_date > lastDate) lastDate = a.match_date;
  }

  // ── Equipas que não existem na pool: sinal de pool errada ──────────────
  const poolTeams = await loadPoolTeams(supabase, poolId);
  const known = new Set(poolTeams.map(normalizeTeamName));
  const teams = [...gamesPerTeam.entries()]
    .map(([team, n]) => ({ team, games: n, in_pool: poolTeams.includes(team) || known.has(normalizeTeamName(team)) }))
    .sort((a, b) => a.team.localeCompare(b.team, 'pt'));

  const summary = {
    pool: { id: pool.id, name: pool.name, season: pool.season },
    files: files.length,
    file_errors: fileErrors,
    competitions,
    competition: selected,
    needs_competition: selected === null && competitions.length > 1,
    games: records.length / 2,
    teams,
    teams_not_in_pool: teams.filter((t) => !t.in_pool).map((t) => t.team),
    first_date: firstDate,
    last_date: lastDate,
    outside_season: outsideSeason,
    unpaired_games: unpaired,
    unknown_headers: [...unknownHeaders],
  };

  if (mode === 'preview') return NextResponse.json({ ok: true, mode, ...summary });

  if (!selected) {
    return NextResponse.json({ error: 'Os ficheiros trazem mais de uma competição. Escolhe qual importar.', ...summary }, { status: 400 });
  }
  if (records.length === 0) {
    return NextResponse.json({ error: 'Nenhum jogo completo para importar.', ...summary }, { status: 400 });
  }

  for (let i = 0; i < records.length; i += BATCH) {
    const { error } = await supabase
      .from('team_match_stats')
      .upsert(records.slice(i, i + BATCH), { onConflict: 'pool_id,match_date,team,opponent' });
    if (error) return NextResponse.json({ error: `Falha a gravar: ${error.message}`, ...summary }, { status: 500 });
  }

  // O rótulo da jornada só muda quando é dado; reimportar sem ele mantém o anterior.
  const meta: Record<string, unknown> = { pool_id: poolId, updated_at: new Date().toISOString() };
  if (round) meta.round_label = round;
  const { error: metaError } = await supabase.from('team_stats_meta').upsert(meta, { onConflict: 'pool_id' });
  if (metaError) return NextResponse.json({ error: `Jogos gravados, mas falhou o rótulo: ${metaError.message}`, ...summary }, { status: 500 });

  return NextResponse.json({ ok: true, mode, rows_written: records.length, round_label: round || null, ...summary });
}

/** "26/27" → 1 de Julho de 2026 a 30 de Junho de 2027. Outros formatos: sem janela. */
function seasonWindow(season: string): { from: string; to: string } | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(season.trim());
  if (!m) return null;
  return { from: `20${m[1]}-07-01`, to: `20${m[2]}-06-30` };
}

async function loadPoolTeams(supabase: SupabaseClient, poolId: string): Promise<string[]> {
  const teams = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('players')
      .select('team_in_period, current_team')
      .eq('pool_id', poolId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data as Array<{ team_in_period: string | null; current_team: string | null }>) {
      const team = (row.team_in_period ?? row.current_team ?? '').trim();
      if (team) teams.add(team);
    }
    if (data.length < PAGE) break;
  }
  return [...teams];
}
