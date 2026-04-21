import { supabase } from '@/lib/supabase/client'

export default async function HomePage() {
  // Queries paralelas para poupar tempo (em vez de uma a uma)
  const [poolsResult, playersResult, metricsResult] = await Promise.all([
    supabase.from('pools').select('*', { count: 'exact', head: true }),
    supabase.from('players').select('*', { count: 'exact', head: true }),
    supabase.from('metrics').select('*', { count: 'exact', head: true }),
  ])

  const poolsCount = poolsResult.count ?? 0
  const playersCount = playersResult.count ?? 0
  const metricsCount = metricsResult.count ?? 0

  const hasError = poolsResult.error || playersResult.error || metricsResult.error

  if (hasError) {
    return (
      <main style={{ padding: 40, fontFamily: 'monospace' }}>
        <h1>Erro ao ler do Supabase</h1>
        <pre>{JSON.stringify({ 
          pools: poolsResult.error, 
          players: playersResult.error, 
          metrics: metricsResult.error 
        }, null, 2)}</pre>
      </main>
    )
  }

  return (
    <main style={{ 
      padding: '60px 40px', 
      fontFamily: 'system-ui, -apple-system, sans-serif',
      maxWidth: 800,
      margin: '0 auto'
    }}>
      <div style={{ marginBottom: 8, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: '#888' }}>
        v0.1 · desenvolvimento
      </div>
      <h1 style={{ fontSize: 42, margin: 0, letterSpacing: '-0.02em' }}>Scout XI</h1>
      <p style={{ color: '#666', fontSize: 16, marginTop: 8 }}>
        Plataforma de scouting de futebol — em construção
      </p>

      <div style={{ 
        marginTop: 48, 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)', 
        gap: 24 
      }}>
        <Card label="Pools" value={poolsCount} hint="importações de dados" />
        <Card label="Jogadores" value={playersCount} hint="no universo total" />
        <Card label="Métricas" value={metricsCount} hint="no schema canónico" />
      </div>

      <div style={{ marginTop: 48, padding: 20, background: '#f7f7f5', borderRadius: 8 }}>
        <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#888', marginBottom: 8 }}>
          Próximo passo
        </div>
        <div style={{ fontSize: 15 }}>
          Construir o parser Wyscout XLSX para importar o primeiro pool de dados.
        </div>
      </div>
    </main>
  )
}

function Card({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div style={{ 
      padding: 24, 
      background: '#fff', 
      border: '1px solid #eee', 
      borderRadius: 8 
    }}>
      <div style={{ 
        fontSize: 11, 
        letterSpacing: 1.5, 
        textTransform: 'uppercase', 
        color: '#888', 
        marginBottom: 8 
      }}>
        {label}
      </div>
      <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
        {hint}
      </div>
    </div>
  )
}