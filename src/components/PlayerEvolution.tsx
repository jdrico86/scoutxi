'use client';

/**
 * Evolução do jogador entre épocas, na ficha.
 *
 * Uma coluna por época em que a mesma pessoa aparece. Para o perfil escolhido:
 * score em barra, posição no ranking e o percentil de cada métrica.
 *
 * Três cuidados que decidem o desenho:
 *  - Barras e não uma linha: com duas ou três épocas, uma linha sugere uma
 *    tendência que os dados não sustentam.
 *  - A época mais recente vem marcada "em curso", com os minutos à vista.
 *  - Scores e percentis são medidos dentro de cada liga. Por isso as setas de
 *    variação só aparecem entre duas épocas na MESMA liga; quando o jogador
 *    muda de liga ficam os percentis, sem seta a sugerir que melhorou ou piorou.
 *
 * Os dados vêm de `usePlayerHistory`, chamado pela ficha, que os partilha com
 * o radar (sobreposição de épocas e nomes das métricas).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type SeasonEntry = {
  player_id: string;
  is_current: boolean;
  season: string;
  pool_id: string;
  competition: string;
  country: string | null;
  tier: number | null;
  team: string | null;
  position_primary: string | null;
  via_position?: string | null;
  age: number | null;
  minutes_played: number | null;
  games_played: number | null;
  score: number | null;
  rank: number | null;
  total_eligible: number | null;
  metrics: Array<{ metric_code: string; raw_value: number | null; percentile: number | null }>;
};

export type PlayerHistory = {
  linked: boolean;
  latest_season: string | null;
  profile: {
    id: string;
    name: string | null;
    metrics: Array<{ metric_code: string; label: string; weight: number }>;
  } | null;
  seasons: SeasonEntry[];
};

/** Diferença de percentil a partir da qual se mostra a seta. */
const BIG_CHANGE = 15;

function tierMove(prev: SeasonEntry | undefined, cur: SeasonEntry): 'up' | 'down' | null {
  if (!prev || prev.tier == null || cur.tier == null || prev.season === cur.season) return null;
  if ((prev.country ?? '') !== (cur.country ?? '')) return null;
  // Ligas de sub-23 não fazem parte da pirâmide: ir de lá para a Liga 2 (ou o
  // contrário) é mudar de liga, mas não é "subir" nem "descer" de escalão.
  const youth = /sub-?\s?23|u-?23|revela/i;
  if (youth.test(prev.competition) || youth.test(cur.competition)) return null;
  if (cur.tier < prev.tier) return 'up';
  if (cur.tier > prev.tier) return 'down';
  return null;
}

function sameLeague(a: SeasonEntry | undefined, b: SeasonEntry): boolean {
  return Boolean(a) && (a!.country ?? '') === (b.country ?? '') && a!.competition === b.competition;
}

/** Histórico do jogador para um perfil. Refaz o pedido quando muda o jogador ou o perfil. */
export function usePlayerHistory(
  playerId: string,
  profileId: string | null
): { data: PlayerHistory | null; error: string | null } {
  const [state, setState] = useState<{ key: string; data: PlayerHistory | null; error: string | null }>({
    key: '',
    data: null,
    error: null,
  });
  const key = `${playerId}::${profileId ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    const qs = profileId ? `?profile_id=${profileId}` : '';
    fetch(`/api/players/${playerId}/history${qs}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Erro desconhecido');
        return j as PlayerHistory;
      })
      .then((j) => {
        if (!cancelled) setState({ key, data: j, error: null });
      })
      .catch((e) => {
        if (!cancelled) setState({ key, data: null, error: (e as Error).message });
      });
    return () => {
      cancelled = true;
    };
  }, [playerId, profileId, key]);

  // Enquanto o pedido novo não chega, não se mostram dados de outro jogador ou perfil.
  return state.key === key ? { data: state.data, error: state.error } : { data: null, error: null };
}

export function PlayerEvolution({ data, error }: { data: PlayerHistory | null; error: string | null }) {
  const router = useRouter();

  const seasons = data?.seasons ?? [];
  const metricDefs = data?.profile?.metrics ?? [];

  return (
    <section className="mb-6 rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-neutral-900">Evolução entre épocas</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          {data?.profile?.name
            ? `Perfil: ${data.profile.name}. Cada época é medida contra os jogadores da sua liga; as setas comparam só épocas na mesma liga.`
            : 'Épocas em que este jogador aparece.'}
        </p>
      </div>

      {error ? (
        <div className="p-4 text-sm text-red-700">Não foi possível carregar a evolução: {error}</div>
      ) : !data ? (
        <div className="p-4 text-sm text-neutral-500">A carregar…</div>
      ) : seasons.length <= 1 ? (
        <div className="p-4 text-sm text-neutral-500">
          Sem outras épocas ligadas a este jogador.
          {!data.linked && ' Falta-lhe altura, pé ou idade no Wyscout, e sem isso não é ligado automaticamente.'}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="align-top">
                  <th className="w-44 px-4 py-3" />
                  {seasons.map((s, i) => {
                    const move = tierMove(seasons[i - 1], s);
                    return (
                      <th key={s.player_id} className={`px-4 py-3 text-left font-normal ${s.is_current ? 'bg-neutral-50' : ''}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-neutral-900">{s.season}</span>
                          {s.season === data.latest_season && (
                            <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700">
                              em curso
                            </span>
                          )}
                          {move && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                move === 'up' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {move === 'up' ? '▲ subiu de escalão' : '▼ desceu de escalão'}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-700">{s.competition}</div>
                        <div className="text-xs text-neutral-500">
                          {[s.team, s.position_primary].filter(Boolean).join(' · ')}
                          {s.via_position && (
                            <span
                              title={`Nesta época entra no perfil pela posição secundária ${s.via_position}`}
                              className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
                            >
                              sec. {s.via_position}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {s.minutes_played != null ? `${s.minutes_played.toLocaleString()} min` : '— min'}
                          {s.games_played != null ? ` · ${s.games_played} jogos` : ''}
                        </div>
                        {!s.is_current && (
                          <button
                            type="button"
                            onClick={() => router.push(`/players/${s.player_id}`)}
                            className="mt-1 text-xs text-neutral-500 underline hover:text-neutral-900"
                          >
                            Abrir esta época
                          </button>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              {data.profile && (
                <tbody>
                  <tr className="border-t border-neutral-200">
                    <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">Score</td>
                    {seasons.map((s) => (
                      <td key={s.player_id} className={`px-4 py-3 ${s.is_current ? 'bg-neutral-50' : ''}`}>
                        {s.score == null ? (
                          <span className="text-xs text-neutral-400">Não elegível neste perfil</span>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 rounded-full bg-neutral-100">
                                <div
                                  className="h-2 rounded-full bg-emerald-500"
                                  style={{ width: `${Math.max(0, Math.min(100, s.score))}%` }}
                                />
                              </div>
                              <span className="w-10 text-right text-sm font-semibold text-neutral-900">
                                {s.score.toFixed(1)}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-neutral-500">
                              {s.rank != null && s.total_eligible != null
                                ? `#${s.rank} de ${s.total_eligible}`
                                : 'posição por calcular'}
                            </div>
                          </>
                        )}
                      </td>
                    ))}
                  </tr>
                  {metricDefs.map((m) => (
                    <tr key={m.metric_code} className="border-t border-neutral-100">
                      <td className="px-4 py-2 text-xs text-neutral-700">
                        {m.label}
                        <span className="ml-1 text-neutral-400">{m.weight}%</span>
                      </td>
                      {seasons.map((s, i) => {
                        const cur = s.metrics.find((x) => x.metric_code === m.metric_code)?.percentile ?? null;
                        const prev =
                          seasons[i - 1]?.metrics.find((x) => x.metric_code === m.metric_code)?.percentile ?? null;
                        // Só se compara com a época anterior se for na mesma liga.
                        const delta =
                          cur != null && prev != null && sameLeague(seasons[i - 1], s) ? cur - prev : null;
                        return (
                          <td key={s.player_id} className={`px-4 py-2 text-xs ${s.is_current ? 'bg-neutral-50' : ''}`}>
                            {cur == null ? (
                              <span className="text-neutral-400">—</span>
                            ) : (
                              <span
                                className={
                                  cur >= 80 ? 'font-semibold text-emerald-700' : cur >= 50 ? 'text-neutral-700' : 'text-neutral-400'
                                }
                              >
                                P{Math.round(cur)}
                              </span>
                            )}
                            {delta != null && Math.abs(delta) >= BIG_CHANGE && (
                              <span className={`ml-1.5 ${delta > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {delta > 0 ? '▲' : '▼'} {Math.abs(Math.round(delta))}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        </>
      )}
    </section>
  );
}
