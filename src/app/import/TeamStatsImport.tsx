'use client';

/**
 * Importação dos ficheiros "Team Stats" do Wyscout: um ficheiro por equipa,
 * todos de uma vez. Primeiro lê e resume; só grava depois de confirmado.
 */

import { useState } from 'react';
import { PoolPicker } from '@/components/PoolPicker';
import type { PoolOption } from '@/lib/pools';

type Summary = {
  ok?: boolean;
  error?: string;
  mode?: 'preview' | 'import';
  files?: number;
  file_errors?: Array<{ file: string; error: string }>;
  competitions?: Array<{ name: string; games: number }>;
  competition?: string | null;
  needs_competition?: boolean;
  games?: number;
  teams?: Array<{ team: string; games: number; in_pool: boolean }>;
  teams_not_in_pool?: string[];
  first_date?: string | null;
  last_date?: string | null;
  outside_season?: number;
  unpaired_games?: number;
  rows_written?: number;
};

const LABEL = 'block text-sm font-medium text-neutral-700';
const FIELD = 'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function TeamStatsImport({ pools }: { pools: PoolOption[] }) {
  const [poolId, setPoolId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [round, setRound] = useState('');
  const [competition, setCompetition] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  const send = async (mode: 'preview' | 'import', chosen = competition) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.set('pool_id', poolId);
      body.set('mode', mode);
      if (chosen) body.set('competition', chosen);
      if (round.trim()) body.set('round', round.trim());
      for (const f of files) body.append('files', f);
      const res = await fetch('/api/import/team-stats', { method: 'POST', body });
      setSummary((await res.json()) as Summary);
    } catch (e) {
      setSummary({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setSummary(null);
    setCompetition('');
  };

  const done = summary?.mode === 'import' && summary.ok;
  const canImport = Boolean(summary?.ok) && summary?.mode === 'preview' && (summary.games ?? 0) > 0;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-neutral-900">Estatísticas de equipa</h2>
      <p className="mt-1 text-sm text-neutral-600">
        Ficheiros &quot;Team Stats&quot; do Wyscout, um por equipa. Podes escolher todos de uma vez.
      </p>

      <div className="mt-4 space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
        <div>
          <span className={LABEL}>Pool</span>
          <PoolPicker
            className="mt-1"
            pools={pools}
            value={poolId}
            onChange={(id) => {
              setPoolId(id);
              reset();
            }}
            selectClassName="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className={LABEL} htmlFor="ts-files">Ficheiros</label>
            <input
              id="ts-files"
              type="file"
              accept=".xlsx"
              multiple
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []));
                reset();
              }}
              className="mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-700 hover:file:bg-neutral-50"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="ts-round">Jornada</label>
            <input
              id="ts-round"
              type="text"
              value={round}
              onChange={(e) => setRound(e.target.value)}
              placeholder="ex: 8"
              className={FIELD}
            />
          </div>
        </div>

        {!summary && (
          <button
            type="button"
            onClick={() => send('preview')}
            disabled={busy || !poolId || files.length === 0}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {busy ? 'A ler…' : files.length > 1 ? `Ler ${files.length} ficheiros` : 'Ler ficheiro'}
          </button>
        )}

        {summary?.error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{summary.error}</div>
        )}

        {summary && summary.files != null && (
          <div className="space-y-3 border-t border-neutral-100 pt-4 text-sm">
            {done ? (
              <p className="font-medium text-green-700">
                Importado: {summary.games} jogos de {summary.teams?.length ?? 0} equipas.
              </p>
            ) : (
              <p className="text-neutral-800">
                <span className="font-medium">{summary.games} jogos</span> de {summary.teams?.length ?? 0} equipas, de{' '}
                {formatDate(summary.first_date)} a {formatDate(summary.last_date)}.
              </p>
            )}

            {summary.needs_competition && !done && (
              <div>
                <label className={LABEL} htmlFor="ts-comp">Os ficheiros trazem mais de uma competição</label>
                <select
                  id="ts-comp"
                  value={competition}
                  onChange={(e) => {
                    setCompetition(e.target.value);
                    if (e.target.value) send('preview', e.target.value);
                  }}
                  className={FIELD}
                >
                  <option value="">— escolher —</option>
                  {(summary.competitions ?? []).map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} ({c.games} jogos)
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(summary.teams_not_in_pool?.length ?? 0) > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-800">
                {summary.teams_not_in_pool!.length === summary.teams?.length
                  ? 'Nenhuma destas equipas existe na pool escolhida. Confirma se é a pool certa.'
                  : `Equipas que não existem na pool com este nome: ${summary.teams_not_in_pool!.join(', ')}.`}
              </div>
            )}
            {(summary.outside_season ?? 0) > 0 && (
              <p className="text-xs text-amber-700">{summary.outside_season} linhas de outra época ficaram de fora.</p>
            )}
            {(summary.unpaired_games ?? 0) > 0 && (
              <p className="text-xs text-amber-700">{summary.unpaired_games} jogos sem a linha do adversário ficaram de fora.</p>
            )}
            {(summary.file_errors ?? []).map((f) => (
              <p key={f.file} className="text-xs text-red-700">
                {f.file}: {f.error}
              </p>
            ))}

            {(summary.teams?.length ?? 0) > 0 && (
              <details className="rounded border border-neutral-200 p-3">
                <summary className="cursor-pointer text-neutral-700">Jogos por equipa</summary>
                <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs text-neutral-600">
                  {summary.teams!.map((t) => (
                    <li key={t.team} className="flex justify-between">
                      <span>{t.team}</span>
                      <span>{t.games}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {!done && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => send('import')}
                  disabled={busy || !canImport}
                  className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {busy ? 'A gravar…' : `Importar ${summary.games ?? 0} jogos`}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy}
                  className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
