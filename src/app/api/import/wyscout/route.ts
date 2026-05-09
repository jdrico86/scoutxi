import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseWyscoutXlsx } from '@/lib/wyscout/parser';
import type { Database } from '@/lib/supabase/database.types';
import { getAuthUser } from '@/lib/supabase/server';

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
 *   source:      string          (opcional, default "wyscout")
 *
 * Comportamento: upsert por (pool_id, name, current_team).
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
  if (existingPool) {
    poolId = existingPool.id;
    // Actualiza metadados (ficheiro, competição)
    await supabase
      .from('pools')
      .update({ competition, file_name: file.name, source })
      .eq('id', poolId);
  } else {
    const { data: newPool, error: poolErr } = await supabase
      .from('pools')
      .insert({ name: poolName, season, source, competition, file_name: file.name })
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
  const keyOf = (name: string, team: string | null | undefined, age: number | null | undefined) =>
    `${name.toLowerCase()}::${(team ?? '').toLowerCase()}::${age ?? ''}`;

  const existingByKey = new Map<string, string>(); // key -> player_id
  const EXISTING_PAGE = 1000;
  let existingFrom = 0;
  while (true) {
    const { data: page, error: existingErr } = await supabase
      .from('players')
      .select('id, name, current_team, age')
      .eq('pool_id', poolId)
      .range(existingFrom, existingFrom + EXISTING_PAGE - 1);
    if (existingErr) {
      return NextResponse.json(
        { error: `Erro a ler jogadores existentes: ${existingErr.message}` },
        { status: 500 }
      );
    }
    if (!page || page.length === 0) break;
    for (const p of page) {
      existingByKey.set(keyOf(p.name, p.current_team, p.age), p.id);
    }
    if (page.length < EXISTING_PAGE) break;
    existingFrom += EXISTING_PAGE;
  }

  // Separar em novos vs a actualizar
  const toInsert: PlayerInsert[] = [];
  const toUpdate: Array<{ id: string; data: Partial<PlayerInsert> }> = [];
  // Mapa rowIndex -> player_id (preenche-se depois dos inserts)
  const rowToPlayerId = new Map<number, string>();

  for (const p of parsed.players) {
    const name = String(p.data.name);
    const team = (p.data.current_team as string | null | undefined) ?? null;
    const age = (p.data.age as number | null | undefined) ?? null;
    const key = keyOf(name, team, age);
    const existingId = existingByKey.get(key);

    if (existingId) {
      rowToPlayerId.set(p.rowIndex, existingId);
      toUpdate.push({ id: existingId, data: { ...p.data, pool_id: poolId } as Partial<PlayerInsert> });
    } else {
      toInsert.push({ ...p.data, pool_id: poolId } as PlayerInsert);
    }
  }

  // 3) Inserts em batch (novos jogadores)
  let insertedCount = 0;
  for (let i = 0; i < toInsert.length; i += BATCH_PLAYERS) {
    const batch = toInsert.slice(i, i + BATCH_PLAYERS);
    const { data, error } = await supabase.from('players').insert(batch).select('id, name, current_team, age');
    if (error) {
      return NextResponse.json({ error: `Erro a inserir jogadores: ${error.message}` }, { status: 500 });
    }
    for (const p of data ?? []) {
      existingByKey.set(keyOf(p.name, p.current_team, p.age), p.id);
    }
    insertedCount += data?.length ?? 0;
  }

  // Agora que todos os IDs existem, preenchemos rowToPlayerId também para os novos
  for (const p of parsed.players) {
    if (rowToPlayerId.has(p.rowIndex)) continue;
    const id = existingByKey.get(keyOf(String(p.data.name), (p.data.current_team as string | null) ?? null, (p.data.age as number | null) ?? null));
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
    stats_inserted: statsInserted,
    columns_ignored: parsed.unmappedColumns,
    columns_missing: parsed.missingColumns,
    warnings: parsed.warnings,
  });
}