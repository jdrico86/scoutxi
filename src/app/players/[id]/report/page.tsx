'use client';

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, ArrowLeft } from 'lucide-react';
import { toPng } from 'html-to-image';

type Player = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  positions_secondary: string[] | null;
  age: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  foot: string | null;
  nationality: string | null;
  naturality: string | null;
  contract_until: string | null;
  market_value_eur: number | null;
  minutes_played: number | null;
  games_played: number | null;
};

type Pool = { id: string; name: string; season: string; competition: string | null };

type ApplicableProfile = {
  profile_id: string;
  profile_name: string;
  profile_description: string | null;
  is_seed: boolean;
  score: number | null;
  rank: number | null;
  eligible: boolean;
  total_eligible: number;
};

type Note = { note: string | null; status: string | null };

type PlayerDetail = {
  player: Player;
  pool: Pool | null;
  note: Note | null;
  applicable_profiles: ApplicableProfile[];
};

type Contribution = {
  metric_code: string;
  raw_value: number | null;
  percentile: number;
  weight: number;
  contribution: number;
};

type ProfileBreakdown = {
  score: number;
  contributions: Contribution[];
  missing_metrics: string[];
};

function ReportCardContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlProfileId = searchParams.get('profile');

  const [data, setData] = useState<PlayerDetail | null>(null);
  const [breakdown, setBreakdown] = useState<ProfileBreakdown | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<ApplicableProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/players/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(j.error);
          return;
        }
        setData(j);
        const eligible = (j.applicable_profiles ?? []).filter(
          (p: ApplicableProfile) => p.eligible && p.score != null
        );
        let chosen: ApplicableProfile | null = null;
        if (urlProfileId) {
          chosen = eligible.find((p: ApplicableProfile) => p.profile_id === urlProfileId) ?? null;
        }
        if (!chosen && eligible.length > 0) {
          chosen = eligible[0];
        }
        setSelectedProfile(chosen);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id, urlProfileId]);

  useEffect(() => {
    if (!selectedProfile || !data?.pool) return;
    fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pool_id: data.pool.id,
        profile_id: selectedProfile.profile_id,
        limit: 500,
      }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return;
        const found = (j.ranked ?? []).find((p: { player_id: string }) => p.player_id === id);
        if (found) {
          setBreakdown({
            score: found.score,
            contributions: found.contributions,
            missing_metrics: found.missing_metrics ?? [],
          });
        }
      });
  }, [selectedProfile, data?.pool, id]);

const handleExport = useCallback(async () => {
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const node = cardRef.current;
      // Esperar pelas fontes carregarem antes de capturar (importante para o Geist)
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      // Pequeno delay para garantir que SVGs e DOM estão totalmente renderizados
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Medidas reais do nó após fontes carregadas
      const rect = node.getBoundingClientRect();
      const width = Math.ceil(rect.width);
      const height = Math.ceil(node.scrollHeight);

      const dataUrl = await toPng(node, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        style: {
          margin: '0',
          width: `${width}px`,
          height: `${height}px`,
          transform: 'none',
        },
      });
      const link = document.createElement('a');
      const safeName = (data?.player.name ?? 'jogador').replace(/[^a-zA-Z0-9]+/g, '_');
      const safeProfile = (selectedProfile?.profile_name ?? 'perfil').replace(/[^a-zA-Z0-9]+/g, '_');
      link.download = `scout-xi_${safeName}_${safeProfile}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      alert(`Erro a exportar: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }, [data?.player.name, selectedProfile?.profile_name]);

  if (loading) {
    return <div className="p-10 text-sm text-neutral-500">A carregar…</div>;
  }
  if (error || !data) {
    return (
      <div className="p-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error ?? 'Sem dados.'}
        </div>
      </div>
    );
  }

  const { player, pool, note, applicable_profiles } = data;
  const eligibleProfiles = applicable_profiles.filter((p) => p.eligible && p.score != null);

  return (
    <div className="min-h-screen bg-neutral-100 py-8">
      {/* Barra superior (NÃO entra na imagem) */}
      <div className="mx-auto mb-4 flex max-w-[820px] items-center justify-between px-6">
        <button
          type="button"
          onClick={() => router.push(`/players/${id}`)}
          className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Voltar ao jogador
        </button>

        <div className="flex items-center gap-3">
          {eligibleProfiles.length > 1 && (
            <select
              value={selectedProfile?.profile_id ?? ''}
              onChange={(e) => {
                const p = eligibleProfiles.find((x) => x.profile_id === e.target.value);
                if (p) {
                  setSelectedProfile(p);
                  router.replace(`/players/${id}/report?profile=${p.profile_id}`, { scroll: false });
                }
              }}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs"
            >
              {eligibleProfiles.map((p) => (
                <option key={p.profile_id} value={p.profile_id}>
                  {p.profile_name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || !breakdown}
            className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" strokeWidth={2} />
            {exporting ? 'A exportar…' : 'Exportar PNG'}
          </button>
        </div>
      </div>

      {/* Cartão (é o que se exporta) */}
      <div
        ref={cardRef}
        className="mx-auto bg-white"
        style={{ width: 820, minHeight: 1100 }}
      >
        {/* Header */}
        <div className="border-b-4 border-neutral-900 p-8">
          <div className="mb-1 text-xs font-medium uppercase tracking-widest text-neutral-500">
            Scout XI · Report Card
          </div>
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">
                {player.name}
              </h1>
              <p className="mt-1 text-base text-neutral-700">
                {[player.current_team, player.position_primary, player.age ? `${player.age} anos` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-0.5 text-sm text-neutral-500">
                {pool ? `${pool.name} ${pool.season}` : ''}
              </p>
            </div>
            {selectedProfile && breakdown && (
              <div className="text-right">
                <div className="text-xs font-medium uppercase tracking-wider text-neutral-500">
                  {selectedProfile.profile_name}
                </div>
                <div className="mt-1 text-5xl font-semibold tracking-tight text-neutral-900">
                  {breakdown.score.toFixed(1)}
                </div>
                <div className="mt-0.5 text-sm text-neutral-500">
                  #{selectedProfile.rank} de {selectedProfile.total_eligible} elegíveis
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bio */}
        <div className="border-b border-neutral-200 px-8 py-5">
          <div className="grid grid-cols-4 gap-x-6 gap-y-3 text-sm">
            <BioField label="Altura" value={player.height_cm ? `${player.height_cm} cm` : null} />
            <BioField label="Peso" value={player.weight_kg ? `${player.weight_kg} kg` : null} />
            <BioField label="Pé" value={player.foot} />
            <BioField label="Nacionalidade" value={player.nationality} />
            <BioField label="Naturalidade" value={player.naturality} />
            <BioField label="Minutos" value={player.minutes_played?.toLocaleString() ?? null} />
            <BioField label="Jogos" value={player.games_played?.toString() ?? null} />
            <BioField label="Contrato até" value={player.contract_until} />
            <BioField
              label="Valor de mercado"
              value={player.market_value_eur ? `€${player.market_value_eur.toLocaleString()}` : null}
            />
          </div>
        </div>

        {/* Radar + descrição do perfil */}
        {selectedProfile && breakdown && (
          <>
            <div className="grid grid-cols-2 gap-0">
              <div className="border-r border-neutral-200 p-6">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
                  Perfil
                </div>
                <h2 className="text-lg font-semibold text-neutral-900">
                  {selectedProfile.profile_name}
                </h2>
                {selectedProfile.profile_description && (
                  <p className="mt-2 text-sm text-neutral-600">{selectedProfile.profile_description}</p>
                )}
                {note?.note && (
                  <div className="mt-5 rounded-md bg-neutral-50 p-3">
                    <div className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-500">
                      Nota do analista
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-neutral-700">{note.note}</p>
                  </div>
                )}
              </div>
              <div className="p-2">
                <ReportRadar contributions={breakdown.contributions} />
              </div>
            </div>

            {/* Breakdown */}
            <div className="border-t border-neutral-200 px-8 py-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Métricas
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-neutral-500">
                  <tr className="border-b border-neutral-200">
                    <th className="py-1.5 pr-3 font-medium">Métrica</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Valor</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Percentil</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Peso</th>
                    <th className="py-1.5 text-right font-medium">Contribui</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.contributions.map((c) => (
                    <tr key={c.metric_code} className="border-b border-neutral-100 last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-xs text-neutral-700">
                        {c.metric_code}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-neutral-700">
                        {c.raw_value == null ? '—' : c.raw_value.toFixed(2)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <span
                          className={
                            c.percentile >= 80
                              ? 'font-semibold text-emerald-700'
                              : c.percentile >= 50
                                ? 'text-neutral-700'
                                : 'text-neutral-400'
                          }
                        >
                          {c.percentile.toFixed(1)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right text-neutral-600">{c.weight}%</td>
                      <td className="py-1.5 text-right font-medium text-neutral-900">
                        {c.contribution.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Footer */}
        <div className="border-t border-neutral-200 px-8 py-4 text-xs text-neutral-500">
          <div className="flex items-center justify-between">
            <span>Scout XI · Gerado em {new Date().toLocaleDateString('pt-PT')}</span>
            <span>
              Percentis calculados no pool {pool?.name} {pool?.season}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BioField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="mt-0.5 text-neutral-900">{value ?? '—'}</div>
    </div>
  );
}

function ReportRadar({ contributions }: { contributions: Contribution[] }) {
  const size = 380;
  const center = size / 2;
  const radius = size / 2 - 60;
  const n = contributions.length;
  if (n === 0) return null;

  const points = contributions.map((c, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (c.percentile / 100) * radius;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      labelX: center + (radius + 18) * Math.cos(angle),
      labelY: center + (radius + 18) * Math.sin(angle),
      axisX: center + radius * Math.cos(angle),
      axisY: center + radius * Math.sin(angle),
      label: c.metric_code,
      percentile: c.percentile,
    };
  });

  const pathD = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ') + ' Z';
  const ringLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" className="block" preserveAspectRatio="xMidYMid meet">
      {ringLevels.map((level) => {
        const pts = Array.from({ length: n }, (_, i) => {
          const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
          const r = level * radius;
          return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(' ');
        return (
          <polygon
            key={level}
            points={pts}
            fill="none"
            stroke="#e5e5e5"
            strokeWidth={1}
          />
        );
      })}

      {points.map((p, i) => (
        <line
          key={`axis-${i}`}
          x1={center}
          y1={center}
          x2={p.axisX}
          y2={p.axisY}
          stroke="#e5e5e5"
          strokeWidth={1}
        />
      ))}

      <path d={pathD} fill="#10b981" fillOpacity={0.25} stroke="#10b981" strokeWidth={2} />

      {points.map((p, i) => (
        <circle key={`dot-${i}`} cx={p.x} cy={p.y} r={3.5} fill="#10b981" />
      ))}

      {points.map((p, i) => {
        let anchor: 'start' | 'middle' | 'end' = 'middle';
        if (p.labelX < center - 10) anchor = 'end';
        else if (p.labelX > center + 10) anchor = 'start';
        return (
          <g key={`label-${i}`}>
            <text
              x={p.labelX}
              y={p.labelY - 4}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={10}
              fill="#525252"
              fontFamily="monospace"
            >
              {p.label}
            </text>
            <text
              x={p.labelX}
              y={p.labelY + 8}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={600}
              fill="#171717"
            >
              {p.percentile.toFixed(0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
export default function ReportCardPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={<div className="p-10 text-sm text-neutral-500">A carregar…</div>}
    >
      <ReportCardContent params={params} />
    </Suspense>
  );
}