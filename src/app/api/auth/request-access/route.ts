import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { ACCESS_ROLES } from '@/lib/auth/roles';

export const runtime = 'nodejs';

const Schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(ACCESS_ROLES),
  club: z.string().trim().max(120).optional().default(''),
  // Campo escondido no formulário: uma pessoa deixa-o vazio, um robô preenche-o.
  website: z.string().optional().default(''),
});

/**
 * POST /api/auth/request-access — público, sem sessão.
 *
 * Regista um pedido de acesso (um por email). Não cria conta nem dá acesso:
 * isso só acontece quando o administrador aprova.
 *
 *   200 { status: 'received' } — pedido registado (ou já existia)
 *   200 { status: 'already' }  — o email já tem acesso; é só entrar
 *   400 { error }              — dados inválidos
 */
export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Confirma o nome, o email e a função.' }, { status: 400 });
  }
  const { name, email, role, club, website } = parsed.data;
  // Robô: responde como se tivesse corrido bem, sem gravar.
  if (website) return NextResponse.json({ status: 'received' });

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: allowed, error: allowedError } = await supabase
    .from('allowed_users')
    .select('email')
    .eq('email', email)
    .maybeSingle();
  if (allowedError) return NextResponse.json({ error: allowedError.message }, { status: 500 });
  if (allowed) return NextResponse.json({ status: 'already' });

  const { data: existing, error: existingError } = await supabase
    .from('access_requests')
    .select('id, status')
    .eq('email', email)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

  const now = new Date().toISOString();
  if (!existing) {
    const { error } = await supabase.from('access_requests').insert({ email, name, role, club: club || null, status: 'pending' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if ((existing as { status: string }).status === 'pending') {
    // Repetiu o pedido: actualiza os dados, mantém a data do primeiro.
    const { error } = await supabase
      .from('access_requests')
      .update({ name, role, club: club || null, updated_at: now })
      .eq('email', email);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Pedido já decidido (recusado ou acesso retirado): fica como está. A
  // resposta é a mesma, para não revelar a decisão a quem escreve o email.
  return NextResponse.json({ status: 'received' });
}
