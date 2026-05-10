'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Pool = { id: string; name: string; season: string };

type ScoutPlayer = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  pool_name: string;
  metric_values: Array<{
    metric_code: string;
    raw_value: number | null;
    percentile: number | null;
  }>;
};

type ScoutResponse = {
  count: number;
  peer_group_size: number;
  warnings: string[];
  metric_thresholds: Record<string, unknown>;
  players?: ScoutPlayer[];
};

// Posições Wyscout agrupadas por linha — fixo por agora; em fase posterior
// pode passar a vir do schema/metadata se for útil.
const POSITIONS_BY_LINE: Array<[string, string[]]> = [
  ['GR', ['GK']],
  ['Defesa', ['CB', 'LCB', 'RCB', 'LB', 'RB', 'LWB', 'RWB']],
  ['Médio', ['DMF', 'LDMF', 'RDMF', 'CMF', 'LCMF', 'RCMF', 'AMF', 'LAMF', 'RAMF', 'LM', 'RM']],
  ['Ataque', ['LW', 'RW', 'LWF', 'RWF', 'CF']],
];

export function PesquisaAvancada() {
  const router = useRouter();
  const [pools, setPools] = useState<Pool[]>([]);
  const [poolId, setPoolId] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [minMinutes, setMinMinutes] = useState('');
  const [onLoan, setOnLoan] = useState<'any' | 'yes' | 'no'>('any');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoutResponse | null>(null);

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
  }, []);

  const togglePosition = (pos: string) => {
    setPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  };

  const search = async () => {
    if (!poolId) {
      setError('Escolhe uma pool.');
      return;
    }
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const general_filters: Record<string, number | boolean> = {};
      if (minAge.trim()) general_filters.min_age = parseInt(minAge, 10);
      if (maxAge.trim()) general_filters.max_age = parseInt(maxAge, 10);
      if (minMinutes.trim()) general_filters.min_minutes = parseInt(minMinutes, 10);
      if (onLoan === 'yes') general_filters.on_loan = true;
      else if (onLoan === 'no') general_filters.on_loan = false;

      const res = await fetch('/api/scout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pool_id: poolId,
          positions: positions.length > 0 ? positions : undefined,
          general_filters: Object.keys(general_filters).length > 0 ? general_filters : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro');
      setResult(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p className="mb-6 text-sm text-neutral-600">
        Filtros ad-hoc sem criar perfil. Escolhe pool, posições e filtros gerais para começar.
        Filtros de métrica chegam na próxima fase.
      </p>

      <section className="rounded-lg border border-neutral-200 bg-white p-6">
        <div className="space-y-5">
          <div>
            <label className="block text-xs font-medium text-neutral-700">Pool</label>
            <select
              value={poolId}
              onChange={(e) => setPoolId(e.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm md:max-w-md"
            >
              <option value="">— escolhe pool —</option>
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.season}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-700">
              Posições {positions.length > 0 && <span className="text-neutral-400">({positions.length})</span>}
            </label>
            <div className="mt-2 space-y-2">
              {POSITIONS_BY_LINE.map(([line, posns]) => (
                <div key={line} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-16 shrink-0 text-xs font-medium text-neutral-500">{line}</span>
                  {posns.map((pos) => {
                    const on = positions.includes(pos);
                    return (
                      <button
                        key={pos}
                        type="button"
                        onClick={() => togglePosition(pos)}
                        className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                          on
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                        }`}
                      >
                        {pos}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Sem posições escolhidas → percentis calculados sobre a pool inteira (com aviso).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700">Idade min</label>
              <input
                type="number"
                value={minAge}
                onChange={(e) => setMinAge(e.target.value)}
                placeholder="—"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700">Idade máx</label>
              <input
                type="number"
                value={maxAge}
                onChange={(e) => setMaxAge(e.target.value)}
                placeholder="—"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700">Min minutos</label>
              <input
                type="number"
                value={minMinutes}
                onChange={(e) => setMinMinutes(e.target.value)}
                placeholder="—"
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700">Empréstimo</label>
              <select
                value={onLoan}
                onChange={(e) => setOnLoan(e.target.value as 'any' | 'yes' | 'no')}
                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="any">Qualquer</option>
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={search}
              disabled={!poolId || loading}
              className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {loading ? 'A procurar…' : 'Procurar'}
            </button>
            {error && <span className="text-sm text-red-700">{error}</span>}
          </div>
        </div>
      </section>

      {result && (
        <section className="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 bg-neutral-50 px-6 py-3 text-sm">
            <strong className="text-neutral-900">{result.count}</strong>
            <span className="text-neutral-700"> jogadores correspondem · peer group {result.peer_group_size}</span>
          </div>
          {result.warnings.length > 0 && (
            <ul className="border-b border-neutral-200 bg-amber-50 px-6 py-2 text-xs text-amber-800">
              {result.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {!result.players || result.players.length === 0 ? (
            <div className="p-6 text-sm text-neutral-500">Nenhum jogador corresponde.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2">Jogador</th>
                    <th className="px-4 py-2">Equipa</th>
                    <th className="px-4 py-2">Pos</th>
                    <th className="px-4 py-2 text-right">Idade</th>
                    <th className="px-4 py-2 text-right">Min</th>
                  </tr>
                </thead>
                <tbody>
                  {result.players.map((p) => {
                    const team = p.team_in_period ?? p.current_team;
                    const transferred =
                      p.team_in_period && p.current_team && p.team_in_period !== p.current_team
                        ? p.current_team
                        : null;
                    return (
                      <tr key={p.id} className="border-t border-neutral-100 hover:bg-neutral-50">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => router.push(`/players/${p.id}`)}
                            className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                          >
                            {p.name}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-neutral-700">
                          {team ?? '—'}
                          {transferred && (
                            <div className="text-xs text-neutral-400">→ {transferred}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-neutral-600">{p.position_primary ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-neutral-600">{p.age ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-neutral-600">
                          {p.minutes_played?.toLocaleString() ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
