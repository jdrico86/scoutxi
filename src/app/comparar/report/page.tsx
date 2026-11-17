'use client';

/**
 * Relatório de uma página da comparação entre dois jogadores, para descarregar
 * como imagem. Endereço: /comparar/report?a=<id>&b=<id>[&profile=<id>].
 *
 * Mostra o que está na página Comparar (cartões, radar e tabela), com
 * cabeçalho próprio e largura fixa, sem os comandos.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { toPng } from 'html-to-image';
import { Radar } from '@/components/Radar';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  CLEAR_GAP,
  COLOR_A,
  COLOR_B,
  Dot,
  MetricRows,
  PlayerCard,
  type CompareResponse,
  type MetricRow,
} from '../parts';

const WIDTH = 920;

function ReportInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const a = searchParams.get('a') ?? '';
  const b = searchParams.get('b') ?? '';
  const profileId = searchParams.get('profile') ?? '';

  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!a || !b) return;
    let cancelled = false;
    const params = new URLSearchParams({ a, b });
    if (profileId) params.set('profile_id', profileId);
    fetch(`/api/players/compare?${params}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, json: j })))
      .then(({ ok, json }) => {
        if (cancelled) return;
        if (!ok) setError(json.error ?? 'Erro a carregar a comparação.');
        else setData(json as CompareResponse);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [a, b, profileId]);

  const back = () => {
    const params = new URLSearchParams({ a, b });
    if (profileId) params.set('profile', profileId);
    router.push(`/comparar?${params}`);
  };

  const handleExport = async () => {
    const node = cardRef.current;
    if (!node || !data) return;
    setExporting(true);
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const width = Math.ceil(node.getBoundingClientRect().width);
      const height = Math.ceil(node.scrollHeight);
      const dataUrl = await toPng(node, {
        quality: 1,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        style: { margin: '0', width: `${width}px`, height: `${height}px`, transform: 'none' },
      });
      const safe = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
      const link = document.createElement('a');
      link.download = `scout-xi_${safe(data.a.name)}_vs_${safe(data.b.name)}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      setError(`Erro a exportar: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  if (!a || !b) return <div className="p-10 text-sm text-neutral-500">Faltam os dois jogadores a comparar.</div>;
  if (error && !data) {
    return (
      <div className="p-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      </div>
    );
  }
  if (!data) return <div className="p-10 text-sm text-neutral-500">A carregar…</div>;

  // A mesma ordem da página Comparar: por peso no perfil, por categoria na posição.
  const rows: MetricRow[] = [...data.metrics];
  if (data.lens === 'profile') rows.sort((x, y) => (y.weight ?? 0) - (x.weight ?? 0));
  else {
    const order = (m: MetricRow) => {
      const i = CATEGORY_ORDER.indexOf(m.category);
      return i === -1 ? CATEGORY_ORDER.length : i;
    };
    rows.sort((x, y) => order(x) - order(y));
  }
  let aheadA = 0;
  let aheadB = 0;
  let level = 0;
  for (const m of data.metrics) {
    if (!m.a || !m.b) continue;
    const d = m.a.percentile - m.b.percentile;
    if (d >= CLEAR_GAP) aheadA++;
    else if (d <= -CLEAR_GAP) aheadB++;
    else level++;
  }
  const labels: Record<string, string> = {};
  for (const m of data.metrics) labels[m.metric_code] = m.label;
  const showWeights = data.lens === 'profile';
  const lensLine =
    data.lens === 'profile' && data.profile
      ? `Pelo perfil ${data.profile.name}`
      : data.lens === 'position'
        ? `Pelas métricas da posição de ${data.a.name} (${data.position_lens.position_a})`
        : '';
  const today = new Date().toLocaleDateString('pt-PT');

  return (
    <div className="min-h-screen overflow-x-auto bg-neutral-100 py-8">
      {/* Barra de cima (não entra na imagem) */}
      <div className="mx-auto mb-4 flex items-center justify-between px-6" style={{ width: WIDTH }}>
        <button type="button" onClick={back} className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Voltar à comparação
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || data.lens === 'none'}
          className="flex items-center gap-1.5 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          <Download className="h-4 w-4" strokeWidth={2} />
          {exporting ? 'A exportar…' : 'Descarregar'}
        </button>
      </div>
      {error && (
        <div className="mx-auto mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" style={{ width: WIDTH }}>
          {error}
        </div>
      )}

      {/* Folha (é o que se exporta) */}
      <div ref={cardRef} className="mx-auto bg-white" style={{ width: WIDTH }}>
        <div className="border-b-4 border-neutral-900 px-8 pb-6 pt-8">
          <div className="mb-1 text-xs font-medium uppercase tracking-widest text-neutral-500">
            Scout XI · Comparação de jogadores
          </div>
          <h1 className="flex flex-wrap items-center gap-x-4 gap-y-1 text-3xl font-semibold tracking-tight text-neutral-900">
            <span className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ background: COLOR_A }} />
              {data.a.name}
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ background: COLOR_B }} />
              {data.b.name}
            </span>
          </h1>
          {lensLine && <p className="mt-1 text-sm text-neutral-600">{lensLine}</p>}
        </div>

        <div className="space-y-4 bg-neutral-50 px-8 py-6">
          <div className="grid grid-cols-2 gap-4">
            <PlayerCard player={data.a} result={data.result_a} color={COLOR_A} showScore={data.lens === 'profile'} />
            <PlayerCard player={data.b} result={data.result_b} color={COLOR_B} showScore={data.lens === 'profile'} />
          </div>

          {!data.same_pool && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {data.same_competition ? 'Épocas diferentes.' : 'Ligas diferentes.'} Cada percentil é medido contra os
              jogadores da pool do próprio ({data.a.pool?.label ?? '—'} e {data.b.pool?.label ?? '—'}): o mesmo
              percentil não vale o mesmo nas duas.
            </div>
          )}

          {data.lens === 'none' ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-5 text-sm text-neutral-700">
              Não há uma comparação escolhida para estes dois jogadores. Volta atrás e escolhe um perfil.
            </div>
          ) : (
            <>
              <section className="rounded-lg border border-neutral-200 bg-white p-5">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold text-neutral-900">
                    {data.lens === 'profile' ? data.profile?.name : 'Métricas da posição'}
                  </h2>
                  <p className="text-xs text-neutral-500">
                    <Dot color={COLOR_A} /> à frente em {aheadA} · <Dot color={COLOR_B} /> à frente em {aheadB} · {level}{' '}
                    equilibradas
                  </p>
                </div>
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
                <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3">
                  <h2 className="text-sm font-semibold text-neutral-900">Métrica a métrica</h2>
                </div>
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
                      const newCategory = data.lens === 'position' && (i === 0 || rows[i - 1].category !== m.category);
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
              </section>
            </>
          )}
        </div>

        <div className="flex justify-between border-t border-neutral-200 px-8 py-3 text-xs text-neutral-500">
          <span>Dados Wyscout, tratados pelo Scout XI. Percentis contra os jogadores da mesma posição, na pool de cada um.</span>
          <span>{today}</span>
        </div>
      </div>
    </div>
  );
}

export default function CompareReportPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-neutral-500">A carregar…</div>}>
      <ReportInner />
    </Suspense>
  );
}
