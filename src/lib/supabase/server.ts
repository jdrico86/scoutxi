import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';

/**
 * Cliente Supabase para usar em Server Components e Route Handlers.
 * Lê cookies da request actual e mantém sessão sincronizada.
 *
 * Usar SEMPRE em endpoints que precisam de saber o utilizador autenticado,
 * em vez do `createClient` directo do '@supabase/supabase-js' (que não conhece sessão).
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase env vars (URL or ANON_KEY)');
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components não podem fazer set de cookies — ignorar.
          // O middleware já trata da renovação da sessão.
        }
      },
    },
  });
}

/**
 * Helper para obter o utilizador autenticado em Route Handlers.
 * Devolve null se não houver sessão válida.
 */
export async function getAuthUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}