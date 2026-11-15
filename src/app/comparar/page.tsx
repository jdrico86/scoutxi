'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowLeftRight } from 'lucide-react';
import { Radar } from '@/components/Radar';

/**
 * Comparação entre dois jogadores — a única da aplicação.
 *
 * Chega-se aqui pela ficha ("Comparar com outro", com o perfil que se estava a
 * ver) e pela similaridade (âncora contra candidato, pelas métricas da
 * posição). Endereço: /comparar?a=<id>&b=<id>[&profile=<id>].
 *
 * Duas lentes, escolhidas no topo: um perfil (métricas e pesos do utilizador,
 * com score) ou as métricas fixas da posição do jogador A.
 */

type PlayerInfo = {
  id: string;
  name: string;
  team: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  games_played: number | null;
  market_value_eur: number | null;
  contract_until: string | null;
  pool: {
    id: string;
    label: string;
    season: string;
    competition: string;
    country: string | null;
    competition_id: string;
  } | null;
};

type SideResult = {
  eligible: boolean;
  score: number | null;
  rank: number | null;
  total_eligible: number | null;
  via_position: string | null;
  peer_group_size: number | null;
};

type Side = { raw_value: number | null; percentile: number } | null;

type MetricRow = {
  metric_code: string;
  label: string;
  category: string;
  weight: number | null;
  a: Side;
  b: Side;
};

type CompareResponse = {
  a: PlayerInfo;
  b: PlayerInfo;
  same_pool: boolean;
  same_competition: boolean;
  available_profiles: Array<{ id: string; name: string; a_via: string | null; b_via: string | null }>;
  position_lens: { available: boolean; reason: string | null; position_a: string | null; position_b: string | null };
  lens: 'profile' | 'position' | 'none';
  profile: { id: string; name: string; description: string | null } | null;
  result_a: SideResult | null;
  result_b: SideResult | null;
  metrics: MetricRow[];
};

const COLOR_A = '#10b981';
const COLOR_B = '#f59e0b';
/** Abaixo disto os valores por 90 minutos assentam em pouco jogo: cinco jogos completos. */
const LOW_MINUTES = 450;
/** Diferença de percentil a partir da qual se destaca quem está à frente. */
const CLEAR_GAP = 15;

const CATEGORY_LABELS: Record<string, string> = {
  offensive: 'Ofensivo',
  defensive: 'Defensivo',
  technical: 'Técnico',
  physical: 'Físico',
  goalkeeping: 'Guarda-redes',
};
const CATEGORY_ORDER = ['offensive', 'technical', 'defensive', 'physical', 'goalkeeping'];

function formatVal(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function CompararContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const a = searchParams.get('a');
  const b = searchParams.get('b');
  const profileId = searchParams.get('profile');

  const requestKey = a && b ? `${a}|${b}|${profileId ?? ''}` : null;
  const [state, setState] = useState<{ key: string; data: CompareResponse | null; error: string | null } | null>(null);
  const [sortByGap, setSortByGap] = useState(false);

  useEffect(() => {
    if (!a || !b || !requestKey) return;
    let cancelled = false;
    const params = new URLSearchParams({ a, b });
    if (profileId) params.set('profile_id', profileId);
    fetch(`/api/players/compare?${params.toString()}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) setState({ key: requestKey, data: null, error: json.error ?? 'Erro a carregar a comparação.' });
        else setState({ key: requestKey, data: json as CompareResponse, error: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ key: requestKey, data: null, error: (err as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [a, b, profileId, requestKey]);

  const loading = requestKey !== null && state?.key !== requestKey;
  // Enquanto a lente muda, mantém-se a comparação anterior à vista.
  const data = state?.data ?? null;
  const error = !requestKey ? 'Faltam os dois jogadores a comparar.' : !loading ? state?.error ?? null : null;

  const goTo = (next: { a?: string; b?: string; profile?: string | null }) => {
    const params = new URLSearchParams();
    params.set('a', next.a ?? a ?? '');
    params.set('b', next.b ?? b ?? '');
    const nextProfile = next.profile === undefined ? profileId : next.profile;
    if (nextProfile) params.set('profile', nextProfile);
    router.replace(`/comparar?${params.toString()}`);
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const gap = (m: MetricRow) => (m.a && m.b ? Math.abs(m.a.percentile - m.b.percentile) : -1);
    const list = [...data.metrics];
    if (sortByGap) return list.sort((x, y) => gap(y) - gap(x));
    if (data.lens === 'profile') return list.sort((x, y) => (y.weight ?? 0) - (x.weight ?? 0));
    const order = (m: MetricRow) => {
      const i = CATEGORY_ORDER.indexOf(m.category);
      return i === -1 ? CATEGORY_ORDER.length : i;
    };
    return list.sort((x, y) => order(x) - order(y));
  }, [data, sortByGap]);

  const tally = useMemo(() => {
    let aheadA = 0;
    let aheadB = 0;
    let level = 0;
    for (const m of data?.metrics ?? []) {
      if (!m.a || !m.b) continue;
      const d = m.a.percentile - m.b.percentile;
      if (d >= CLEAR_GAP) aheadA++;
      else if (d <= -CLEAR_GAP) aheadB++;
      else level++;
    }
    return { aheadA, aheadB, level };
  }, [data]);

  const back = (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-4 flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
      Voltar
    </button>
  );

  if (!data) {
    return (
      <main className="min-h-screen bg-neutral-50 py-10">
        <div className="mx-auto max-w-5xl px-6">
          {back}
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          ) : (
            <div className="text-sm text-neutral-500">A carregar…</div>
          )}
        </div>
      </main>
    );
  }

  const labels: Record<string, string> = {};
  for (const m of data.metrics) labels[m.metric_code] = m.label;
  const showWeights = data.lens === 'profile';
  const groupByCategory = data.lens === 'position' && !sortByGap;
  const lensValue = data.lens === 'profile' && data.profile ? data.profile.id : data.lens === 'position' ? 'position' : '';

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-5xl px-6">
        {back}

        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Comparar jogadores</h1>
            <p className="mt-1 text-sm text-neutral-600">
              {data.lens === 'profile' && data.profile
                ? `Pelo perfil ${data.profile.name}: as métricas e os pesos que definiste.`
                : data.lens === 'position'
                  ? `Pelas métricas da posição de ${data.a.name} (${data.position_lens.position_a}).`
                  : 'Escolhe um perfil para comparar.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              Comparar por
              <select
                aria-label="Comparar por"
                value={lensValue}
                onChange={(e) => goTo({ profile: e.target.value === 'position' ? null : e.target.value || null })}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900"
              >
                {lensValue === '' && <option value="">Escolher…</option>}
                <option value="position" disabled={!data.position_lens.available}>
                  Métricas da posição
                  {data.position_lens.position_a ? ` (${data.position_lens.position_a})` : ''}
                  {!data.position_lens.available ? ' — não disponível' : ''}
                </option>
                {data.available_profiles.length > 0 && (
                  <optgroup label="Perfis que servem aos dois">
                    {data.available_profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.a_via || p.b_via ? ' (posição secundária)' : ''}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <button
              type="button"
              onClick={() => goTo({ a: data.b.id, b: data.a.id })}
              title="Trocar a ordem dos dois jogadores"
              className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={2} />
              Trocar
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        <div className={`mb-4 grid grid-cols-1 gap-4 md:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
          <PlayerCard player={data.a} result={data.result_a} color={COLOR_A} showScore={data.lens === 'profile'} />
          <PlayerCard player={data.b} result={data.result_b} color={COLOR_B} showScore={data.lens === 'profile'} />
        </div>

        {!data.same_pool && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {data.same_competition ? 'Épocas diferentes.' : 'Ligas diferentes.'} Cada percentil é medido contra os
            jogadores da pool do próprio ({data.a.pool?.label ?? '—'} e {data.b.pool?.label ?? '—'}): o mesmo percentil
            não vale o mesmo nas duas.
          </div>
        )}

        {data.lens === 'none' ? (
          <div className="rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
            <p>{data.position_lens.reason ?? 'Não há métricas de posição para comparar estes dois jogadores.'}</p>
            <p className="mt-2 text-neutral-500">
              {data.available_profiles.length > 0
                ? 'Escolhe em cima um dos perfis que servem aos dois.'
                : 'Também não há nenhum perfil em que os dois sejam avaliados. Não são comparáveis.'}
            </p>
          </div>
        ) : (
          <div className={loading ? 'opacity-60' : ''}>
            <section className="mb-4 rounded-lg border border-neutral-200 bg-white p-5">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-neutral-900">
                  {data.lens === 'profile' ? data.profile?.name : 'Métricas da posição'}
                </h2>
                <p className="text-xs text-neutral-500">
                  <Dot color={COLOR_A} /> à frente em {tally.aheadA} · <Dot color={COLOR_B} /> à frente em{' '}
                  {tally.aheadB} · {tally.level} equilibradas
                </p>
              </div>
              {data.lens === 'profile' && data.profile?.description && (
                <p className="mb-2 text-xs text-neutral-500">{data.profile.description}</p>
              )}
              <Radar
                series={[
                  {
                    label: data.a.name,
                    color: COLOR_A,
                    contributions: data.metrics.map((m) => ({ metric_code: m.metric_code, percentile: m.a?.percentile ?? null })),
                  },
                  {
                    label: data.b.name,
                    color: COLOR_B,
                    contributions: data.metrics.map((m) => ({ metric_code: m.metric_code, percentile: m.b?.percentile ?? null })),
                  },
                ]}
                labels={labels}
              />
            </section>

            <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                <h2 className="text-sm font-semibold text-neutral-900">Métrica a métrica</h2>
                <label className="flex items-center gap-2 text-xs text-neutral-600">
                  <input type="checkbox" checked={sortByGap} onChange={(e) => setSortByGap(e.target.checked)} />
                  Ordenar pela maior diferença
                </label>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Métrica</th>
                      {showWeights && <th className="px-3 py-2 text-right font-medium">Peso</th>}
                      <th className="px-3 py-2 text-right font-medium">Valor A</th>
                      <th className="px-3 py-2 text-right font-medium">Valor B</th>
                      <th className="w-64 px-3 py-2 font-medium">Percentil</th>
                      <th className="px-4 py-2 text-right font-medium">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((m, i) => {
                      const newCategory = groupByCategory && (i === 0 || rows[i - 1].category !== m.category);
                      return (
                        <MetricRows
                          key={m.metric_code}
                          metric={m}
                          showWeights={showWeights}
                          categoryHeader={newCategory ? (CATEGORY_LABELS[m.category] ?? 'Outras') : null}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500">
                {data.lens === 'profile'
                  ? 'Percentis contra quem tem a mesma posição primária, na pool de cada jogador — os mesmos da ficha e do ranking.'
                  : 'Percentis contra quem joga na posição, incluindo como posição secundária, na pool de cada jogador. Podem diferir ligeiramente dos percentis dos perfis.'}
              </p>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

function PlayerCard({
  player,
  result,
  color,
  showScore,
}: {
  player: PlayerInfo;
  result: SideResult | null;
  color: string;
  showScore: boolean;
}) {
  const lowMinutes = player.minutes_played != null && player.minutes_played < LOW_MINUTES;
  const facts = [
    player.age != null ? `${player.age} anos` : null,
    player.minutes_played != null ? `${player.minutes_played.toLocaleString('pt-PT')} min` : null,
    player.market_value_eur ? `€${player.market_value_eur.toLocaleString('pt-PT')}` : null,
    player.contract_until ? `contrato até ${player.contract_until}` : null,
  ].filter(Boolean);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/players/${player.id}`} className="text-lg font-semibold text-neutral-900 hover:underline">
            {player.name}
          </Link>
          <p className="mt-0.5 text-sm text-neutral-700">
            {[player.team, player.position_primary].filter(Boolean).join(' · ') || '—'}
            {result?.via_position && (
              <span
                className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600"
                title="Avaliado por uma posição secundária"
              >
                sec. {result.via_position}
              </span>
            )}
          </p>
          <p className="mt-1.5 text-sm font-medium text-neutral-900">{player.pool?.label ?? 'Pool desconhecida'}</p>
          <p className="mt-0.5 text-xs text-neutral-500">{facts.join(' · ')}</p>
          {lowMinutes && (
            <p className="mt-1 text-xs text-amber-700">Poucos minutos: os valores assentam em pouco jogo.</p>
          )}
        </div>
        {showScore && (
          <div className="shrink-0 text-right">
            {result?.score != null ? (
              <>
                <div className="text-3xl font-semibold tabular-nums text-neutral-900">{result.score.toFixed(1)}</div>
                {result.rank != null && result.total_eligible != null && (
                  <div className="text-xs text-neutral-500">
                    #{result.rank} de {result.total_eligible}
                  </div>
                )}
              </>
            ) : (
              <div className="max-w-[9rem] text-xs text-neutral-500">
                Fora deste perfil (filtros de minutos ou idade)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricRows({
  metric: m,
  showWeights,
  categoryHeader,
}: {
  metric: MetricRow;
  showWeights: boolean;
  categoryHeader: string | null;
}) {
  const gap = m.a && m.b ? m.a.percentile - m.b.percentile : null;
  const clear = gap != null && Math.abs(gap) >= CLEAR_GAP;
  return (
    <>
      {categoryHeader && (
        <tr className="border-t border-neutral-200 bg-neutral-50">
          <td colSpan={showWeights ? 6 : 5} className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {categoryHeader}
          </td>
        </tr>
      )}
      <tr className="border-t border-neutral-100">
        <td className="px-4 py-2 text-neutral-900">{m.label}</td>
        {showWeights && (
          <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{m.weight != null ? `${m.weight}%` : '—'}</td>
        )}
        <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
          {m.a?.raw_value != null ? formatVal(m.a.raw_value) : '—'}
        </td>
        <td className="px-3 py-2 text-right tabular-nums text-neutral-700">
          {m.b?.raw_value != null ? formatVal(m.b.raw_value) : '—'}
        </td>
        <td className="px-3 py-2">
          <Bar value={m.a?.percentile ?? null} color={COLOR_A} />
          <Bar value={m.b?.percentile ?? null} color={COLOR_B} />
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
          {gap == null ? (
            <span className="text-neutral-400">—</span>
          ) : Math.abs(gap) < 1 ? (
            <span className="text-neutral-400">igual</span>
          ) : (
            <span className={clear ? 'font-semibold text-neutral-900' : 'text-neutral-500'}>
              <Dot color={gap > 0 ? COLOR_A : COLOR_B} /> +{Math.abs(gap).toFixed(0)}
            </span>
          )}
        </td>
      </tr>
    </>
  );
}

function Bar({ value, color }: { value: number | null; color: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
        {value != null && (
          <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, value))}%`, backgroundColor: color }} />
        )}
      </div>
      <span className="w-7 text-right text-xs tabular-nums text-neutral-600">{value != null ? value.toFixed(0) : '—'}</span>
    </div>
  );
}

export default function CompararPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-50 py-10">
          <div className="mx-auto max-w-5xl px-6 text-sm text-neutral-500">A carregar…</div>
        </main>
      }
    >
      <CompararContent />
    </Suspense>
  );
}
