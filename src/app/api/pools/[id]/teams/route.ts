import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

// GET /api/pools/[id]/teams
// Devolve { teams: [...] } com os clubes daquele pool, ordenados.
//
// A equipa de um jogador é o `team_in_period` — o clube por quem jogou NAQUELA
// competição. O `current_team` é onde está inscrito, que para emprestados é
// outro clube; usá-lo inflacionava a lista (40 clubes numa Liga 2 de 18) e
// atribuía jogadores ao clube errado.
//
// Até 11/11/2026 esta rota contava por `current_team` e escondia os intrusos
// com uma heurística de mediana. Com a coluna certa a heurística é desnecessária:
// as contagens dão exactamente o número de clubes da prova.
export async function GET(_: NextRequest, { params }: Params) {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  // Paginar para evitar o limite implícito de 1000 linhas do PostgREST —
  // pools como CdP excedem 1000 jogadores e equipas inteiras ficavam fora.
  const counts = new Map<string, number>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: page, error } = await supabase
      .from('players')
      .select('team_in_period, current_team')
      .eq('pool_id', id)
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!page || page.length === 0) break;
    for (const row of page) {
      // Recurso ao current_team só quando o export não trouxe o clube do período.
      const team = (row.team_in_period ?? row.current_team ?? '').trim();
      if (!team) continue;
      counts.set(team, (counts.get(team) ?? 0) + 1);
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }

  const teams = Array.from(counts.keys()).sort((a, b) => a.localeCompare(b, 'pt'));

  return NextResponse.json({ teams, counts: Object.fromEntries(counts) });
}
