import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Chegada do link mágico.
 *
 * Aceita as duas formas que o link pode ter:
 *
 *   ?token_hash=…&type=email — o link leva a prova consigo. Funciona em
 *     qualquer navegador ou aparelho, mesmo que não seja aquele onde o link
 *     foi pedido. É o que o modelo de email deve enviar.
 *
 *   ?code=… — forma antiga (PKCE). Só funciona no mesmo navegador onde o link
 *     foi pedido, porque depende de um valor lá guardado. Mantida para os
 *     links enviados com o modelo de email antigo.
 *
 * Em caso de falha volta à página de entrada com o motivo.
 *
 * Os redireccionamentos são relativos ("/", "/login?…"), sem domínio. No
 * Netlify o endereço que a rota vê é o interno do deploy
 * (main--scoutxi.netlify.app) e não o que a pessoa está a usar; um
 * redireccionamento com esse domínio levava-a para outro site, onde a sessão
 * acabada de criar não existe.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = (searchParams.get('type') ?? 'email') as EmailOtpType;
  const code = searchParams.get('code');
  // Só caminhos internos: nunca redireccionar para fora a pedido da URL.
  const wanted = searchParams.get('next') || '/';
  const next = wanted.startsWith('/') && !wanted.startsWith('//') ? wanted : '/';

  const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });
  const fail = (reason: string) => go(`/login?error=${encodeURIComponent(reason)}`);

  const supabase = await createSupabaseServerClient();
  if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return fail(error.message);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail(error.message);
  } else {
    return fail('missing_code');
  }
  return go(next);
}
