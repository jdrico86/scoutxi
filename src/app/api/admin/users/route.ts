import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type RequestRow = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  club: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  created_at: string;
  decided_at: string | null;
};
type AllowedRow = { email: string; added_at: string | null; notes: string | null; is_admin: boolean };

/** Cliente de serviço e email do administrador, ou a resposta de erro. */
async function adminContext(): Promise<{ supabase: SupabaseClient; adminEmail: string } | { response: NextResponse }> {
  const user = await getAuthUser();
  if (!user) return { response: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { response: NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 }) };
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const adminEmail = (user.email ?? '').toLowerCase();
  const { data } = await supabase.from('allowed_users').select('is_admin').eq('email', adminEmail).maybeSingle();
  if (!(data as { is_admin?: boolean } | null)?.is_admin) {
    return { response: NextResponse.json({ error: 'Apenas administradores.' }, { status: 403 }) };
  }
  return { supabase, adminEmail };
}

/**
 * GET /api/admin/users — pedidos de acesso e quem já tem acesso.
 */
export async function GET() {
  const ctx = await adminContext();
  if ('response' in ctx) return ctx.response;
  const { supabase } = ctx;

  const [requestsRes, allowedRes] = await Promise.all([
    supabase
      .from('access_requests')
      .select('id, email, name, role, club, status, created_at, decided_at')
      .order('created_at', { ascending: false })
      .order('id')
      .limit(1000),
    supabase.from('allowed_users').select('email, added_at, notes, is_admin').order('added_at', { ascending: false }).order('email').limit(1000),
  ]);
  const failure = requestsRes.error ?? allowedRes.error;
  if (failure) return NextResponse.json({ error: failure.message }, { status: 500 });

  const requests = (requestsRes.data ?? []) as RequestRow[];
  const byEmail = new Map(requests.map((r) => [r.email, r]));
  const users = ((allowedRes.data ?? []) as AllowedRow[]).map((u) => {
    const r = byEmail.get(u.email.toLowerCase());
    return {
      email: u.email,
      is_admin: u.is_admin,
      added_at: u.added_at,
      name: r?.name ?? null,
      role: r?.role ?? null,
      club: r?.club ?? null,
    };
  });

  return NextResponse.json({
    pending: requests.filter((r) => r.status === 'pending'),
    rejected: requests.filter((r) => r.status === 'rejected' || r.status === 'revoked'),
    users,
  });
}

const ActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'revoke']),
  email: z.string().trim().toLowerCase().email(),
});

/** Procura a conta de autenticação pelo email. */
async function findAuthUser(supabase: SupabaseClient, email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === email);
    if (hit) return { id: hit.id };
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * POST /api/admin/users { action, email }
 *
 *   approve — dá acesso: entra na lista de autorizados e a conta fica criada e
 *             marcada como aprovada. A pessoa entra depois pelo link mágico.
 *   reject  — recusa um pedido à espera.
 *   revoke  — retira o acesso a quem o tinha (nunca a administradores).
 */
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if ('response' in ctx) return ctx.response;
  const { supabase, adminEmail } = ctx;

  const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });
  const { action, email } = parsed.data;
  const now = new Date().toISOString();

  if (action === 'reject') {
    const { error } = await supabase
      .from('access_requests')
      .update({ status: 'rejected', decided_at: now, updated_at: now })
      .eq('email', email)
      .eq('status', 'pending');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'revoke') {
    if (email === adminEmail) return NextResponse.json({ error: 'Não podes retirar o teu próprio acesso.' }, { status: 400 });
    const { data: target } = await supabase.from('allowed_users').select('is_admin').eq('email', email).maybeSingle();
    if ((target as { is_admin?: boolean } | null)?.is_admin) {
      return NextResponse.json({ error: 'Não se retira o acesso a um administrador.' }, { status: 400 });
    }
    // Primeiro a marca na conta (é o que o servidor verifica), depois a lista.
    const account = await findAuthUser(supabase, email);
    if (account) {
      const { error } = await supabase.auth.admin.updateUserById(account.id, { app_metadata: { approved: false } });
      if (error) return NextResponse.json({ error: `Não consegui retirar o acesso: ${error.message}` }, { status: 500 });
    }
    const { error: delError } = await supabase.from('allowed_users').delete().eq('email', email);
    if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
    await supabase.from('access_requests').update({ status: 'revoked', decided_at: now, updated_at: now }).eq('email', email);
    return NextResponse.json({ ok: true });
  }

  // approve
  const { data: request } = await supabase.from('access_requests').select('name, role, club').eq('email', email).maybeSingle();
  const r = request as { name: string; role: string | null; club: string | null } | null;

  // A conta: criada já confirmada e marcada. Se já existir, só se marca.
  const existing = await findAuthUser(supabase, email);
  if (existing) {
    const { error } = await supabase.auth.admin.updateUserById(existing.id, { app_metadata: { approved: true } });
    if (error) return NextResponse.json({ error: `Não consegui aprovar a conta: ${error.message}` }, { status: 500 });
  } else {
    const { error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: { approved: true },
      user_metadata: r?.name ? { name: r.name } : undefined,
    });
    if (error) return NextResponse.json({ error: `Não consegui criar a conta: ${error.message}` }, { status: 500 });
  }

  const notes = r ? [r.name, r.role, r.club].filter(Boolean).join(' · ') : null;
  const { error: allowError } = await supabase
    .from('allowed_users')
    .upsert({ email, notes, is_admin: false }, { onConflict: 'email', ignoreDuplicates: true });
  if (allowError) return NextResponse.json({ error: allowError.message }, { status: 500 });

  const { error: reqError } = await supabase
    .from('access_requests')
    .update({ status: 'approved', decided_at: now, updated_at: now })
    .eq('email', email);
  if (reqError) return NextResponse.json({ error: reqError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
