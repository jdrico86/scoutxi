/**
 * Quem tem acesso ao produto.
 *
 * Uma sessão válida não chega: qualquer pessoa pode pedir acesso e, enquanto o
 * pedido não for aprovado, não pode ver nada. A aprovação fica marcada na
 * própria conta (`app_metadata.approved`, que só o servidor consegue escrever)
 * e é verificada em cada pedido, no proxy e nas rotas.
 *
 * Contas antigas sem a marca são confirmadas na tabela `allowed_users`.
 */
import { createClient } from '@supabase/supabase-js';

type UserLike = { email?: string | null; app_metadata?: Record<string, unknown> | null };

/** Resultados da confirmação pela tabela, guardados por pouco tempo. */
const cache = new Map<string, { approved: boolean; until: number }>();
const CACHE_MS = 60_000;

export async function isApprovedUser(user: UserLike | null | undefined): Promise<boolean> {
  if (!user) return false;
  if (user.app_metadata?.approved === true) return true;
  // Acesso retirado: a marca fica a `false` e não se vai à tabela.
  if (user.app_metadata?.approved === false) return false;

  const email = (user.email ?? '').trim().toLowerCase();
  if (!email) return false;
  const hit = cache.get(email);
  if (hit && hit.until > Date.now()) return hit.approved;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.from('allowed_users').select('email').eq('email', email).maybeSingle();
  if (error) return false; // na dúvida, sem acesso
  const approved = Boolean(data);
  cache.set(email, { approved, until: Date.now() + CACHE_MS });
  return approved;
}
