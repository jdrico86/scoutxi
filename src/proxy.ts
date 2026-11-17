import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { isApprovedUser } from '@/lib/auth/approval';

/**
 * Middleware Next.js que:
 * 1. Refresca a sessão Supabase a cada request (passa cookies actualizados).
 * 2. Protege rotas: se não há sessão, redirecciona para /login.
 *
 * 3. Exige que a conta esteja aprovada: quem pediu acesso e ainda espera pela
 *    aprovação tem sessão mas não vê nada.
 *
 * Rotas públicas (não exigem login):
 * - /login
 * - /pedir-acesso (formulário de pedido de acesso)
 * - /auth/callback e /auth/confirm (chegada do link mágico)
 * - assets estáticos (excluídos no matcher mais abaixo)
 *
 * Tudo o resto exige sessão válida.
 */
export async function proxy(request: NextRequest) {
  // O /auth/callback tem de chegar ao route handler com os cookies intactos.
  // Correr getUser() aqui, numa request que ainda não tem sessão, faz o cliente
  // Supabase reescrever os cookies de auth — e leva à frente o
  // `sb-<ref>-auth-token-code-verifier` que o PKCE guardou quando o magic link
  // foi pedido. O exchangeCodeForSession a seguir falha com
  // "PKCE code verifier not found in storage".
  // Tratar a rota como pública não chega: é preciso sair ANTES de criar o cliente.
  if (request.nextUrl.pathname.startsWith('/auth/callback') || request.nextUrl.pathname.startsWith('/auth/confirm')) {
    return NextResponse.next({ request: { headers: request.headers } });
  }

  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Sem env vars não dá para validar. Em vez de partir tudo,
    // deixa passar — desenvolvimento sem auth configurado.
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request: { headers: request.headers },
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // IMPORTANT: getUser() re-valida o token. Não usar getSession() em middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Rotas públicas
  const isPublicRoute =
    pathname.startsWith('/login') ||
    pathname.startsWith('/pedir-acesso') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/auth/confirm') ||
    pathname.startsWith('/api/auth/');

  // Sem sessão → redireccionar para /login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Com sessão mas sem aprovação → nada do produto. As rotas de dados respondem
  // 403; as páginas levam ao pedido de acesso.
  const approved = user ? await isApprovedUser(user) : false;
  if (user && !approved && !isPublicRoute) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Conta sem acesso aprovado.' }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = '/pedir-acesso';
    url.search = '?estado=espera';
    return NextResponse.redirect(url);
  }

  // Com sessão aprovada e ainda na página de login → ir para a home
  if (user && approved && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};