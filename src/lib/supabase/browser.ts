'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Cliente Supabase para usar em Client Components.
 * Mantém a sessão sincronizada via cookies do browser.
 *
 * Usar este (não o `client.ts` antigo) sempre que um Client Component
 * precisar de saber o utilizador autenticado ou fazer auth (login, logout).
 */
export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase env vars (URL or ANON_KEY)');
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}