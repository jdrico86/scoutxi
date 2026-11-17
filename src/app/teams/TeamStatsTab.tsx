'use client';

/**
 * Separador "Estatística" de uma equipa: nível, três gráficos (defender, posse,
 * atacar), onde se destaca e onde não, e a comparação com outra equipa.
 *
 * Os números vêm dos ficheiros "Team Stats" do Wyscout (rota /api/teams/stats).
 * Tudo é o lugar da equipa entre as que se comparam com ela: fatia ou barra
 * cheia é o 1.º lugar.
 */

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';

type Format = { decimals: number; unit?: '%' | 'm'; signed?: boolean };
type Ranked = { value: number | null; rank: number | null; of: number; mean: number | null };
type GroupKey = 'defender' | 'posse' | 'atacar';
type MetricDef = { code: string; label: string; short: string; group: GroupKey; chart: boolean; lower_first: boolean; format: Format };
type TeamBlock = {
  team: string;
  games: number;
  level: { xg: Ranked; xg_against: Ranked; xg_diff: Ranked };
  metrics: Record<string, Ranked>;
};
export type StatsData =
  | { available: false; reason: 'pool' | 'team' }
  | {
      available: true;
      scope: 'serie' | 'pool';
      has_series: boolean;
      teams: string[];
      updated: { round_label: string | null; last_date: string | null };
      groups: Array<{ key: GroupKey; label: string }>;
      metrics: MetricDef[];
      team: TeamBlock;
      vs: TeamBlock | null;
    };

const GROUP_COLOR: Record<GroupKey, string> = { defender: '#0369A1', posse: '#15803D', atacar: '#C2410C' };
export const TEAM_A = '#2563EB';
export const TEAM_B = '#F59E0B';
const TEAM_B_TEXT = '#B45309';
const LIST_SIZE = 8;

function fmt(v: number | null, f: Format): string {
  if (v == null) return '—';
  const body = Math.abs(v).toLocaleString('pt-PT', { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals });
  const sign = v < 0 ? '−' : f.signed ? '+' : '';
  return `${sign}${body}${f.unit === '%' ? '%' : f.unit === 'm' ? ' m' : ''}`;
}

const place = (r: Ranked): string => (r.rank == null ? '—' : `${r.rank}.º`);

/** Parte da escala que o lugar ocupa: 1.º enche, o último fica com uma fatia mínima. */
const share = (r: Ranked): number => (r.rank == null || r.of === 0 ? 0 : (r.of + 1 - r.rank) / r.of);

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function TeamStatsTab({ poolId, team }: { poolId: string; team: string }) {
  const [scope, setScope] = useState<'serie' | 'pool'>('serie');
  const [vs, setVs] = useState('');
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState('');

  // Mudar de equipa ou de pool larga a comparação e volta à série.
  const subject = `${poolId}|${team}`;
  const [lastSubject, setLastSubject] = useState(subject);
  if (subject !== lastSubject) {
    setLastSubject(subject);
    setVs('');
    setScope('serie');
  }

  const key = `${subject}|${scope}|${vs}`;
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ pool: poolId, team, scope });
    if (vs) params.set('vs', vs);
    fetch(`/api/teams/stats?${params}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? 'Erro a carregar a estatística.');
        return j as StatsData;
      })
      .then((j) => {
        if (cancelled) return;
        setData(j);
        setError(null);
        setLoadedKey(key);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [poolId, team, scope, vs, key]);

  const loading = loadedKey !== key;

  if (error && !loading) {
    return <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>;
  }
  if (!data) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">A carregar…</div>
    );
  }
  if (!data.available) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
        {data.reason === 'pool'
          ? 'Ainda não há estatísticas de equipa importadas para esta liga.'
          : 'Não há estatísticas importadas para esta equipa.'}
      </div>
    );
  }

  const a = data.team;
  const b = data.vs;
  const stamp = updateStamp(data);
  const others = data.teams.filter((t) => t !== a.team);

  return (
    <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
      {/* Barra de cima: actualização, série ou campeonato, comparar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600">
          {stamp && (
            <span className="rounded-full border border-neutral-200 bg-white px-3 py-1">
              {stamp} · {b ? `${a.games} e ${b.games} jogos` : `${a.games} jogo${a.games === 1 ? '' : 's'}`}
            </span>
          )}
          {b && (
            <span className="flex items-center gap-3 text-sm font-medium text-neutral-800">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TEAM_A }} />
                {a.team}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TEAM_B }} />
                {b.team}
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.has_series && (
            <div className="flex overflow-hidden rounded-md border border-neutral-300 text-xs">
              {(['serie', 'pool'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScope(s)}
                  className={`px-3 py-1.5 ${scope === s ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-700 hover:bg-neutral-50'}`}
                >
                  {s === 'serie' ? 'Série' : 'Campeonato'}
                </button>
              ))}
            </div>
          )}
          <a
            href={`/teams/report?${new URLSearchParams({ pool: poolId, team: a.team, scope, ...(b ? { vs: b.team } : {}) })}`}
            className="flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <FileText className="h-3.5 w-3.5" strokeWidth={2} />
            Relatório
          </a>
          <select
            aria-label="Comparar com outra equipa"
            value={vs}
            onChange={(e) => setVs(e.target.value)}
            className="cursor-pointer rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <option value="" className="bg-white text-neutral-900">Comparar com…</option>
            {others.map((t) => (
              <option key={t} value={t} className="bg-white text-neutral-900">
                {t}
              </option>
            ))}
          </select>
          {b && (
            <button
              type="button"
              onClick={() => setVs('')}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Fechar comparação
            </button>
          )}
        </div>
      </div>

      <TeamStatsBody data={data} />
    </div>
  );
}

export type TeamStatsAvailable = Extract<StatsData, { available: true }>;

/** "Atualizado à jornada 8", ou a data do último jogo quando não há jornada. */
export function updateStamp(data: TeamStatsAvailable): string {
  return data.updated.round_label
    ? `Atualizado à jornada ${data.updated.round_label}`
    : data.updated.last_date
      ? `Atualizado a ${formatDate(data.updated.last_date)}`
      : '';
}

/**
 * O conteúdo da estatística, sem os comandos: nível, gráficos, listas e nota.
 * Usado no separador da equipa e no relatório para descarregar. `fixed` fixa as
 * colunas, para o relatório sair igual em qualquer tamanho de janela.
 */
export function TeamStatsBody({ data, fixed = false }: { data: TeamStatsAvailable; fixed?: boolean }) {
  const a = data.team;
  const b = data.vs;
  const of = a.level.xg.of;
  const ranked = data.metrics.filter((m) => a.metrics[m.code]?.rank != null);
  const half = of / 2;
  const standsOut = ranked
    .filter((m) => (a.metrics[m.code].rank as number) <= half)
    .sort((x, y) => (a.metrics[x.code].rank as number) - (a.metrics[y.code].rank as number))
    .slice(0, LIST_SIZE);
  const doesNot = ranked
    .filter((m) => (a.metrics[m.code].rank as number) > half)
    .sort((x, y) => (a.metrics[y.code].rank as number) - (a.metrics[x.code].rank as number))
    .slice(0, LIST_SIZE);
  const differ = b
    ? ranked
        .filter((m) => b.metrics[m.code]?.rank != null)
        .sort(
          (x, y) =>
            Math.abs((a.metrics[y.code].rank as number) - (b.metrics[y.code].rank as number)) -
            Math.abs((a.metrics[x.code].rank as number) - (b.metrics[x.code].rank as number))
        )
        .slice(0, LIST_SIZE)
    : [];

  return (
    <>
      {/* Nível */}
      <div className={`grid gap-3 ${fixed ? 'grid-cols-3' : 'grid-cols-1 md:grid-cols-3'}`}>
        <LevelCard label="Golos esperados criados" a={a.level.xg} b={b?.level.xg} format={{ decimals: 2 }} />
        <LevelCard label="Golos esperados consentidos" a={a.level.xg_against} b={b?.level.xg_against} format={{ decimals: 2 }} />
        <LevelCard label="Diferença por jogo" a={a.level.xg_diff} b={b?.level.xg_diff} format={{ decimals: 2, signed: true }} />
      </div>

      {/* Três gráficos */}
      <div className={`grid gap-3 ${fixed ? 'grid-cols-3' : 'grid-cols-1 lg:grid-cols-3'}`}>
        {data.groups.map((g) => (
          <section key={g.key} className="rounded-lg border border-neutral-200 bg-white px-4 py-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
              {!b && <span className="inline-block h-2 w-2 rounded-full" style={{ background: GROUP_COLOR[g.key] }} />}
              {g.label}
            </h3>
            <PolarChart
              slices={data.metrics
                .filter((m) => m.chart && m.group === g.key)
                .map((m) => ({ code: m.code, label: m.short, a: a.metrics[m.code], b: b ? b.metrics[m.code] : null }))}
              color={GROUP_COLOR[g.key]}
            />
          </section>
        ))}
      </div>

      {/* Listas */}
      {b ? (
        <section className="rounded-lg border border-neutral-200 bg-white px-5 py-4">
          <h3 className="mb-3 text-sm font-semibold text-neutral-900">Onde mais diferem</h3>
          <div className="space-y-2.5">
            {differ.map((m) => (
              <div key={m.code} className="flex items-center gap-3">
                <div className="w-52 shrink-0 text-right text-sm text-neutral-800">{m.label}</div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Bar part={share(a.metrics[m.code])} color={TEAM_A} />
                  <Bar part={share(b.metrics[m.code])} color={TEAM_B} />
                </div>
                <div className="w-48 shrink-0 text-xs text-neutral-600">
                  <span className="font-semibold" style={{ color: TEAM_A }}>{fmt(a.metrics[m.code].value, m.format)}</span> ({place(a.metrics[m.code])}) ·{' '}
                  <span className="font-semibold" style={{ color: TEAM_B_TEXT }}>{fmt(b.metrics[m.code].value, m.format)}</span> ({place(b.metrics[m.code])})
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className={`grid gap-3 ${fixed ? 'grid-cols-2' : 'grid-cols-1 lg:grid-cols-2'}`}>
          <RankList title="Onde se destaca" metrics={standsOut} team={a} />
          <RankList title="Onde não se destaca" metrics={doesNot} team={a} />
        </div>
      )}

      <p className="text-xs text-neutral-500">
        Médias por jogo e lugar entre as {of} equipas {data.scope === 'pool' ? 'do campeonato' : 'com que se compara'}. Barra ou
        fatia cheia = 1.º lugar. No PPDA, nos consentidos e nos cartões amarelos, o 1.º é quem tem menos.
      </p>
    </>
  );
}

function LevelCard({ label, a, b, format }: { label: string; a: Ranked; b?: Ranked | null; format: Format }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-5 py-3.5">
      <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold" style={{ color: b ? TEAM_A : '#171717' }}>{fmt(a.value, format)}</span>
          <span className="text-xs text-neutral-600">{b ? place(a) : `${place(a)} de ${a.of}`}</span>
        </span>
        {b && (
          <span className="flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold" style={{ color: TEAM_B_TEXT }}>{fmt(b.value, format)}</span>
            <span className="text-xs text-neutral-600">{place(b)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function Bar({ part, color }: { part: number; color: string }) {
  return (
    <div className="h-2 rounded bg-neutral-100">
      <div className="h-2 rounded" style={{ width: `${(part * 100).toFixed(1)}%`, background: color }} />
    </div>
  );
}

function RankList({ title, metrics, team }: { title: string; metrics: MetricDef[]; team: TeamBlock }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white px-5 py-4">
      <h3 className="mb-3 text-sm font-semibold text-neutral-900">{title}</h3>
      {metrics.length === 0 ? (
        <p className="text-sm text-neutral-500">Nada a assinalar.</p>
      ) : (
        <div className="space-y-2.5">
          {metrics.map((m) => {
            const r = team.metrics[m.code];
            return (
              <div key={m.code} className="flex items-center gap-3">
                <div className="w-48 shrink-0 text-sm font-medium text-neutral-800">{m.label}</div>
                <div className="min-w-0 flex-1">
                  <Bar part={share(r)} color={TEAM_A} />
                </div>
                <div className="w-14 shrink-0 text-right text-sm font-bold text-neutral-900">{fmt(r.value, m.format)}</div>
                <div className="w-20 shrink-0 text-right text-xs text-neutral-500">média {fmt(r.mean, { ...m.format, signed: false })}</div>
                <div className="w-8 shrink-0 text-right text-sm text-neutral-800">{place(r)}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

type Slice = { code: string; label: string; a: Ranked; b: Ranked | null };

/**
 * Gráfico circular de fatias: o comprimento de cada fatia é o lugar da equipa.
 * Com duas equipas, cada fatia divide-se a meio, uma metade por equipa.
 * Feito com gradientes cónicos, sem biblioteca de gráficos.
 */
function PolarChart({ slices, color }: { slices: Slice[]; color: string }) {
  const W = 300;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const R = 74;
  const r0 = 15;
  const step = 360 / Math.max(1, slices.length);
  const comparing = slices.some((s) => s.b);

  const wedge = (key: string, part: number, from: number, width: number, fill: string) => {
    if (part <= 0) return null;
    const r = r0 + (R - r0) * part;
    return (
      <div
        key={key}
        className="absolute rounded-full"
        style={{
          left: cx - r,
          top: cy - r,
          width: 2 * r,
          height: 2 * r,
          background: `conic-gradient(from ${from.toFixed(1)}deg, ${fill} 0deg ${width.toFixed(1)}deg, transparent ${width.toFixed(1)}deg)`,
        }}
      />
    );
  };

  return (
    <div className="relative mx-auto" style={{ width: W, height: H }} role="img" aria-label="Lugar da equipa em cada medida">
      {[1, 2 / 3, 1 / 3].map((f) => {
        const r = r0 + (R - r0) * f;
        return (
          <div
            key={f}
            className={`absolute rounded-full border border-neutral-300 ${f === 1 ? '' : 'border-dashed'}`}
            style={{ left: cx - r, top: cy - r, width: 2 * r, height: 2 * r }}
          />
        );
      })}
      {slices.map((s, i) => {
        if (comparing) {
          const halfWidth = (step - 3) / 2;
          return [
            wedge(`${s.code}-a`, share(s.a), i * step + 1.5, halfWidth, TEAM_A),
            wedge(`${s.code}-b`, s.b ? share(s.b) : 0, i * step + 1.5 + halfWidth, halfWidth, TEAM_B),
          ];
        }
        return wedge(s.code, share(s.a), i * step + 1.2, step - 2.4, color);
      })}
      <div
        className="absolute rounded-full border border-neutral-300 bg-white"
        style={{ left: cx - r0, top: cy - r0, width: 2 * r0, height: 2 * r0 }}
      />
      {slices.map((s, i) => {
        const angle = ((i * step + step / 2 - 90) * Math.PI) / 180;
        const x = cx + (R + 42) * Math.cos(angle);
        const y = cy + (R + 28) * Math.sin(angle);
        return (
          <div
            key={s.code}
            className="absolute w-24 -translate-x-1/2 -translate-y-1/2 text-center leading-tight"
            style={{ left: x, top: y }}
          >
            <div className="text-[11px] text-neutral-600">{s.label}</div>
            <div className="text-xs font-bold text-neutral-900">
              {s.b ? (
                <>
                  <span style={{ color: TEAM_A }}>{place(s.a)}</span>
                  <span className="font-normal text-neutral-400"> · </span>
                  <span style={{ color: TEAM_B_TEXT }}>{place(s.b)}</span>
                </>
              ) : (
                place(s.a)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
