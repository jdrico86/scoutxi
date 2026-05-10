import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * POST /api/scout/save-as-profile
 *
 * Cria um scouting_profile a partir de uma pesquisa avançada. Endpoint separado
 * do POST /api/profiles porque este aceita weights vazios (ad-hoc não tem score
 * composto), enquanto o /api/profiles exige weights.entries.min(1) + soma 100.
 *
 * Em v1, só os filtros gerais (positions/min_age/max_age/min_minutes/on_loan)
 * são preservados. Filtros de métrica não cabem no schema actual de
 * scouting_profiles.filters — ficam de fora; o modal avisa o utilizador.
 */
const BodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  positions: z.array(z.string()).optional(),
  general_filters: z
    .object({
      min_age: z.number().int().nonnegative().optional(),
      max_age: z.number().int().positive().optional(),
      min_minutes: z.number().int().nonnegative().optional(),
      on_loan: z.boolean().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Input inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Construir filters a partir de positions + general_filters
  const filters: Record<string, unknown> = {};
  if (body.positions && body.positions.length > 0) filters.positions = body.positions;
  const gf = body.general_filters ?? {};
  if (gf.min_age != null) filters.min_age = gf.min_age;
  if (gf.max_age != null) filters.max_age = gf.max_age;
  if (gf.min_minutes != null) filters.min_minutes = gf.min_minutes;
  if (gf.on_loan != null) filters.on_loan = gf.on_loan;

  const weights = {
    entries: [] as Array<{ metric_code: string; weight: number }>,
    peer_group_positions: body.positions ?? [],
  };

  const { data, error } = await supabase
    .from('scouting_profiles')
    .insert({
      name: body.name,
      description: body.description ?? null,
      filters,
      weights,
      tags: ['ad_hoc'],
      owner_id: user.id,
    })
    .select('id, name')
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Falha a criar perfil: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, profile: data }, { status: 201 });
}
