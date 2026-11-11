import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Middleware Next.js que:
 * 1. Refresca a sessão Supabase a cada request (passa cookies actualizados).
 * 2. Protege rotas: se não há sessão, redirecciona para /login.
 *
 * Rotas públicas (não exigem login):
 * - /login
 * - /auth/callback (redirect do magic link)
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
  if (request.nextUrl.pathname.startsWith('/auth/callback')) {
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
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/api/auth/');

  // Sem sessão → redireccionar para /login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Com sessão e ainda na página de login → ir para a home
  if (user && pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next|favicon.ico).*)'],
};