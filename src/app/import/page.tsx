'use client';

import { useEffect, useState } from 'react';
import { competitionId, competitionLabel, poolSeasons, slugifyCompetition, type PoolOption, pastSeasonReference } from '@/lib/pools';
import { TeamStatsImport } from './TeamStatsImport';

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
  /** Verdadeiro quando o ficheiro entrou só para o histórico. */
  history_only?: boolean;
  age_reference?: { date: string; years: number } | null;
  snapshot?: { ok: boolean; date?: string; label?: string | null; players?: number; unmatched?: string[]; error?: string };
};

/** "2026-09-28" → "28/09/2026". */
function formatDate(iso: string | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const NEW_COMPETITION = '__nova__';

type KnownCompetition = {
  id: string;
  /** Nome na época mais recente em que existe. */
  name: string;
  country: string;
  tier: number | null;
  in_pyramid: boolean;
  key: string;
};

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [pools, setPools] = useState<PoolOption[]>([]);
  // O formulário abre sem competição escolhida. Antes abria com os dados de
  // outra liga, e bastava esquecer um campo para a pool entrar mal arrumada.
  const [season, setSeason] = useState('');
  const [choice, setChoice] = useState('');
  const [competition, setCompetition] = useState('');
  const [country, setCountry] = useState('');
  const [tier, setTier] = useState('');
  const [outsidePyramid, setOutsidePyramid] = useState(false);
  // Histórico: nome da fotografia (jornada) e ficheiros antigos que entram só
  // como fotografia, sem mexer nos dados actuais.
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [historyOnly, setHistoryOnly] = useState(false);
  const [snapshotDate, setSnapshotDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApiResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = (j.pools ?? []) as PoolOption[];
        setPools(list);
        // A importação semanal é quase sempre da época em curso.
        setSeason((prev) => prev || poolSeasons(list)[0] || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Competições já conhecidas, uma por código. As pools vêm ordenadas da
  // época mais recente para a mais antiga, por isso a primeira dá o nome actual.
  const known: KnownCompetition[] = [];
  for (const p of pools) {
    const id = competitionId(p);
    if (known.some((k) => k.id === id)) continue;
    known.push({
      id,
      name: competitionLabel(p),
      country: p.country ?? '',
      tier: p.tier ?? null,
      in_pyramid: p.in_pyramid !== false,
      key: p.competition_key ?? id,
    });
  }
  const selected = known.find((k) => k.id === choice) ?? null;

  // Pool que já existe para esta competição e época: a importação actualiza-a.
  const existingPool = selected
    ? pools.find((p) => competitionId(p) === selected.id && p.season === season.trim()) ?? null
    : null;
  const poolName = existingPool ? existingPool.name : `${competition.trim()} ${season.trim()}`.trim();
  const pastSeason = pastSeasonReference(season);
  const competitionKey = selected ? selected.key : slugifyCompetition(country, competition);
  const ready =
    Boolean(file) && Boolean(season.trim()) && Boolean(choice) && Boolean(competition.trim()) &&
    Boolean(country.trim()) && Number(tier) >= 1 &&
    // Só histórico: a pool tem de existir e a data dos dados é obrigatória.
    (!historyOnly || (Boolean(existingPool) && Boolean(snapshotDate)));

  const handleChoice = (value: string) => {
    setChoice(value);
    const comp = known.find((k) => k.id === value);
    if (comp) {
      // Se já há pool nesta época, usa o nome que ela tem (a prova pode ter
      // mudado de nome entretanto).
      const sameSeason = pools.find((p) => competitionId(p) === comp.id && p.season === season.trim());
      setCompetition(sameSeason ? competitionLabel(sameSeason) : comp.name);
      setCountry(comp.country);
      setTier(comp.tier != null ? String(comp.tier) : '');
      setOutsidePyramid(!comp.in_pyramid);
    } else {
      setCompetition('');
      setCountry('');
      setTier('');
      setOutsidePyramid(false);
    }
  };

  // Ao mudar de época com uma competição escolhida, o nome passa a ser o que
  // a prova tinha nessa época — senão reimportar 25/26 mudava-lhe o nome para o actual.
  const handleSeason = (value: string) => {
    setSeason(value);
    if (!selected) return;
    const sameSeason = pools.find((p) => competitionId(p) === selected.id && p.season === value.trim());
    if (sameSeason) setCompetition(competitionLabel(sameSeason));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !ready) return;
    setBusy(true);
    setResult(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('pool_name', poolName);
    fd.append('season', season.trim());
    fd.append('competition', competition.trim());
    fd.append('country', country.trim());
    fd.append('tier', tier.trim());
    fd.append('competition_key', competitionKey);
    fd.append('in_pyramid', outsidePyramid ? 'false' : 'true');
    if (snapshotLabel.trim()) fd.append('snapshot_label', snapshotLabel.trim());
    if (historyOnly) {
      fd.append('history_only', 'true');
      fd.append('snapshot_date', snapshotDate);
    }

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

  const inputClass = 'mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm';
  const labelClass = 'block text-sm font-medium text-neutral-700';

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-2xl px-6">
        <h1 className="text-2xl font-semibold text-neutral-900">Importar ficheiro Wyscout</h1>
        <p className="mt-2 text-sm text-neutral-600">
          Escolhe a época e a competição. Se a pool já existe é actualizada; se não, é criada.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4 rounded-lg border border-neutral-200 bg-white p-6">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass} htmlFor="imp-season">Época</label>
              <input
                id="imp-season"
                type="text"
                value={season}
                placeholder="26/27"
                onChange={(e) => handleSeason(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div className="col-span-2">
              <label className={labelClass} htmlFor="imp-choice">Competição</label>
              <select
                id="imp-choice"
                value={choice}
                onChange={(e) => handleChoice(e.target.value)}
                required
                className={inputClass}
              >
                <option value="">— escolhe a competição —</option>
                {known.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                    {k.country ? ` (${k.country})` : ''}
                  </option>
                ))}
                <option value={NEW_COMPETITION}>Nova competição…</option>
              </select>
            </div>
          </div>

          {choice && (
            <>
              <div>
                <label className={labelClass} htmlFor="imp-name">Nome da competição nesta época</label>
                <input
                  id="imp-name"
                  type="text"
                  value={competition}
                  onChange={(e) => setCompetition(e.target.value)}
                  required
                  className={inputClass}
                />
                {selected && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Se a prova mudou de nome, escreve o nome novo: continua a contar como a mesma competição.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass} htmlFor="imp-country">País</label>
                  <input
                    id="imp-country"
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="imp-tier">Escalão</label>
                  <input
                    id="imp-tier"
                    type="number"
                    min={1}
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                    required
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-neutral-500">1 = primeira divisão. Ordena as competições do país.</p>
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={outsidePyramid}
                  onChange={(e) => setOutsidePyramid(e.target.checked)}
                />
                Fora da pirâmide de escalões (sub-23, taças)
              </label>

              <div className="rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                Pool: <span className="font-medium text-neutral-900">{poolName || '—'}</span>
                <span className="ml-2 text-xs text-neutral-500">
                  {existingPool ? 'já existe, vai ser actualizada' : 'pool nova'}
                </span>
              </div>
              {pastSeason && (
                <p className="text-xs text-neutral-600">
                  Época já terminada: o Wyscout exporta a idade de hoje, por isso as idades são acertadas para{' '}
                  {formatDate(pastSeason.date)}
                  {pastSeason.years > 0 ? ` (menos ${pastSeason.years} ${pastSeason.years === 1 ? 'ano' : 'anos'})` : ''}.
                </p>
              )}
            </>
          )}

          <div>
            <label className={labelClass} htmlFor="imp-file">Ficheiro XLSX</label>
            <input
              id="imp-file"
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
              className="mt-1 block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-800"
            />
            {file && <p className="mt-1 text-xs text-neutral-500">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>}
          </div>

          <div className="space-y-3 rounded-md border border-neutral-200 p-3">
            <div>
              <label className={labelClass} htmlFor="imp-label">Jornada (opcional)</label>
              <input
                id="imp-label"
                type="text"
                value={snapshotLabel}
                placeholder="J9"
                onChange={(e) => setSnapshotLabel(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-neutral-500">
                Cada importação fica guardada no histórico com a data. A jornada ajuda a identificá-la.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={historyOnly} onChange={(e) => setHistoryOnly(e.target.checked)} />
              Ficheiro antigo: guardar só no histórico, sem alterar os dados actuais
            </label>
            {historyOnly && (
              <div>
                <label className={labelClass} htmlFor="imp-date">Data dos dados</label>
                <input
                  id="imp-date"
                  type="date"
                  value={snapshotDate}
                  onChange={(e) => setSnapshotDate(e.target.value)}
                  required
                  className={inputClass}
                />
                {selected && !existingPool && (
                  <p className="mt-1 text-xs text-red-700">
                    Esta pool ainda não existe. Importa primeiro os dados actuais.
                  </p>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!ready || busy}
            className="w-full rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? 'A importar…' : historyOnly ? 'Guardar no histórico' : 'Importar'}
          </button>
        </form>

        {result && (
          <div className="mt-6 rounded-lg border border-neutral-200 bg-white p-6">
            {result.error ? (
              <div className="text-sm text-red-700">
                <h2 className="text-base font-semibold">Erro</h2>
                <p className="mt-2 whitespace-pre-wrap">{result.error}</p>
              </div>
            ) : result.history_only ? (
              <div className="space-y-3 text-sm">
                <h2 className="text-base font-semibold text-green-700">Guardado no histórico</h2>
                <p className="text-neutral-700">
                  {result.pool_name}: fotografia de {formatDate(result.snapshot?.date)}
                  {result.snapshot?.label ? ` (${result.snapshot.label})` : ''} com{' '}
                  <span className="font-medium">{result.snapshot?.players ?? 0}</span> jogadores, de {result.rows_read} linhas
                  lidas. Os dados actuais da pool não foram alterados.
                </p>
                {result.snapshot?.unmatched && result.snapshot.unmatched.length > 0 && (
                  <details className="rounded border border-amber-200 bg-amber-50 p-3">
                    <summary className="cursor-pointer text-amber-800">
                      {result.snapshot.unmatched.length} jogadores do ficheiro não foram reconhecidos na pool e ficaram de fora
                    </summary>
                    <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
                      {result.snapshot.unmatched.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </details>
                )}
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
                  {result.age_reference && result.age_reference.years > 0 && (
                    <>
                      <dt className="text-neutral-500">Idades</dt>
                      <dd className="font-medium">
                        acertadas para {formatDate(result.age_reference.date)} (menos {result.age_reference.years})
                      </dd>
                    </>
                  )}
                  <dt className="text-neutral-500">Histórico</dt>
                  <dd className="font-medium">
                    {result.snapshot?.ok
                      ? `fotografia guardada (${result.snapshot.players ?? 0} jogadores)`
                      : `não guardado${result.snapshot?.error ? `: ${result.snapshot.error}` : ''}`}
                  </dd>
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

        <TeamStatsImport pools={pools} />
      </div>
    </main>
  );
}
