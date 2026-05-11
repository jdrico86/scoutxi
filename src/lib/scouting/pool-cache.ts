/**
 * Cache em memória de processo, TTL curto.
 *
 * Usado por /api/scout/pool-data para evitar refazer o paginated fetch a
 * Supabase quando o mesmo pool é pedido várias vezes em <1min.
 *
 * Limitação conhecida em produção (Netlify Functions/Lambda):
 *   - Cache vive enquanto o container Lambda estiver warm (~5-15min idle).
 *   - Containers são killed em deploys e podem ser escalados em paralelo
 *     (cada réplica tem o seu cache).
 *   - Para um projecto single-user/small-team isto é aceitável: o cliente
 *     já tem o seu próprio cache em React state, este é só um boost
 *     marginal para refresh/reload da página.
 *
 * Não usar para dados sensíveis a staleness — invalidação é só por TTL.
 */
const TTL_MS = 60_000;

type Entry<T> = { data: T; expiresAt: number };

const cache = new Map<string, Entry<unknown>>();

export function getCached<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.data as T;
}

export function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
}

export function invalidateCached(key: string): void {
  cache.delete(key);
}
