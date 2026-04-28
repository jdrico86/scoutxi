import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Endpoint que devolve info do utilizador actualmente autenticado.
 * Inclui flag `is_admin` lida da tabela `allowed_users`.
 *
 * Usado pelo frontend para decidir o que mostrar (ex: botão de Importar
 * só aparece a admins).
 *
 * Nota: usamos cliente sem tipos (não Database<>) porque a coluna `is_admin`
 * foi adicionada depois da última geração de types. Para evitar regenerar
 * agora, fazemos a query directamente.
 *
 * Returns:
 *   200 { user: { id, email, is_admin } }
 *   401 { error: 'Não autenticado' }
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from('allowed_users')
    .select('is_admin')
    .eq('email', user.email ?? '')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const isAdmin = (data as { is_admin?: boolean } | null)?.is_admin ?? false;

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      is_admin: isAdmin,
    },
  });
}