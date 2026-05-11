import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * Cliente Supabase para usar em Client Components.
 * Mantém a sessão sincronizada via cookies do browser.
 *
 * Usar este (não o `client.ts` antigo) sempre que um Client Component
 * precisar de saber o utilizador autenticado ou fazer auth (login, logout).
 *
 * Singleton: várias chamadas devolvem a mesma instância. Sem isto, componentes
 * que chamam esta função no corpo (Sidebar, Login) criam um cliente novo a
 * cada render. Cada cliente regista um listener onAuthStateChange e tenta
 * adquirir o Web Lock "lock:sb-...-auth-token" em getUser(). Contention →
 * "lock was released because another request stole it".
 */
let clientSingleton: SupabaseClient<Database> | undefined;

export function createSupabaseBrowserClient() {
  if (clientSingleton) return clientSingleton;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase env vars (URL or ANON_KEY)');
  }

  clientSingleton = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  return clientSingleton;
}
