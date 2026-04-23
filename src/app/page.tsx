import { supabase } from '@/lib/supabase/client';
import HomeShortcuts from './HomeShortcuts';

export default async function HomePage() {
  // Queries paralelas (server-side, como estava antes)
  const [poolsResult, playersResult, profilesResult, shortlistsResult] = await Promise.all([
    supabase.from('pools').select('*', { count: 'exact', head: true }),
    supabase.from('players').select('*', { count: 'exact', head: true }),
    supabase.from('scouting_profiles').select('*', { count: 'exact', head: true }),
    supabase.from('shortlists').select('*', { count: 'exact', head: true }),
  ]);

  const poolsCount = poolsResult.count ?? 0;
  const playersCount = playersResult.count ?? 0;
  const profilesCount = profilesResult.count ?? 0;
  const shortlistsCount = shortlistsResult.count ?? 0;

  const hasError =
    poolsResult.error || playersResult.error || profilesResult.error || shortlistsResult.error;

  if (hasError) {
    return (
      <main className="p-10">
        <div className="mx-auto max-w-4xl rounded-lg border border-red-200 bg-red-50 p-6">
          <h1 className="text-lg font-semibold text-red-900">Erro ao ler do Supabase</h1>
          <pre className="mt-3 overflow-x-auto text-xs text-red-800">
            {JSON.stringify(
              {
                pools: poolsResult.error,
                players: playersResult.error,
                profiles: profilesResult.error,
                shortlists: shortlistsResult.error,
              },
              null,
              2
            )}
          </pre>
        </div>
      </main>
    );
  }

  return (
    <main className="py-10">
      <div className="mx-auto max-w-5xl px-6">
        <header className="mb-10">
          <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
            Scout XI
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Plataforma de scouting para o futebol português. Importa dados Wyscout,
            aplica perfis editáveis, guarda listas de prospects.
          </p>
        </header>

        {/* Stats */}
        <section className="mb-10 grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Pools" value={poolsCount} hint="importações de dados" />
          <StatCard label="Jogadores" value={playersCount} hint="no universo total" />
          <StatCard label="Perfis" value={profilesCount} hint="seed + criados" />
          <StatCard label="Shortlists" value={shortlistsCount} hint="listas activas" />
        </section>

        {/* Atalhos */}
        <HomeShortcuts />
      </div>
    </main>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-3xl font-semibold tracking-tight text-neutral-900">
        {value.toLocaleString('pt-PT')}
      </div>
      <div className="mt-1 text-xs text-neutral-400">{hint}</div>
    </div>
  );
}