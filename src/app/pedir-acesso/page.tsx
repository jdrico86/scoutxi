'use client';

/**
 * Página pública para pedir acesso ao Scout XI.
 *
 * O pedido fica à espera até o administrador o aprovar; só então a pessoa
 * consegue entrar, pelo link mágico da página de login.
 *
 * Quem tem sessão mas ainda não foi aprovado é trazido para aqui
 * (?estado=espera) em vez de ver o produto.
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ACCESS_ROLES } from '@/lib/auth/roles';

const FIELD =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none disabled:opacity-50';
const LABEL = 'block text-sm font-medium text-neutral-700';

function RequestForm() {
  const router = useRouter();
  const waiting = useSearchParams().get('estado') === 'espera';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [club, setClub] = useState('');
  const [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'received' | 'already' | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, role, club, website }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'Não foi possível registar o pedido.');
      else setResult(json.status === 'already' ? 'already' : 'received');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await createSupabaseBrowserClient().auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6 py-10">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">Scout XI</h1>
          <p className="mt-1 text-sm text-neutral-500">Pedir acesso</p>
        </div>

        {waiting && !result && (
          <div className="mb-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            A tua conta ainda não tem acesso aprovado. Se já pediste, é só aguardar.{' '}
            <button type="button" onClick={signOut} className="font-medium underline">
              Sair
            </button>
          </div>
        )}

        {result === 'received' ? (
          <div className="text-center">
            <p className="text-sm text-neutral-800">Pedido recebido.</p>
            <p className="mt-2 text-xs text-neutral-500">
              Estamos em fase de testes e os acessos são dados um a um. Quando o teu for aprovado, entras com este
              email na página de entrada.
            </p>
          </div>
        ) : result === 'already' ? (
          <div className="text-center">
            <p className="text-sm text-neutral-800">Este email já tem acesso.</p>
            <Link href="/login" className="mt-3 inline-block text-sm font-medium text-neutral-900 underline">
              Entrar
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="ra-name" className={LABEL}>Nome</label>
              <input id="ra-name" type="text" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} className={FIELD} />
            </div>
            <div>
              <label htmlFor="ra-email" className={LABEL}>Email</label>
              <input id="ra-email" type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="o-teu@email.com" disabled={busy} className={FIELD} />
            </div>
            <div>
              <label htmlFor="ra-role" className={LABEL}>Função</label>
              <select id="ra-role" required value={role} onChange={(e) => setRole(e.target.value)} disabled={busy} className={FIELD}>
                <option value="">Escolher…</option>
                {ACCESS_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ra-club" className={LABEL}>
                Clube ou organização <span className="font-normal text-neutral-400">(opcional)</span>
              </label>
              <input id="ra-club" type="text" maxLength={120} value={club} onChange={(e) => setClub(e.target.value)} disabled={busy} className={FIELD} />
            </div>
            {/* Armadilha para robôs: invisível para pessoas. */}
            <div className="hidden" aria-hidden="true">
              <label htmlFor="ra-website">Website</label>
              <input id="ra-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>}

            <button
              type="submit"
              disabled={busy || !name || !email || !role}
              className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? 'A enviar…' : 'Pedir acesso'}
            </button>
            <p className="text-center text-xs text-neutral-500">
              Já tens acesso?{' '}
              <Link href="/login" className="font-medium text-neutral-900 underline">
                Entrar
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function RequestAccessPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-neutral-500">A carregar…</div>}>
      <RequestForm />
    </Suspense>
  );
}
