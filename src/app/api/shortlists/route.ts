import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '@/lib/supabase/database.types';
import { loadPoolData, loadProfile } from '@/lib/scouting/db-helpers';
import { buildSnapshotEntries } from '@/lib/scouting/shortlist-helpers';
import { scoreProfile } from '@/lib/scouting/scorer';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Schema unificado para criar shortlist.
 * Dois modos de uso:
 *   - Manual: só `name`. Cria shortlist vazia, sem perfil/pool.
 *   - Gerada por perfil: `name` + `pool_id` + `profile_id` (+ optional `limit`).
 *     Aplica scoring e popula com top N jogadores.
 *   - Selecção: `name` + `pool_id` + `profile_id` + `player_ids`. Guarda
 *     exactamente esses jogadores, pela ordem recebida — é o que o separador
 *     Perfis envia: as linhas que estão no ecrã, depois de filtros e ordenação.
 */
const CreateShortlistSchema = z.object({
  name: z.string().min(1).max(200),
  pool_id: z.string().uuid().optional(),
  profile_id: z.string().uuid().optional(),
  limit: z.number().int().positive().max(200).optional(),
  player_ids: z.array(z.string().uuid()).min(1).max(200).optional(),
});

// ── GET /api/shortlists ──────────────────────────────────────────────────
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Filtra por owner — só vês as tuas shortlists.
  const { data: shortlists, error } = await supabase
    .from('shortlists')
    .select('id, name, pool_id, profile_id, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Contar jogadores por shortlist
  const ids = (shortlists ?? []).map((s) => s.id);
  const counts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: spData } = await supabase
      .from('shortlist_players')
      .select('shortlist_id')
      .in('shortlist_id', ids);
    for (const row of spData ?? []) {
      counts.set(row.shortlist_id, (counts.get(row.shortlist_id) ?? 0) + 1);
    }
  }

  const enriched = (shortlists ?? []).map((s) => ({
    ...s,
    player_count: counts.get(s.id) ?? 0,
  }));

  return NextResponse.json({ shortlists: enriched });
}

// ── POST /api/shortlists ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof CreateShortlistSchema>;
  try {
    body = CreateShortlistSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: `Input inválido: ${(err as Error).message}` }, { status: 400 });
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── Modo manual: só nome, cria shortlist vazia ──────────────────────
  if (!body.pool_id && !body.profile_id) {
    const { data: created, error: createErr } = await supabase
      .from('shortlists')
      .insert({
        name: body.name,
        pool_id: null,
        profile_id: null,
        owner_id: user.id,
      })
      .select('id, name, created_at')
      .single();

    if (createErr || !created) {
      return NextResponse.json(
        { error: `Falha a criar shortlist: ${createErr?.message ?? 'desconhecido'}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, shortlist: { ...created, player_count: 0 } }, { status: 201 });
  }

  // ── Modo gerada por perfil: ambos pool_id e profile_id obrigatórios ─
  if (!body.pool_id || !body.profile_id) {
    return NextResponse.json(
      { error: 'Para gerar por perfil, ambos `pool_id` e `profile_id` são obrigatórios.' },
      { status: 400 }
    );
  }

  // ── Modo selecção: guarda os jogadores indicados ───────────────────
  //    O score e a posição no perfil vêm de profile_scores — não é preciso
  //    recalcular a pool, que era o que tornava este botão lento.
  if (body.player_ids) {
    const playerIds = Array.from(new Set(body.player_ids));

    const { data: scoreRows, error: scoresErr } = await supabase
      .from('profile_scores')
      .select('player_id, score, rank')
      .eq('pool_id', body.pool_id)
      .eq('profile_id', body.profile_id)
      .in('player_id', playerIds);
    if (scoresErr) return NextResponse.json({ error: scoresErr.message }, { status: 500 });
    const scoreByPlayer = new Map((scoreRows ?? []).map((r) => [r.player_id, r]));

    // Só jogadores que existem nesta pool.
    const { data: validRows, error: validErr } = await supabase
      .from('players')
      .select('id')
      .eq('pool_id', body.pool_id)
      .in('id', playerIds);
    if (validErr) return NextResponse.json({ error: validErr.message }, { status: 500 });
    const valid = new Set((validRows ?? []).map((r) => r.id));
    const kept = playerIds.filter((id) => valid.has(id));
    if (kept.length === 0) {
      return NextResponse.json({ error: 'Nenhum dos jogadores pertence a esta pool.' }, { status: 400 });
    }

    const { data: createdSel, error: createSelErr } = await supabase
      .from('shortlists')
      .insert({ name: body.name, pool_id: body.pool_id, profile_id: body.profile_id, owner_id: user.id })
      .select('id, name, created_at')
      .single();
    if (createSelErr || !createdSel) {
      return NextResponse.json(
        { error: `Falha a criar shortlist: ${createSelErr?.message ?? 'desconhecido'}` },
        { status: 500 }
      );
    }

    const selRows = kept.map((id) => ({
      shortlist_id: createdSel.id,
      player_id: id,
      snapshot_score: scoreByPlayer.get(id)?.score ?? null,
      snapshot_rank: scoreByPlayer.get(id)?.rank ?? null,
    }));
    const { error: selErr } = await supabase.from('shortlist_players').insert(selRows);
    if (selErr) {
      await supabase.from('shortlists').delete().eq('id', createdSel.id);
      return NextResponse.json({ error: `Falha a adicionar jogadores: ${selErr.message}` }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, shortlist: { ...createdSel, player_count: selRows.length } },
      { status: 201 }
    );
  }

  // Carregar perfil
  const profileData = await loadProfile(supabase, body.profile_id);
  if (!profileData) return NextResponse.json({ error: 'Perfil não encontrado.' }, { status: 404 });

  // Aplicar scoring
  const { players, stats, directions } = await loadPoolData(supabase, body.pool_id);
  const result = scoreProfile({
    pool_id: body.pool_id,
    profile: profileData.profile,
    players,
    stats,
    metric_directions: directions,
  });

  const limit = body.limit ?? 30;
  const top = result.ranked.slice(0, limit);

  // Criar shortlist com owner_id
  const { data: created, error: createErr } = await supabase
    .from('shortlists')
    .insert({
      name: body.name,
      pool_id: body.pool_id,
      profile_id: body.profile_id,
      owner_id: user.id,
    })
    .select('id, name, created_at')
    .single();

  if (createErr || !created) {
    return NextResponse.json(
      { error: `Falha a criar shortlist: ${createErr?.message ?? 'desconhecido'}` },
      { status: 500 }
    );
  }

  // Adicionar jogadores
  const entries = buildSnapshotEntries(top);
  if (entries.length > 0) {
    const rows = entries.map((e) => ({
      shortlist_id: created.id,
      player_id: e.player_id,
      snapshot_score: e.snapshot_score,
      snapshot_rank: e.snapshot_rank,
    }));
    const { error: spErr } = await supabase.from('shortlist_players').insert(rows);
    if (spErr) {
      // Rollback
      await supabase.from('shortlists').delete().eq('id', created.id);
      return NextResponse.json(
        { error: `Falha a adicionar jogadores: ${spErr.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { ok: true, shortlist: { ...created, player_count: entries.length } },
    { status: 201 }
  );
}