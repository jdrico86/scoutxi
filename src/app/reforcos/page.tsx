'use client';

/**
 * Reforços: o que uma equipa tem numa posição e quem, noutra liga, a podia
 * reforçar.
 *
 * Não é uma terceira pesquisa. A ordem dos candidatos é o ranking de um perfil
 * que já existe (os mesmos scores do separador Perfis); o que esta página junta
 * é o ponto de partida — uma equipa e uma posição — e três leituras por cima:
 * o candidato contra o plantel, o ajuste entre escalões em intervalo e os avisos
 * de quando o número merece pouca confiança.
 *
 * Chega-se aqui pelo botão "Procurar reforço" da página Equipas.
 */

import { Fragment, Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FavoriteStar } from '@/components/FavoriteStar';
import { PoolPicker } from '@/components/PoolPicker';
import { useMyClub } from '@/lib/hooks/useMyClub';
import { POSITION_FAMILIES } from '@/lib/scouting/position-families';
import { pastSeasonReference, type PoolOption } from '@/lib/pools';

type MetricInfo = {
  code: string;
  label: string;
  unit: string | null;
  weight: number;
  lower_is_better: boolean;
  low_repeat: boolean;
  step: { cases: number; group_label: string; specific: boolean } | null;
};

type MetricCell = {
  raw: number | null;
  percentile: number | null;
  adjusted: { low: number; mid: number; high: number; pct_low: number; pct_mid: number; pct_high: number } | null;
};

type SquadPlayer = {
  id: string;
  name: string;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  contract_until: string | null;
  score: number | null;
  rank: number | null;
  total: number | null;
  cells: Record<string, MetricCell>;
};

type Candidate = {
  id: string;
  name: string;
  team: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  contract_until: string | null;
  market_value_eur: number | null;
  score: number;
  rank: number;
  total: number;
  projected: { low: number; mid: number; high: number } | null;
  projected_left_out?: string[];
  cells: Record<string, MetricCell>;
  flags: { low_minutes: boolean; via_secondary: boolean };
};

type ReforcosData = {
  team_pool: { id: string; name: string; tier: number | null };
  source_pool: { id: string; name: string; tier: number | null };
  team_name: string;
  family: { key: string; label: string };
  profiles: Array<{ id: string; name: string; is_seed: boolean }>;
  profile: { id: string; name: string; metrics: MetricInfo[] } | null;
  step: { mode: 'adjusted' | 'same_level' | 'none' };
  low_minutes_threshold?: number;
  squad: SquadPlayer[];
  candidates: Candidate[];
};

const LABEL = 'mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500';
const FIELD = 'w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm disabled:opacity-50';

const fmt = (v: number, digits = 2) =>
  v.toLocaleString('pt-PT', { minimumFractionDigits: 0, maximumFractionDigits: digits });

function fmtValue(v: number, unit: string | null) {
  return unit === 'percentage' ? `${fmt(v, 0)}%` : fmt(v);
}

function contractLabel(date: string | null) {
  if (!date) return 'sem dado';
  const [y, m] = date.split('-');
  return `${m}/${y}`;
}

/** Mínimo de minutos por omissão: uma época a meio ainda não tem quem chegue aos 900. */
const STEP_TIP =
  'Cada intervalo é o valor do jogador na liga multiplicado pelo que aconteceu, nessa métrica, aos jogadores da mesma posição que fizeram o mesmo salto nos últimos cinco anos.';

/**
 * Sinal (i) com uma nota que aparece ao passar o rato, ao focar ou ao tocar.
 * A nota é posicionada em relação à janela (fixed) para não ser cortada pelas
 * tabelas com scroll horizontal.
 */
function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const WIDTH = 260;
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + r.width / 2 - WIDTH / 2, window.innerWidth - WIDTH - 8));
    setPos({ left, top: r.bottom + 6 });
  };
  return (
    <span className="ml-1.5 inline-block align-middle">
      <button
        type="button"
        aria-label={text}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => setPos(null)}
        onFocus={(e) => show(e.currentTarget)}
        onBlur={() => setPos(null)}
        onClick={(e) => {
          e.stopPropagation();
          show(e.currentTarget);
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-300 text-[10px] font-semibold normal-case leading-none text-neutral-500 hover:border-neutral-500 hover:text-neutral-900"
      >
        i
      </button>
      {pos && (
        <span
          role="tooltip"
          style={{ left: pos.left, top: pos.top, width: WIDTH }}
          className="pointer-events-none fixed z-50 whitespace-normal rounded-md border border-neutral-200 bg-white px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-neutral-700 shadow-md"
        >
          {text}
        </span>
      )}
    </span>
  );
}

const MIN_MINUTES_FULL_SEASON = 900;
const MIN_MINUTES_SEASON_UNDERWAY = 300;

export default function ReforcosPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-50 py-10">
          <div className="mx-auto max-w-6xl px-6 text-sm text-neutral-500">A carregar…</div>
        </main>
      }
    >
      <ReforcosContent />
    </Suspense>
  );
}

function ReforcosContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const myClub = useMyClub();

  const [pools, setPools] = useState<PoolOption[]>([]);
  const [teams, setTeams] = useState<{ poolId: string; names: string[] }>({ poolId: '', names: [] });
  const [result, setResult] = useState<{ key: string; data: ReforcosData | null; error: string | null } | null>(null);

  const [poolId, setPoolId] = useState(searchParams.get('pool') ?? '');
  const [teamName, setTeamName] = useState(searchParams.get('team') ?? '');
  const [pos, setPos] = useState(searchParams.get('pos') ?? '');
  const [fromPick, setFromPick] = useState(searchParams.get('from') ?? '');
  const [profileId, setProfileId] = useState(searchParams.get('profile') ?? '');
  const [maxAge, setMaxAge] = useState(searchParams.get('max_age') ?? '');
  // null = ainda não mexeu: vale o mínimo por omissão da época onde se procura.
  const [minPick, setMinPick] = useState<string | null>(searchParams.get('min_minutes'));

  // Que candidato está aberto.
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []))
      .catch(() => setPools([]));
  }, []);

  // Sem equipa escolhida, abre no clube do utilizador.
  const useClubDefault = !poolId && !teamName && Boolean(myClub.location && myClub.club);
  const effPoolId = useClubDefault ? myClub.location!.pool_id : poolId;
  const effTeam = useClubDefault ? myClub.club!.team : teamName;

  // Onde procurar, por defeito: o escalão abaixo, no mesmo país e época; se não
  // existir, a própria liga.
  const defaultFrom = useMemo(() => {
    const teamPool = pools.find((p) => p.id === effPoolId);
    if (!teamPool) return '';
    const below = pools.find(
      (p) =>
        p.season === teamPool.season &&
        p.country === teamPool.country &&
        Boolean(p.in_pyramid) &&
        teamPool.tier != null &&
        p.tier === teamPool.tier + 1
    );
    return (below ?? teamPool).id;
  }, [pools, effPoolId]);
  const effFrom = fromPick || defaultFrom;

  const sourceSeason = pools.find((p) => p.id === effFrom)?.season ?? null;
  const defaultMin =
    sourceSeason && pastSeasonReference(sourceSeason) === null ? MIN_MINUTES_SEASON_UNDERWAY : MIN_MINUTES_FULL_SEASON;
  const effMin = minPick ?? `${defaultMin}`;
  const minNumber = parseInt(effMin, 10) || 0;

  useEffect(() => {
    if (!effPoolId) return;
    let cancelled = false;
    fetch(`/api/pools/${effPoolId}/teams`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setTeams({ poolId: effPoolId, names: j.teams ?? [] });
      })
      .catch(() => {
        if (!cancelled) setTeams({ poolId: effPoolId, names: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [effPoolId]);
  const teamNames = teams.poolId === effPoolId ? teams.names : [];

  // URL partilhável.
  useEffect(() => {
    const params = new URLSearchParams();
    if (effPoolId) params.set('pool', effPoolId);
    if (effTeam) params.set('team', effTeam);
    if (pos) params.set('pos', pos);
    if (effFrom) params.set('from', effFrom);
    if (profileId) params.set('profile', profileId);
    if (maxAge) params.set('max_age', maxAge);
    if (minPick != null) params.set('min_minutes', minPick);
    const next = params.toString();
    if (next !== searchParams.toString()) router.replace(next ? `/reforcos?${next}` : '/reforcos', { scroll: false });
  }, [effPoolId, effTeam, pos, effFrom, profileId, maxAge, minPick, router, searchParams]);

  // Só se procura depois de as pools chegarem: sem elas não se sabe o mínimo
  // de minutos por omissão, e o pedido saía com o valor errado.
  const ready = Boolean(effPoolId && effTeam && pos && effFrom && pools.length > 0);
  const requestKey = ready ? [effPoolId, effTeam, pos, effFrom, profileId, maxAge, effMin].join('|') : '';

  useEffect(() => {
    if (!requestKey) return;
    let cancelled = false;
    const params = new URLSearchParams({ pool: effPoolId, team: effTeam, pos, from: effFrom });
    if (profileId) params.set('profile_id', profileId);
    if (maxAge.trim()) params.set('max_age', maxAge.trim());
    if (effMin.trim()) params.set('min_minutes', effMin.trim());
    fetch(`/api/reforcos?${params}`)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setResult({ key: requestKey, data: null, error: json.error ?? 'Erro a carregar.' });
        else setResult({ key: requestKey, data: json as ReforcosData, error: null });
      })
      .catch((e) => {
        if (!cancelled) setResult({ key: requestKey, data: null, error: (e as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, effPoolId, effTeam, pos, effFrom, profileId, maxAge, effMin]);

  const current = result && result.key === requestKey ? result : null;
  const loading = ready && !current;
  const data = current?.data ?? null;
  const error = current?.error ?? null;

  const metrics = data?.profile?.metrics ?? [];
  const adjusted = data?.step.mode === 'adjusted';

  // Do plantel entram na comparação todos os que cumprem o mínimo de minutos
  // pedido: com menos, os números deles não querem dizer nada.
  const enoughMinutes = (p: SquadPlayer) => (p.minutes_played ?? 0) >= minNumber;
  const usable = (data?.squad ?? []).filter(enoughMinutes);
  const openCandidate = data?.candidates.find((c) => c.id === openId) ?? null;

  const columns = adjusted ? 7 : 6;

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Reforços</h1>
          <p className="mt-2 text-sm text-neutral-600">
            O que a equipa tem numa posição e quem a podia reforçar, ordenado por um perfil.
          </p>
        </header>

        <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className={LABEL}>Equipa que procura</label>
              <PoolPicker
                pools={pools}
                value={effPoolId}
                onChange={(id) => {
                  setPoolId(id);
                  setTeamName('');
                  setFromPick('');
                  setProfileId('');
                }}
                selectClassName="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
              <select
                aria-label="Equipa"
                value={effTeam}
                onChange={(e) => {
                  // Fixa também a pool, para sair do modo "clube por defeito".
                  setPoolId(effPoolId);
                  setTeamName(e.target.value);
                }}
                disabled={!effPoolId}
                className={`${FIELD} mt-2`}
              >
                <option value="">— escolher equipa —</option>
                {teamNames.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Procurar em</label>
              <PoolPicker
                pools={pools}
                value={effFrom}
                onChange={(id) => setFromPick(id)}
                selectClassName="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              />
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Idade máx</label>
                  <input type="number" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Minutos mín</label>
                  <input type="number" value={effMin} onChange={(e) => setMinPick(e.target.value)} className={FIELD} />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 border-t border-neutral-100 pt-4 md:grid-cols-2">
            <div>
              <label className={LABEL}>Posição</label>
              <select
                value={pos}
                onChange={(e) => {
                  setPos(e.target.value);
                  setProfileId('');
                }}
                className={FIELD}
              >
                <option value="">— escolher posição —</option>
                {POSITION_FAMILIES.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={LABEL}>Perfil que ordena</label>
              <select
                value={data?.profile?.id ?? profileId}
                onChange={(e) => setProfileId(e.target.value)}
                disabled={!data || data.profiles.length === 0}
                className={FIELD}
              >
                {(!data || data.profiles.length === 0) && <option value="">—</option>}
                {data?.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {!ready && (
          <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
            {!effPoolId || !effTeam
              ? 'Escolhe a equipa que procura.'
              : !pos
                ? 'Escolhe a posição.'
                : !effFrom
                  ? 'Escolhe onde procurar.'
                  : 'A carregar…'}
          </div>
        )}

        {loading && (
          <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
            A carregar…
          </div>
        )}

        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}

        {data && !data.profile && (
          <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
            Não há perfis para {data.family.label.toLowerCase()}. Cria um no separador Perfis.
          </div>
        )}

        {data && data.profile && (
          <>
            {/* Plantel: lista curta. As métricas aparecem ao lado do candidato aberto. */}
            <section className="mb-4 rounded-lg border border-neutral-200 bg-white">
              <div className="border-b border-neutral-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-neutral-900">
                  {data.team_name}: {data.family.label.toLowerCase()}
                </h2>
              </div>
              {data.squad.length === 0 ? (
                <p className="px-5 py-4 text-sm text-neutral-500">Sem jogadores nesta posição no plantel.</p>
              ) : (
                <ul>
                  {data.squad.map((p) => {
                    const ok = enoughMinutes(p);
                    return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-neutral-100 px-5 py-2 text-sm last:border-0"
                      >
                        <span>
                          <button
                            type="button"
                            onClick={() => router.push(`/players/${p.id}`)}
                            className={`text-left font-medium hover:underline ${ok ? 'text-neutral-900' : 'text-neutral-500'}`}
                          >
                            {p.name}
                          </button>
                          <span className="ml-2 text-xs text-neutral-500">
                            {[p.age ? `${p.age} anos` : null, `${(p.minutes_played ?? 0).toLocaleString('pt-PT')} min`]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="text-xs text-neutral-500">
                          {!ok
                            ? 'poucos minutos'
                            : p.rank != null
                              ? `${p.rank}.º de ${p.total} no perfil`
                              : 'fora do perfil'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Candidatos: uma linha cada. As métricas abrem ao clicar. */}
            <section className="rounded-lg border border-neutral-200 bg-white">
              <div className="border-b border-neutral-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-neutral-900">Candidatos na {data.source_pool.name}</h2>
                <p className="mt-0.5 text-xs text-neutral-500">
                  Ordenados pelo perfil {data.profile.name}. Clica num jogador para ver as métricas.
                </p>
              </div>

              {data.candidates.length === 0 ? (
                <p className="px-5 py-6 text-sm text-neutral-500">Nenhum jogador com estes filtros.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-neutral-100 text-left text-xs uppercase tracking-wider text-neutral-500">
                        <th className="px-5 py-2 font-medium">Jogador</th>
                        <th className="px-3 py-2 font-medium">Idade</th>
                        <th className="px-3 py-2 font-medium">Min</th>
                        <th className="px-3 py-2 font-medium">Contrato</th>
                        <th className="px-3 py-2 font-medium">Perfil</th>
                        {adjusted && <th className="px-3 py-2 font-medium">No destino</th>}
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.candidates.map((c) => {
                        const open = openCandidate?.id === c.id;
                        const notes = [
                          c.flags.low_minutes ? 'poucos minutos' : null,
                          c.flags.via_secondary ? 'posição secundária' : null,
                        ].filter(Boolean);
                        return (
                          <Fragment key={c.id}>
                            <tr
                              onClick={() => setOpenId(open ? null : c.id)}
                              className={`cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 ${open ? 'bg-neutral-50' : ''}`}
                            >
                              <td className="px-5 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span onClick={(e) => e.stopPropagation()}>
                                    <FavoriteStar playerId={c.id} />
                                  </span>
                                  <span className="font-medium text-neutral-900">{c.name}</span>
                                </div>
                                <div className="mt-0.5 text-xs text-neutral-500">
                                  {[c.team, c.position_primary].filter(Boolean).join(' · ')}
                                </div>
                                {notes.length > 0 && (
                                  <div className="mt-0.5 text-xs text-amber-700">{notes.join(' · ')}</div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-neutral-700">{c.age ?? '—'}</td>
                              <td className="whitespace-nowrap px-3 py-2 text-neutral-700">
                                {c.minutes_played?.toLocaleString('pt-PT') ?? '—'}
                              </td>
                              <td
                                className={`whitespace-nowrap px-3 py-2 ${c.contract_until ? 'text-neutral-700' : 'text-neutral-400'}`}
                              >
                                {contractLabel(c.contract_until)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-neutral-700">
                                <span className="font-semibold text-neutral-900">{c.rank}.º</span> de {c.total}
                              </td>
                              {adjusted && (
                                <td className="whitespace-nowrap px-3 py-2 text-neutral-700">
                                  {c.projected ? (
                                    <>
                                      <span className="font-semibold text-neutral-900">{fmt(c.projected.mid, 0)}</span>
                                      <span className="ml-1 text-xs text-neutral-400">
                                        ({fmt(c.projected.low, 0)} a {fmt(c.projected.high, 0)})
                                      </span>
                                      {(c.projected_left_out?.length ?? 0) > 0 && (
                                        <span className="ml-0.5 text-xs text-neutral-400">*</span>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-xs text-neutral-400">sem ajuste</span>
                                  )}
                                </td>
                              )}
                              <td className="whitespace-nowrap px-3 py-2 text-right text-xs text-neutral-500">
                                <button
                                  type="button"
                                  aria-expanded={open}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenId(open ? null : c.id);
                                  }}
                                  className="underline hover:text-neutral-900"
                                >
                                  {open ? 'Fechar' : 'Ver métricas'}
                                </button>
                              </td>
                            </tr>

                            {open && (
                              <tr className="border-b border-neutral-100 bg-neutral-50">
                                <td colSpan={columns} className="px-5 pb-4 pt-1">
                                  <div className="overflow-x-auto">
                                  <table className="text-sm">
                                    <thead>
                                      <tr className="text-left text-xs text-neutral-500">
                                        <th className="py-1.5 pr-6 font-medium">Métrica</th>
                                        <th className="whitespace-nowrap px-3 py-1.5 font-medium text-neutral-900">{c.name}</th>
                                        {adjusted && (
                                          <th className="whitespace-nowrap px-3 py-1.5 font-medium">
                                            Na liga de destino
                                            <InfoTip text={STEP_TIP} />
                                          </th>
                                        )}
                                        {usable.map((p) => (
                                          <th key={p.id} className="whitespace-nowrap px-3 py-1.5 font-medium">
                                            {p.name}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {metrics.map((m) => {
                                        const mine = c.cells[m.code];
                                        return (
                                          <tr key={m.code} className="border-t border-neutral-200">
                                            <td className="whitespace-nowrap py-1.5 pr-6 text-neutral-700">
                                              {m.label}
                                              {m.low_repeat && <span className="ml-1.5 text-xs text-amber-700">instável</span>}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-1.5 font-medium text-neutral-900">
                                              {mine?.raw == null ? '—' : fmtValue(mine.raw, m.unit)}
                                            </td>
                                            {adjusted && (
                                              <td className="whitespace-nowrap px-3 py-1.5 text-neutral-700">
                                                {mine?.adjusted ? (
                                                  `${fmtValue(mine.adjusted.low, m.unit)} a ${fmtValue(mine.adjusted.high, m.unit)}`
                                                ) : (
                                                  <span className="text-xs text-neutral-400">sem ajuste</span>
                                                )}
                                              </td>
                                            )}
                                            {usable.map((p) => {
                                              const theirs = p.cells[m.code];
                                              return (
                                                <td key={p.id} className="whitespace-nowrap px-3 py-1.5 text-neutral-700">
                                                  {theirs?.raw == null ? '—' : fmtValue(theirs.raw, m.unit)}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={() => router.push(`/players/${c.id}`)}
                                      className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                                    >
                                      Abrir ficha
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="space-y-1 border-t border-neutral-100 px-5 py-3 text-xs text-neutral-500">
                {adjusted ? (
                  <p>
                    No destino: score do perfil na {data.team_pool.name}, com o intervalo de quem já subiu de escalão.
                  </p>
                ) : data.step.mode === 'none' ? (
                  <p>Sem ajuste entre estas ligas: os valores são os da liga do jogador.</p>
                ) : null}
                {adjusted && data.candidates.some((c) => (c.projected_left_out?.length ?? 0) > 0) && (
                  <p>* Calculado sem as métricas que não têm ajuste.</p>
                )}
                {data.candidates.some((c) => c.flags.low_minutes) && (
                  <p>Poucos minutos: menos de {(data.low_minutes_threshold ?? 1500).toLocaleString('pt-PT')}.</p>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
