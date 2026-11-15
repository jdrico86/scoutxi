import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseWyscoutXlsx } from '@/lib/wyscout/parser';
import { PlayerMatcher, periodTeam } from '@/lib/wyscout/player-key';
import { pastSeasonReference } from '@/lib/pools';
import type { Database } from '@/lib/supabase/database.types';
import { getAuthUser } from '@/lib/supabase/server';
import { recalculatePoolPercentiles } from '@/lib/similarity/recalculate';
import { recalculateProfileScores } from '@/lib/scouting/recalculate-scores';

// Runtime Node (não Edge) — precisamos de Buffer e xlsx lê melhor em Node
export const runtime = 'nodejs';
// Ficheiros do Wyscout podem crescer; damos margem
export const maxDuration = 60;

type PlayerInsert = Database['public']['Tables']['players']['Insert'];
type StatInsert = Database['public']['Tables']['player_stats']['Insert'];

const BATCH_PLAYERS = 500;
const BATCH_STATS = 1000;

/**
 * POST /api/import/wyscout
 *
 * multipart/form-data:
 *   file:        XLSX Wyscout (obrigatório)
 *   pool_name:   string          (obrigatório)  ex: "Campeonato de Portugal 25/26"
 *   season:      string          (obrigatório)  ex: "25/26"
 *   competition: string          (opcional)
 *   country:     string          (opcional)  ex: "Portugal" — agrupa a pool na escolha de pool
 *   tier:        inteiro         (opcional)  escalão dentro do país, 1 = primeira divisão
 *   competition_key: string      (opcional)  código estável da competição entre épocas
 *   in_pyramid:  'true'|'false'  (opcional)  falso para sub-23 e taças
 *   source:      string          (opcional, default "wyscout")
 *   snapshot_label: string       (opcional)  nome da fotografia no histórico, ex: "J8"
 *   history_only: 'true'         (opcional)  ficheiro antigo: guarda só a fotografia no
 *                                histórico e não toca nos dados actuais da pool
 *   snapshot_date: AAAA-MM-DD    (obrigatório com history_only)  data a que os dados dizem respeito
 *
 * Comportamento: upsert por (pool_id, nome, equipa do período, altura, pé) — ver lib/wyscout/player-key.ts.
 *   - Re-importar o mesmo pool: apaga stats antigas dos jogadores re-encontrados
 *     e recria, mantém metadados actualizados.
 */
export async function POST(req: NextRequest) {
  // ── Verificar admin ────────────────────────────────────────────────────
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }
  const checkUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const checkKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (checkUrl && checkKey) {
    const checkClient = createClient(checkUrl, checkKey, { auth: { persistSession: false } });
    const { data: allowedRow } = await checkClient
      .from('allowed_users')
      .select('is_admin')
      .eq('email', user.email ?? '')
      .maybeSingle();
    const isAdmin = (allowedRow as { is_admin?: boolean } | null)?.is_admin ?? false;
    if (!isAdmin) {
      return NextResponse.json({ error: 'Apenas administradores podem importar.' }, { status: 403 });
    }
  }

  // ── Chaves Supabase ────────────────────────────────────────────────────
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      {
        error:
          'SUPABASE_SERVICE_ROLE_KEY em falta no .env.local. Adiciona a chave service_role (não a anon) — podes copiá-la do dashboard Supabase, Settings → API.',
      },
      { status: 500 }
    );
  }

  // ── Input ──────────────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Body inválido (esperado multipart/form-data).' }, { status: 400 });
  }

  const file = formData.get('file');
  const poolName = String(formData.get('pool_name') ?? '').trim();
  const season = String(formData.get('season') ?? '').trim();
  const competition = String(formData.get('competition') ?? '').trim() || null;
  const source = String(formData.get('source') ?? 'wyscout_xlsx').trim();
  // País e escalão: só se escrevem quando vêm no pedido, para uma reimportação
  // sem estes campos não apagar o que a pool já tem.
  const country = String(formData.get('country') ?? '').trim() || null;
  const tierRaw = parseInt(String(formData.get('tier') ?? ''), 10);
  const tier = Number.isInteger(tierRaw) && tierRaw > 0 ? tierRaw : null;
  // Código da competição e se está na pirâmide — ver lib/pools.ts.
  const competitionKey = String(formData.get('competition_key') ?? '').trim() || null;
  const inPyramidRaw = formData.get('in_pyramid');
  const placement = {
    ...(country ? { country } : {}),
    ...(tier ? { tier } : {}),
    ...(competitionKey ? { competition_key: competitionKey } : {}),
    ...(inPyramidRaw !== null ? { in_pyramid: String(inPyramidRaw) !== 'false' } : {}),
  };

  // Histórico: cada importação guarda uma fotografia da pool (tabelas
  // `pool_imports` e `player_snapshots`). Um ficheiro antigo pode entrar só
  // como fotografia, com a data a que diz respeito.
  const snapshotLabel = String(formData.get('snapshot_label') ?? '').trim() || null;
  const historyOnly = String(formData.get('history_only') ?? '') === 'true';
  const snapshotDate = String(formData.get('snapshot_date') ?? '').trim();
  if (historyOnly) {
    const today = new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || Number.isNaN(Date.parse(snapshotDate)) || snapshotDate >= today) {
      return NextResponse.json(
        { error: 'Para carregar só no histórico, indica a data dos dados (anterior a hoje).' },
        { status: 400 }
      );
    }
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Campo "file" em falta.' }, { status: 400 });
  }
  if (!poolName || !season) {
    return NextResponse.json({ error: 'Campos "pool_name" e "season" são obrigatórios.' }, { status: 400 });
  }

  // ── Parse ──────────────────────────────────────────────────────────────
  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseWyscoutXlsx(buffer);
  } catch (err) {
    return NextResponse.json({ error: `Erro a parsear XLSX: ${(err as Error).message}` }, { status: 400 });
  }

  // ── Época passada: idades de hoje → idades do fim da época ────────────
  // O Wyscout exporta a idade que o jogador tem hoje, mesmo numa época antiga.
  // Acerta-se aqui, antes de reconhecer jogadores, e a pool fica com o dia a
  // que as idades dizem respeito (ver `pastSeasonReference`).
  const pastSeason = pastSeasonReference(season);
  if (pastSeason && pastSeason.years > 0) {
    for (const p of parsed.players) {
      const age = p.data.age;
      if (typeof age === 'number' && age > 0) p.data.age = age - pastSeason.years;
    }
  }
  const referenceDate = pastSeason?.date ?? null;

  // ── Persistência ──────────────────────────────────────────────────────
  const supabase = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

  // 1) Upsert da pool (por nome + season). Usamos insert e fetch — a tabela pools
  //    não tem unique constraint declarada, por isso fazemos "manualmente":
  const { data: existingPool } = await supabase
    .from('pools')
    .select('id')
    .eq('name', poolName)
    .eq('season', season)
    .maybeSingle();

  let poolId: string;
  if (historyOnly) {
    // Ficheiro antigo: a pool tem de existir e não se lhe mexe.
    if (!existingPool) {
      return NextResponse.json(
        { error: 'Só se carrega histórico para uma pool que já existe. Importa primeiro os dados actuais.' },
        { status: 400 }
      );
    }
    poolId = existingPool.id;
  } else if (existingPool) {
    poolId = existingPool.id;
    // Actualiza metadados (ficheiro, competição)
    await supabase
      .from('pools')
      .update({ competition, file_name: file.name, source, last_imported_at: new Date().toISOString(), reference_date: referenceDate, ...placement })
      .eq('id', poolId);
  } else {
    const { data: newPool, error: poolErr } = await supabase
      .from('pools')
      .insert({ name: poolName, season, source, competition, file_name: file.name, last_imported_at: new Date().toISOString(), reference_date: referenceDate, ...placement })
      .select('id')
      .single();
    if (poolErr || !newPool) {
      return NextResponse.json(
        { error: `Falha a criar pool: ${poolErr?.message ?? 'desconhecido'}` },
        { status: 500 }
      );
    }
    poolId = newPool.id;
  }

  // 2) Jogadores existentes desta pool, para decidir insert vs update.
  //    Paginado para evitar o limite implícito de 1000 do PostgREST — em pools
  //    grandes (CdP) o dedupe falhava silenciosamente e jogadores eram
  //    re-inseridos como duplicados em vez de actualizados.
  //    Chave: nome + equipa do período + altura + pé (lib/wyscout/player-key.ts).
  //    A idade não entra na chave — muda entre exports e criava um duplicado
  //    por aniversário — mas separa homónimos (mais de um ano de diferença).
  //    Quando a chave exacta falha, há uma segunda tentativa mais larga
  //    (`claimLoose`): o Wyscout completa fichas entre exports.
  const KEY_COLUMNS = 'id, name, current_team, team_in_period, height_cm, foot, age';
  const matcher = new PlayerMatcher<string>(); // chave + idade -> player_id
  const EXISTING_PAGE = 1000;
  let existingFrom = 0;
  while (true) {
    const { data: page, error: existingErr } = await supabase
      .from('players')
      .select(KEY_COLUMNS)
      .eq('pool_id', poolId)
      .order('id')
      .range(existingFrom, existingFrom + EXISTING_PAGE - 1);
    if (existingErr) {
      return NextResponse.json(
        { error: `Erro a ler jogadores existentes: ${existingErr.message}` },
        { status: 500 }
      );
    }
    if (!page || page.length === 0) break;
    for (const p of page) matcher.add(p, p.id);
    if (page.length < EXISTING_PAGE) break;
    existingFrom += EXISTING_PAGE;
  }

  // Reconhecer cada linha do ficheiro: primeiro a chave exacta para todas, só
  // depois a tentativa larga para as que sobraram.
  const matchOf = new Map<number, string>(); // rowIndex -> player_id
  const relinked: string[] = [];
  for (const p of parsed.players) {
    const hit = matcher.claim(p.data);
    if (hit) matchOf.set(p.rowIndex, hit);
  }
  for (const p of parsed.players) {
    if (matchOf.has(p.rowIndex)) continue;
    const hit = matcher.claimLoose(p.data);
    if (hit) {
      matchOf.set(p.rowIndex, hit);
      relinked.push(`${String(p.data.name)} (${periodTeam(p.data.team_in_period, p.data.current_team) || '—'})`);
    }
  }
  if (relinked.length > 0) {
    parsed.warnings.push(
      `${relinked.length} jogadores reconhecidos apesar de o Wyscout lhes ter mudado a altura, o pé ou a equipa: ${relinked.join('; ')}.`
    );
  }

  // ── Só histórico ──────────────────────────────────────────────────────
  // Liga cada linha do ficheiro antigo ao jogador que já existe na pool e
  // guarda os valores dessa data. Quem não existe na pool fica de fora: sem
  // registo actual não há a quem ligar a fotografia.
  if (historyOnly) {
    const statsByRow = new Map<number, Record<string, number>>();
    for (const st of parsed.stats) {
      let bag = statsByRow.get(st.rowIndex);
      if (!bag) {
        bag = {};
        statsByRow.set(st.rowIndex, bag);
      }
      bag[st.metric_code] = st.metric_value;
    }

    type SnapshotInsert = Database['public']['Tables']['player_snapshots']['Insert'];
    const snapshotRows: Array<Omit<SnapshotInsert, 'import_id'>> = [];
    const unmatched: string[] = [];
    for (const p of parsed.players) {
      const playerId = matchOf.get(p.rowIndex);
      if (!playerId) {
        unmatched.push(`${String(p.data.name)} (${periodTeam(p.data.team_in_period, p.data.current_team) || '—'})`);
        continue;
      }
      const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
      snapshotRows.push({
        player_id: playerId,
        team: periodTeam(p.data.team_in_period, p.data.current_team) || null,
        position_primary: typeof p.data.position_primary === 'string' ? p.data.position_primary : null,
        age: num(p.data.age),
        minutes_played: num(p.data.minutes_played),
        games_played: num(p.data.games_played),
        stats: statsByRow.get(p.rowIndex) ?? {},
      });
    }

    const { data: importRow, error: importErr } = await supabase
      .from('pool_imports')
      .upsert(
        {
          pool_id: poolId,
          snapshot_date: snapshotDate,
          label: snapshotLabel,
          file_name: file.name,
          players_count: snapshotRows.length,
          imported_at: new Date().toISOString(),
        },
        { onConflict: 'pool_id,snapshot_date' }
      )
      .select('id')
      .single();
    if (importErr || !importRow) {
      return NextResponse.json({ error: `Erro a registar a fotografia: ${importErr?.message ?? 'desconhecido'}` }, { status: 500 });
    }
    // Repetir a mesma data substitui a fotografia.
    await supabase.from('player_snapshots').delete().eq('import_id', importRow.id);
    for (let i = 0; i < snapshotRows.length; i += BATCH_PLAYERS) {
      const batch = snapshotRows.slice(i, i + BATCH_PLAYERS).map((r) => ({ ...r, import_id: importRow.id }));
      const { error } = await supabase.from('player_snapshots').insert(batch);
      if (error) {
        return NextResponse.json({ error: `Erro a guardar a fotografia: ${error.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      history_only: true,
      pool_id: poolId,
      pool_name: poolName,
      season,
      file_name: file.name,
      rows_read: parsed.rowCount,
      players_relinked: relinked.length,
      snapshot: { ok: true, date: snapshotDate, label: snapshotLabel, players: snapshotRows.length, unmatched },
      columns_ignored: parsed.unmappedColumns,
      columns_missing: parsed.missingColumns,
      warnings: parsed.warnings,
    });
  }

  // Separar em novos vs a actualizar
  const toInsert: PlayerInsert[] = [];
  const pendingRows: typeof parsed.players = [];
  const toUpdate: Array<{ id: string; data: Partial<PlayerInsert> }> = [];
  // Mapa rowIndex -> player_id (preenche-se depois dos inserts)
  const rowToPlayerId = new Map<number, string>();

  for (const p of parsed.players) {
    const existingId = matchOf.get(p.rowIndex);

    if (existingId) {
      rowToPlayerId.set(p.rowIndex, existingId);
      toUpdate.push({ id: existingId, data: { ...p.data, pool_id: poolId } as Partial<PlayerInsert> });
    } else {
      toInsert.push({ ...p.data, pool_id: poolId } as PlayerInsert);
      pendingRows.push(p);
    }
  }

  // 3) Inserts em batch (novos jogadores)
  let insertedCount = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_PLAYERS) {
    const batch = toInsert.slice(i, i + BATCH_PLAYERS);
    const { data, error } = await supabase.from('players').insert(batch).select(KEY_COLUMNS);
    if (error) {
      return NextResponse.json({ error: `Erro a inserir jogadores: ${error.message}` }, { status: 500 });
    }
    for (const p of data ?? []) matcher.add(p, p.id);
    insertedCount += data?.length ?? 0;
  }

  // Agora que todos os IDs existem, preenchemos rowToPlayerId também para os novos
  for (const p of pendingRows) {
    const id = matcher.claim(p.data);
    if (id) rowToPlayerId.set(p.rowIndex, id);
  }

  // 4) Updates dos jogadores existentes (em paralelo limitado)
  let updatedCount = 0;
  for (let i = 0; i < toUpdate.length; i += 50) {
    const chunk = toUpdate.slice(i, i + 50);
    await Promise.all(
      chunk.map(async ({ id, data }) => {
        const { error } = await supabase.from('players').update(data).eq('id', id);
        if (!error) updatedCount++;
      })
    );
  }


  // 6) Inserir stats em batches
  const statRows: StatInsert[] = [];
  for (const s of parsed.stats) {
    const playerId = rowToPlayerId.get(s.rowIndex);
    if (!playerId) continue; // safety — jogador sem ID
    statRows.push({
      player_id: playerId,
      metric_code: s.metric_code,
      metric_value: s.metric_value,
      metric_source: 'direct',
      raw_label: s.raw_label,
    });
  }

  let statsInserted = 0;
  for (let i = 0; i < statRows.length; i += BATCH_STATS) {
    const batch = statRows.slice(i, i + BATCH_STATS);
    const { error } = await supabase
      .from('player_stats')
      .upsert(batch, { onConflict: 'player_id,metric_code' });
    if (error) {
      return NextResponse.json(
        {
          error: `Erro a inserir stats (batch ${i}): ${error.message}`,
          partial: { pool_id: poolId, players_inserted: insertedCount, players_updated: updatedCount, stats_inserted: statsInserted },
        },
        { status: 500 }
      );
    }
    statsInserted += batch.length;
  }

  // 6a) Fotografia da pool para o histórico (função `snapshot_pool` na base de
  //     dados). Repetir no mesmo dia substitui. Erro aqui não falha o import.
  let snapshotResult: { ok: boolean; date?: string; label?: string | null; players?: number; error?: string };
  {
    const { data: snapRows, error: snapErr } = await supabase.rpc('snapshot_pool', {
      p_pool_id: poolId,
      // Época passada: a fotografia fica com a data do fim da época, não a de hoje.
      p_date: referenceDate ?? undefined,
      p_label: snapshotLabel ?? undefined,
      p_file_name: file.name,
    });
    snapshotResult = snapErr
      ? { ok: false, error: snapErr.message }
      : { ok: true, date: referenceDate ?? new Date().toISOString().slice(0, 10), label: snapshotLabel, players: snapRows?.[0]?.players };
  }

  // 6b) Ligar os jogadores novos à mesma pessoa noutras épocas e pools
  //     (função `link_player_identities` na base de dados: nome + altura + pé +
  //     idade coerente; na dúvida não liga). Erro aqui não falha o import.
  let identitiesResult: { ok: boolean; linked?: number; ambiguous?: number; error?: string };
  {
    const { data: linkRows, error: linkErr } = await supabase.rpc('link_player_identities');
    identitiesResult = linkErr
      ? { ok: false, error: linkErr.message }
      : { ok: true, linked: linkRows?.[0]?.linked_players, ambiguous: linkRows?.[0]?.ambiguous_players };
  }

  // 7) Recalcular player_percentiles para esta pool, FORA da "transação" do import:
  //    erros aqui são reportados como warnings mas NÃO falham o import (que já está
  //    consolidado na BD). Admin pode re-trigger manualmente via
  //    POST /api/admin/recalculate-percentiles.
  let percentilesResult: { ok: boolean; rows_inserted?: number; error?: string };
  try {
    const r = await recalculatePoolPercentiles(supabase, poolId);
    percentilesResult = { ok: true, rows_inserted: r.rows_inserted };
  } catch (err) {
    percentilesResult = { ok: false, error: (err as Error).message };
  }

  // 8) Recalcular profile_scores pela mesma razão e com as mesmas regras.
  //    Os scores dos perfis só mudam quando a pool muda, por isso ficam
  //    gravados em vez de serem recalculados a cada visita às páginas de equipa
  //    e de jogador. Erro aqui não falha o import: as rotas de leitura sabem
  //    calcular ao vivo o que não encontrarem em cache.
  let scoresResult: { ok: boolean; rows_inserted?: number; profiles?: number; error?: string };
  try {
    const r = await recalculateProfileScores(supabase, poolId);
    scoresResult = { ok: true, rows_inserted: r.rows_inserted, profiles: r.profiles_processed };
  } catch (err) {
    scoresResult = { ok: false, error: (err as Error).message };
  }

  return NextResponse.json({
    ok: true,
    pool_id: poolId,
    pool_name: poolName,
    season,
    competition,
    file_name: file.name,
    rows_read: parsed.rowCount,
    players_inserted: insertedCount,
    players_updated: updatedCount,
    players_relinked: relinked.length,
    stats_inserted: statsInserted,
    columns_ignored: parsed.unmappedColumns,
    columns_missing: parsed.missingColumns,
    warnings: parsed.warnings,
    percentiles: percentilesResult,
    profile_scores: scoresResult,
    identities: identitiesResult,
    age_reference: pastSeason,
    snapshot: snapshotResult,
  });
}