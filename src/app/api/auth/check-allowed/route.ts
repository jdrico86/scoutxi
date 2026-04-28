import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const runtime = 'nodejs';

const Schema = z.object({
  email: z.string().email(),
});

/**
 * Endpoint público (não exige sessão) que valida se um email está autorizado
 * a fazer login. Chamado pela página /login antes de pedir o magic link.
 *
 * Usa service role para conseguir ler `allowed_users` (que tem RLS activo).
 *
 * Devolve:
 *   200 { allowed: true } — email está na whitelist
 *   403 { error: '...' }  — email não autorizado
 *   400 { error: '...' }  — input inválido
 */
export async function POST(req: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: `Input inválido: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const email = body.email.trim().toLowerCase();

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from('allowed_users')
    .select('email')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { error: 'Email não autorizado. Pede acesso ao administrador.' },
      { status: 403 }
    );
  }

  return NextResponse.json({ allowed: true });
}