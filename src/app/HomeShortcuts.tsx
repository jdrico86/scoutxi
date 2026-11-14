'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';

export default function HomeShortcuts() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setIsAdmin(json.user?.is_admin ?? false);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Só o administrador vê este bloco. Os atalhos para Perfis e Shortlists
  // saíram: repetiam os mesmos itens da barra lateral.
  if (!isAdmin) return null;

  return (
    <section>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
        Administração
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Shortcut
          icon={Upload}
          label="Importar dados"
          description="Fazer upload de ficheiros Wyscout XLSX."
          onClick={() => router.push('/import')}
        />
        <MissingScores />
      </div>
    </section>
  );
}

/**
 * Calcula os scores dos perfis nas pools que ainda não os têm, uma pool de
 * cada vez. A evolução entre épocas precisa deles nas épocas antigas. Cada pool
 * leva 6 a 20 segundos: correr em localhost, onde não há limite de tempo.
 */
function MissingScores() {
  const [missing, setMissing] = useState<Array<{ id: string; name: string }> | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/recalculate-scores')
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setMissing(j.missing ?? []);
      })
      .catch(() => {
        if (!cancelled) setMissing([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!missing || (missing.length === 0 && !progress)) return null;

  const run = async () => {
    setBusy(true);
    const failed: string[] = [];
    for (let i = 0; i < missing.length; i++) {
      setProgress(`A calcular ${i + 1} de ${missing.length}: ${missing[i].name}…`);
      try {
        const res = await fetch('/api/admin/recalculate-scores', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pool_id: missing[i].id }),
        });
        if (!res.ok) failed.push(missing[i].name);
      } catch {
        failed.push(missing[i].name);
      }
    }
    setProgress(
      failed.length === 0
        ? `Feito: ${missing.length} pools calculadas.`
        : `Falharam ${failed.length}: ${failed.join(', ')}. Tenta em localhost.`
    );
    setMissing(missing.filter((m) => failed.includes(m.name)));
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5 text-left">
      <div className="text-sm font-medium text-neutral-900">Scores em falta</div>
      <div className="mt-1 text-xs text-neutral-500">
        {progress ??
          `${missing.length} pools sem scores de perfis. São precisos para a evolução entre épocas.`}
      </div>
      {missing.length > 0 && (
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? 'A calcular…' : 'Calcular agora'}
        </button>
      )}
    </div>
  );
}

function Shortcut({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-lg border border-neutral-200 bg-white p-5 text-left transition-colors hover:border-neutral-300"
    >
      <Icon className="h-5 w-5 text-neutral-500 group-hover:text-neutral-900" strokeWidth={1.8} />
      <div className="mt-3 text-sm font-medium text-neutral-900">{label}</div>
      <div className="mt-1 text-xs text-neutral-500">{description}</div>
    </button>
  );
}