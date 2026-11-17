import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Endpoint que recebe o callback do magic link Supabase.
 *
 * O Supabase envia o utilizador para esta URL com `?code=<token>` no query string.
 * Trocamos o code por uma sessão e fazemos set dos cookies adequados.
 *
 * Depois redireccionamos para `next` (rota original, antes do login) ou para a home.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  // Redireccionamentos relativos, sem domínio: ver a nota em /auth/confirm.
  const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
  const code = searchParams.get('code');
  const wanted = searchParams.get('next') || '/';
  const next = wanted.startsWith('/') && !wanted.startsWith('//') ? wanted : '/';

  if (!code) {
    return go('/login?error=missing_code');
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return go(`/login?error=${encodeURIComponent(error.message)}`);
  }

  return go(next);
}