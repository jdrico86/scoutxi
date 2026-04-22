'use client';

import { useState } from 'react';

type ApiResponse = {
  ok?: boolean;
  error?: string;
  pool_id?: string;
  pool_name?: string;
  season?: string;
  competition?: string | null;
  file_name?: string;
  rows_read?: number;
  players_inserted?: number;
  players_updated?: number;
  stats_inserted?: number;
  columns_ignored?: string[];
  columns_missing?: string[];
  warnings?: string[];
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [poolName, setPoolName] = useState('Campeonato de Portugal 25/26');
  const [season, setSeason] = useState('25/26');
  const [competition, setCompetition] = useState('Campeonato de Portugal');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setResult(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('pool_name', poolName);
    fd.append('season', season);
    if (competition) fd.append('competition', competition);

    try {
      const res = await fetch('/api/import/wyscout', { method: 'POST', body: fd });
      const json: ApiResponse = await res.json();
      setResult(json);
    } catch (err) {
      setResult({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-2xl px-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Importar ficheiro Wyscout</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Carrega um export XLSX do Wyscout. O parser mapeia as colunas para o schema canónico
          e insere jogadores + estatísticas.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
          <div>
            <label className="block text-sm font-medium text-neutral-700">Nome da pool</label>
            <input
              type="text"
              value={poolName}
              onChange={(e) => setPoolName(e.target.value)}
              required
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-neutral-700">Época</label>
              <input
                type="text"
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-neutral-700">Competição</label>
              <input
                type="text"
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
                className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700">Ficheiro XLSX</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
            />
            {file && <p className="mt-1 text-xs text-neutral-500">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
          </div>

          <button
            type="submit"
            disabled={!file || busy}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'A importar…' : 'Importar'}
          </button>
        </form>

        {result && (
          <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
            {result.error ? (
              <div className="text-sm text-red-700">
                <h2 className="text-base font-semibold">Erro</h2>
                <p className="mt-2 whitespace-pre-wrap">{result.error}</p>
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <h2 className="text-base font-semibold text-green-700">Importação concluída</h2>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <dt className="text-neutral-500">Pool ID</dt>
                  <dd className="font-mono text-xs text-neutral-800">{result.pool_id}</dd>
                  <dt className="text-neutral-500">Linhas lidas</dt>
                  <dd className="font-medium">{result.rows_read}</dd>
                  <dt className="text-neutral-500">Jogadores criados</dt>
                  <dd className="font-medium">{result.players_inserted}</dd>
                  <dt className="text-neutral-500">Jogadores actualizados</dt>
                  <dd className="font-medium">{result.players_updated}</dd>
                  <dt className="text-neutral-500">Stats inseridas</dt>
                  <dd className="font-medium">{result.stats_inserted}</dd>
                </dl>

                {result.columns_ignored && result.columns_ignored.length > 0 && (
                  <details className="rounded border border-neutral-200 p-3">
                    <summary className="cursor-pointer text-neutral-700">
                      {result.columns_ignored.length} colunas ignoradas (não estão no schema)
                    </summary>
                    <ul className="mt-2 list-disc pl-5 text-xs text-neutral-600">
                      {result.columns_ignored.map((c) => <li key={c}>{c}</li>)}
                    </ul>
                  </details>
                )}

                {result.warnings && result.warnings.length > 0 && (
                  <details className="rounded border border-amber-200 bg-amber-50 p-3">
                    <summary className="cursor-pointer text-amber-800">
                      {result.warnings.length} warnings
                    </summary>
                    <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                      {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}