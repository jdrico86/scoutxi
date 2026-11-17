/**
 * Peças partilhadas entre a página de comparação de jogadores e o seu
 * relatório para descarregar: tipos da resposta da rota, cores e os blocos
 * (cartão do jogador, linhas da tabela, barras).
 */
import Link from 'next/link';

export type PlayerInfo = {
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

export type SideResult = {
  eligible: boolean;
  score: number | null;
  rank: number | null;
  total_eligible: number | null;
  via_position: string | null;
  peer_group_size: number | null;
};

export type Side = { raw_value: number | null; percentile: number } | null;

export type MetricRow = {
  metric_code: string;
  label: string;
  category: string;
  weight: number | null;
  a: Side;
  b: Side;
};

export type CompareResponse = {
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

export const COLOR_A = '#10b981';
export const COLOR_B = '#f59e0b';
/** Abaixo disto os valores por 90 minutos assentam em pouco jogo: cinco jogos completos. */
export const LOW_MINUTES = 450;
/** Diferença de percentil a partir da qual se destaca quem está à frente. */
export const CLEAR_GAP = 15;

export const CATEGORY_LABELS: Record<string, string> = {
  offensive: 'Ofensivo',
  defensive: 'Defensivo',
  technical: 'Técnico',
  physical: 'Físico',
  goalkeeping: 'Guarda-redes',
};
export const CATEGORY_ORDER = ['offensive', 'technical', 'defensive', 'physical', 'goalkeeping'];

export function formatVal(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

export function PlayerCard({
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

export function MetricRows({
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

export function Bar({ value, color }: { value: number | null; color: string }) {
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
