'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PerfisGuardados } from './PerfisGuardados';
import { PesquisaAvancada } from './PesquisaAvancada';

function ProfilesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isAvancada = searchParams.get('tab') === 'avancada';

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-6xl px-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Perfis de scouting</h1>

        <div className="mb-6 mt-4 flex gap-1 border-b border-neutral-200">
          <TabButton active={!isAvancada} onClick={() => router.replace('/profiles')}>
            Perfis
          </TabButton>
          <TabButton
            active={isAvancada}
            onClick={() => router.replace('/profiles?tab=avancada')}
          >
            Pesquisa avançada
          </TabButton>
        </div>

        {isAvancada ? <PesquisaAvancada /> : <PerfisGuardados />}
      </div>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-2 text-sm font-medium transition-colors ${
        active ? 'text-neutral-900' : 'text-neutral-500 hover:text-neutral-700'
      }`}
    >
      {children}
      {active && (
        <span className="absolute bottom-[-1px] left-0 right-0 h-0.5 bg-neutral-900" />
      )}
    </button>
  );
}

export default function ProfilesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-50 py-10">
          <div className="mx-auto max-w-6xl px-6 text-sm text-neutral-500">A carregar…</div>
        </main>
      }
    >
      <ProfilesPageContent />
    </Suspense>
  );
}
