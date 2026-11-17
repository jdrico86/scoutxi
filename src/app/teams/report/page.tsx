'use client';

/**
 * Relatório de uma página da estatística de equipa, para descarregar como
 * imagem. Com `vs` na URL, sai a comparação entre as duas equipas.
 *
 * Mostra exactamente o que está no separador "Estatística de equipa", com um
 * cabeçalho próprio e largura fixa, para sair igual em qualquer ecrã.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { toPng } from 'html-to-image';
import { TEAM_A, TEAM_B, TeamStatsBody, updateStamp, type StatsData } from '../TeamStatsTab';

const WIDTH = 1100;

function ReportInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const poolId = searchParams.get('pool') ?? '';
  const team = searchParams.get('team') ?? '';
  const vs = searchParams.get('vs') ?? '';
  const scope = searchParams.get('scope') === 'pool' ? 'pool' : 'serie';

  const [data, setData] = useState<StatsData | null>(null);
  const [poolName, setPoolName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!poolId || !team) return;
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
        if (!cancelled) setData(j);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const pool = ((j.pools ?? []) as Array<{ id: string; name: string }>).find((p) => p.id === poolId);
        setPoolName(pool?.name ?? '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [poolId, team, vs, scope]);

  const back = () => {
    const params = new URLSearchParams({ pool: poolId, team, tab: 'estatistica' });
    router.push(`/teams?${params}`);
  };

  const available = data && data.available ? data : null;
  const a = available?.team ?? null;
  const b = available?.vs ?? null;

  const handleExport = async () => {
    const node = cardRef.current;
    if (!node) return;
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
      link.download = `scout-xi_${safe(a?.team ?? 'equipa')}${b ? `_vs_${safe(b.team)}` : ''}_estatistica.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      setError(`Erro a exportar: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  if (!poolId || !team) {
    return <div className="p-10 text-sm text-neutral-500">Falta escolher a equipa.</div>;
  }
  if (error && !available) {
    return (
      <div className="p-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      </div>
    );
  }
  if (!data) return <div className="p-10 text-sm text-neutral-500">A carregar…</div>;
  if (!available || !a) {
    return (
      <div className="p-10 text-sm text-neutral-500">
        Não há estatísticas importadas para esta equipa.{' '}
        <button type="button" onClick={back} className="underline">
          Voltar
        </button>
      </div>
    );
  }

  const stamp = updateStamp(available);
  const games = b ? `${a.games} e ${b.games} jogos` : `${a.games} jogo${a.games === 1 ? '' : 's'}`;
  const today = new Date().toLocaleDateString('pt-PT');

  return (
    <div className="min-h-screen overflow-x-auto bg-neutral-100 py-8">
      {/* Barra de cima (não entra na imagem) */}
      <div className="mx-auto mb-4 flex items-center justify-between px-6" style={{ width: WIDTH }}>
        <button type="button" onClick={back} className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900">
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Voltar à equipa
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
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
            Scout XI · {b ? 'Comparação de equipas' : 'Estatística de equipa'}
          </div>
          {b ? (
            <h1 className="flex flex-wrap items-center gap-x-4 gap-y-1 text-3xl font-semibold tracking-tight text-neutral-900">
              <span className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ background: TEAM_A }} />
                {a.team}
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ background: TEAM_B }} />
                {b.team}
              </span>
            </h1>
          ) : (
            <h1 className="text-4xl font-semibold tracking-tight text-neutral-900">{a.team}</h1>
          )}
          <p className="mt-1 text-sm text-neutral-600">{[poolName, stamp, games].filter(Boolean).join(' · ')}</p>
        </div>

        <div className="space-y-3 bg-neutral-50 px-8 py-6">
          <TeamStatsBody data={available} fixed />
        </div>

        <div className="flex justify-between border-t border-neutral-200 px-8 py-3 text-xs text-neutral-500">
          <span>Dados Wyscout, tratados pelo Scout XI.</span>
          <span>{today}</span>
        </div>
      </div>
    </div>
  );
}

export default function TeamReportPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-neutral-500">A carregar…</div>}>
      <ReportInner />
    </Suspense>
  );
}
