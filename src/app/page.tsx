import { supabase } from '@/lib/supabase/client'

export default async function HomePage() {
  const { data: players, error } = await supabase
    .from('test_players')
    .select('*')
    .order('goals', { ascending: false })

  if (error) {
    return (
      <main style={{ padding: 40, fontFamily: 'monospace' }}>
        <h1>Erro ao ler do Supabase</h1>
        <pre>{JSON.stringify(error, null, 2)}</pre>
      </main>
    )
  }

  return (
    <main style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Scout XI — teste de ligação</h1>
      <p style={{ color: '#666' }}>
        Dados vindos do Supabase ({players?.length ?? 0} jogadores):
      </p>

      <table style={{ marginTop: 20, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333' }}>
            <th style={{ textAlign: 'left', padding: 8 }}>Nome</th>
            <th style={{ textAlign: 'left', padding: 8 }}>Equipa</th>
            <th style={{ textAlign: 'right', padding: 8 }}>Golos</th>
          </tr>
        </thead>
        <tbody>
          {players?.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: 8 }}>{p.name}</td>
              <td style={{ padding: 8, color: '#666' }}>{p.team}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{p.goals}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}