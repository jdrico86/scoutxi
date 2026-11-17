'use client';

/**
 * Utilizadores (só administradores): pedidos de acesso à espera, quem já tem
 * acesso e os pedidos recusados. Aprovar cria a conta; a pessoa entra depois
 * pelo link mágico da página de entrada.
 */

import { useCallback, useEffect, useState } from 'react';

type Request = {
  id: string;
  email: string;
  name: string;
  role: string | null;
  club: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  created_at: string;
  decided_at: string | null;
};
type AllowedUser = { email: string; is_admin: boolean; added_at: string | null; name: string | null; role: string | null; club: string | null };
type Payload = { pending: Request[]; rejected: Request[]; users: AllowedUser[] };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-PT') : '—');
const BTN = 'rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50';

/** Mensagem para avisar a pessoa de que já pode entrar. */
function welcome(name: string | null, origin: string): { subject: string; body: string } {
  return {
    subject: 'O teu acesso ao Scout XI',
    body: `Olá${name ? ` ${name.split(' ')[0]}` : ''},\n\nO teu acesso ao Scout XI está aprovado. Entra em ${origin}/login com este email: recebes um link para entrar, sem palavra-passe.\n\nQualquer dúvida ou sugestão, diz-me.`,
  };
}

export default function UsersPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [justApproved, setJustApproved] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users');
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'Erro a carregar.');
      else {
        setData(json as Payload);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Carregamento inicial: a função só mexe no estado depois de a rota responder.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const act = async (action: 'approve' | 'reject' | 'revoke', email: string) => {
    if (action === 'revoke' && !window.confirm(`Retirar o acesso a ${email}?`)) return;
    setBusy(email);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, email }),
      });
      const json = await res.json();
      if (!res.ok) setError(json.error ?? 'Não foi possível.');
      else if (action === 'approve') setJustApproved((prev) => [...prev, email]);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copy = async (email: string, name: string | null) => {
    try {
      await navigator.clipboard.writeText(welcome(name, window.location.origin).body);
      setCopied(email);
    } catch {
      setError('Não consegui copiar a mensagem.');
    }
  };

  const mailto = (email: string, name: string | null) => {
    const m = welcome(name, typeof window === 'undefined' ? '' : window.location.origin);
    return `mailto:${email}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}`;
  };

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-4xl px-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Utilizadores</h1>
        <p className="mt-1 text-sm text-neutral-600">Pedidos de acesso e quem já pode entrar.</p>

        {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {!data && !error && <p className="mt-6 text-sm text-neutral-500">A carregar…</p>}

        {data && (
          <div className="mt-6 space-y-6">
            <section className="rounded-lg border border-neutral-200 bg-white">
              <h2 className="border-b border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-900">
                Pedidos à espera <span className="font-normal text-neutral-500">({data.pending.length})</span>
              </h2>
              {data.pending.length === 0 ? (
                <p className="px-5 py-4 text-sm text-neutral-500">Nenhum pedido à espera.</p>
              ) : (
                <ul>
                  {data.pending.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-5 py-3 first:border-t-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-neutral-900">{r.name}</div>
                        <div className="text-xs text-neutral-600">{[r.role, r.club].filter(Boolean).join(' · ') || '—'}</div>
                        <div className="text-xs text-neutral-500">
                          {r.email} · pedido a {day(r.created_at)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => act('approve', r.email)}
                          disabled={busy === r.email}
                          className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                        >
                          Aprovar
                        </button>
                        <button type="button" onClick={() => act('reject', r.email)} disabled={busy === r.email} className={BTN}>
                          Recusar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-neutral-200 bg-white">
              <h2 className="border-b border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-900">
                Com acesso <span className="font-normal text-neutral-500">({data.users.length})</span>
              </h2>
              <ul>
                {data.users.map((u) => (
                  <li key={u.email} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-5 py-3 first:border-t-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-900">
                        {u.name ?? u.email}
                        {u.is_admin && <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs font-normal text-neutral-600">administrador</span>}
                      </div>
                      <div className="text-xs text-neutral-600">{[u.role, u.club].filter(Boolean).join(' · ')}</div>
                      <div className="text-xs text-neutral-500">
                        {u.name ? `${u.email} · ` : ''}desde {day(u.added_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {justApproved.includes(u.email) && (
                        <>
                          <a href={mailto(u.email, u.name)} className={BTN}>
                            Avisar por email
                          </a>
                          <button type="button" onClick={() => copy(u.email, u.name)} className={BTN}>
                            {copied === u.email ? 'Copiada' : 'Copiar mensagem'}
                          </button>
                        </>
                      )}
                      {!u.is_admin && (
                        <button type="button" onClick={() => act('revoke', u.email)} disabled={busy === u.email} className={BTN}>
                          Retirar acesso
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {data.rejected.length > 0 && (
              <section className="rounded-lg border border-neutral-200 bg-white">
                <h2 className="border-b border-neutral-200 px-5 py-3 text-sm font-semibold text-neutral-900">
                  Recusados ou sem acesso <span className="font-normal text-neutral-500">({data.rejected.length})</span>
                </h2>
                <ul>
                  {data.rejected.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-5 py-3 first:border-t-0">
                      <div className="min-w-0">
                        <div className="text-sm text-neutral-800">{r.name}</div>
                        <div className="text-xs text-neutral-500">
                          {[r.role, r.club, r.email].filter(Boolean).join(' · ')} · {r.status === 'revoked' ? 'acesso retirado' : 'recusado'} a {day(r.decided_at)}
                        </div>
                      </div>
                      <button type="button" onClick={() => act('approve', r.email)} disabled={busy === r.email} className={BTN}>
                        Aprovar
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
