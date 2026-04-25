import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

// GET /api/pools/[id]/teams
// Devolve { teams: [...] } com nomes únicos de current_team naquele pool, ordenados.
//
// Filtro de ruído: as competições têm tipicamente 16-22 clubes com planteis de
// 15-25 jogadores cada. Mas o `current_team` é o clube atual dos jogadores, não
// o clube em que jogaram nessa competição — por isso aparecem "intrusos" (jogadores
// que entretanto subiram, desceram ou foram para sub-19/estrangeiro).
//
// Heurística: ordenar clubes por contagem de jogadores, pegar nos top 20 (proxy
// para "núcleo" do pool), calcular a mediana desses, e exigir pelo menos 50% dela.
// Funciona em CP, Liga 3 e Sub-23 onde as equipas reais ficam todas no top-N
// e os intrusos ficam todos com contagens baixas.
export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase
    .from('players')
    .select('current_team')
    .eq('pool_id', id)
    .not('current_team', 'is', null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Contar jogadores por clube
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    if (!row.current_team) continue;
    counts.set(row.current_team, (counts.get(row.current_team) ?? 0) + 1);
  }

  // Ordenar contagens descendente, pegar nos top 20
  const sortedCounts = Array.from(counts.values()).sort((a, b) => b - a);
  const topN = sortedCounts.slice(0, 20);

  // Mediana do top-20
  let median = 0;
  if (topN.length > 0) {
    const sortedAsc = [...topN].sort((a, b) => a - b);
    const mid = Math.floor(sortedAsc.length / 2);
    median = sortedAsc.length % 2 === 0
      ? (sortedAsc[mid - 1] + sortedAsc[mid]) / 2
      : sortedAsc[mid];
  }
  const threshold = Math.max(1, Math.floor(median * 0.5));

  // Filtrar
  const teams = Array.from(counts.entries())
    .filter(([, n]) => n >= threshold)
    .map(([name]) => name)
    .sort();

  return NextResponse.json({ teams, threshold, median });
}