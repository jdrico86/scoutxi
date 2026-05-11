'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FORMATIONS, type FormationDef, type SlotDef } from '@/lib/best-eleven/formations';
import { formatPoolName } from '@/lib/pools';

type Pool = { id: string; name: string; season: string; competition: string | null };

type ProfileListItem = {
  id: string;
  name: string;
  description: string | null;
  tags: string[] | null;
  filters: {
    positions?: string[];
    min_minutes?: number;
    min_age?: number;
    max_age?: number;
  } | null;
};

type Assignment = {
  slot_id: string;
  slot_label: string;
  profile_id: string;
  profile_name: string;
  player_id: string | null;
  player_name: string | null;
  player_team: string | null;
  player_position: string | null;
  player_age: number | null;
  score: number | null;
  slot_x: number;
  slot_y: number;
  alternatives: Array<{
    player_id: string;
    player_name: string;
    player_team: string | null;
    player_position: string | null;
    score: number;
  }>;
};

type Result = {
  pool: Pool | null;
  formation: { id: string; name: string; description: string };
  filters: { max_age?: number; max_market_value_eur?: number } | null;
  assignments: Assignment[];
  total_score: number;
  unfilled_count: number;
  eligible_pool_size: number;
};

function BestElevenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Ler estado inicial dos search params
  const initialPool = searchParams.get('pool') ?? '';
  const initialFormation = searchParams.get('formation') ?? '4-3-3';
  const initialMaxAge = searchParams.get('max_age') ?? '';
  const initialMaxValue = searchParams.get('max_value') ?? '';
  // slot_profiles vêm em formato JSON comprimido: s=key1:id1,key2:id2
  const initialSlotStr = searchParams.get('slots') ?? '';
  const initialSlotProfiles: Record<string, string> = {};
  if (initialSlotStr) {
    for (const pair of initialSlotStr.split(',')) {
      const [k, v] = pair.split(':');
      if (k && v) initialSlotProfiles[k] = v;
    }
  }

  const [pools, setPools] = useState<Pool[]>([]);
  const [profiles, setProfiles] = useState<ProfileListItem[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string>(initialPool);
  const [selectedFormationId, setSelectedFormationId] = useState<string>(initialFormation);
  const [slotProfiles, setSlotProfiles] = useState<Record<string, string>>(initialSlotProfiles);
  const [maxAge, setMaxAge] = useState<string>(initialMaxAge);
  const [maxValue, setMaxValue] = useState<string>(initialMaxValue);

  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoAppliedOnce, setAutoAppliedOnce] = useState(false);

  // Sincronizar URL sempre que mudam as selecções relevantes
  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedPoolId) params.set('pool', selectedPoolId);
    if (selectedFormationId) params.set('formation', selectedFormationId);
    if (maxAge.trim()) params.set('max_age', maxAge.trim());
    if (maxValue.trim()) params.set('max_value', maxValue.trim());
    const slotEntries = Object.entries(slotProfiles).filter(([, v]) => v);
    if (slotEntries.length > 0) {
      params.set('slots', slotEntries.map(([k, v]) => `${k}:${v}`).join(','));
    }
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `/best-eleven?${next}` : '/best-eleven', { scroll: false });
    }
  }, [selectedPoolId, selectedFormationId, slotProfiles, maxAge, maxValue, router, searchParams]);

  useEffect(() => {
    fetch('/api/pools')
      .then((r) => r.json())
      .then((j) => setPools(j.pools ?? []));
    fetch('/api/profiles')
      .then((r) => r.json())
      .then((j) => setProfiles(j.profiles ?? []));
  }, []);

  const formation: FormationDef = useMemo(
    () => FORMATIONS.find((f) => f.id === selectedFormationId) ?? FORMATIONS[0],
    [selectedFormationId]
  );

  // Sugerir perfis por slot (pegando nos primeiros compatíveis) quando a formação muda
  useEffect(() => {
    if (profiles.length === 0) return;
    const newProfiles: Record<string, string> = {};
    for (const slot of formation.slots) {
      const existing = slotProfiles[slot.id];
      if (existing && isProfileValidForSlot(profiles, existing, slot)) {
        newProfiles[slot.id] = existing;
        continue;
      }
      const firstMatch = profiles.find((p) => isProfileValidForSlot([p], p.id, slot));
      if (firstMatch) newProfiles[slot.id] = firstMatch.id;
    }
    setSlotProfiles(newProfiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formation.id, profiles]);

  const run = useCallback(async () => {
    if (!selectedPoolId) {
      setError('Escolhe um pool.');
      return;
    }
    const missing = formation.slots.filter((s) => !slotProfiles[s.id]);
    if (missing.length > 0) {
      setError(`Faltam perfis para: ${missing.map((s) => s.label).join(', ')}`);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const filters: { max_age?: number; max_market_value_eur?: number } = {};
      if (maxAge.trim()) filters.max_age = parseInt(maxAge, 10);
      if (maxValue.trim()) filters.max_market_value_eur = parseInt(maxValue, 10);

      const res = await fetch('/api/best-eleven', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pool_id: selectedPoolId,
          formation_id: formation.id,
          slot_profiles: slotProfiles,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro a gerar o Melhor 11.');
      setResult(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedPoolId, formation, slotProfiles, maxAge, maxValue]);
  // Auto-apply quando chegamos com params + listas carregadas e slots todos preenchidos
  useEffect(() => {
    if (autoAppliedOnce) return;
    if (!selectedPoolId) return;
    if (profiles.length === 0 || pools.length === 0) return;
    // Confirmar que todos os slots da formação têm perfil atribuído
    const allSlotsFilled = formation.slots.every((s) => slotProfiles[s.id]);
    if (!allSlotsFilled) return;
    setAutoAppliedOnce(true);
    run();
  }, [autoAppliedOnce, selectedPoolId, profiles.length, pools.length, formation.slots, slotProfiles, run]);

  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <div className="mx-auto max-w-6xl px-6">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900">Melhor 11</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Escolhe um pool, uma formação táctica, e um perfil por posição. A plataforma gera o onze
            óptimo maximizando a soma dos scores, sem repetir jogadores.
          </p>
        </header>

        {/* Configuração */}
        <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                Pool
              </label>
              <select
                value={selectedPoolId}
                onChange={(e) => setSelectedPoolId(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">— escolher pool —</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatPoolName(p.name, p.season)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                Formação
              </label>
              <select
                value={selectedFormationId}
                onChange={(e) => setSelectedFormationId(e.target.value)}
                className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
              >
                {FORMATIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-500">{formation.description}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                  Idade máx
                </label>
                <input
                  type="number"
                  placeholder="—"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value)}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-500">
                  Valor máx €
                </label>
                <input
                  type="number"
                  placeholder="—"
                  value={maxValue}
                  onChange={(e) => setMaxValue(e.target.value)}
                  className="w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Slots agrupados por linha do campo */}
          <div className="mt-5">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
              Perfil por posição
            </div>
            <div className="space-y-4">
              {(['GK', 'DEF', 'MID', 'ATT'] as const).map((line) => {
                const slotsInLine = formation.slots.filter((s) => s.line === line);
                if (slotsInLine.length === 0) return null;
                const lineLabels: Record<typeof line, string> = {
                  GK: 'Guarda-redes',
                  DEF: 'Defesa',
                  MID: 'Médio',
                  ATT: 'Ataque',
                };
                return (
                  <div key={line}>
                    <div className="mb-1.5 text-xs font-medium text-neutral-500">
                      {lineLabels[line]}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
                      {slotsInLine.map((slot) => {
                        const eligible = profiles.filter((p) => isProfileValidForSlot([p], p.id, slot));
                        return (
                          <div key={slot.id} className="flex items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
                            <div className="w-14 shrink-0 text-xs font-medium text-neutral-700">{slot.label}</div>
                            <select
                              value={slotProfiles[slot.id] ?? ''}
                              onChange={(e) =>
                                setSlotProfiles((prev) => ({ ...prev, [slot.id]: e.target.value }))
                              }
                              className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs"
                            >
                              <option value="">— escolher —</option>
                              {eligible.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {formation.slots.some(
              (s) => profiles.filter((p) => isProfileValidForSlot([p], p.id, s)).length === 0
            ) && (
              <p className="mt-2 text-xs text-amber-700">
                Aviso: alguns slots não têm perfis compatíveis. Cria perfis com posições apropriadas em /profiles.
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={loading || !selectedPoolId}
              className="rounded-md bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {loading ? 'A calcular…' : 'Gerar Melhor 11'}
            </button>
            {error && <span className="text-sm text-red-700">{error}</span>}
          </div>
        </section>

        {result && <BestElevenResult result={result} router={router} />}
      </div>
    </main>
  );
}

function isProfileValidForSlot(
  profilePool: ProfileListItem[],
  profileId: string,
  slot: SlotDef
): boolean {
  const profile = profilePool.find((p) => p.id === profileId);
  if (!profile) return false;
  const positions = profile.filters?.positions ?? [];
  if (positions.length === 0) return true;
  return positions.some((pos) => slot.accepted_positions.includes(pos));
}

function BestElevenResult({
  result,
  router,
}: {
  result: Result;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <>
      <section className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              {result.formation.name} · {result.pool?.name} {result.pool?.season}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              Score total: <strong className="text-neutral-700">{result.total_score.toFixed(1)}</strong>
              {' · '}
              {result.eligible_pool_size} jogadores elegíveis no pool
              {result.unfilled_count > 0 && (
                <>
                  {' · '}
                  <span className="text-red-700">{result.unfilled_count} slot(s) sem jogador</span>
                </>
              )}
            </p>
          </div>
        </div>

        <Pitch assignments={result.assignments} router={router} />
      </section>

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3">
          <h3 className="text-sm font-semibold text-neutral-900">Detalhe por posição</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-2">Pos</th>
              <th className="px-4 py-2">Perfil</th>
              <th className="px-4 py-2">Jogador</th>
              <th className="px-4 py-2">Equipa</th>
              <th className="px-4 py-2">Idade</th>
              <th className="px-4 py-2 text-right">Score</th>
              <th className="px-4 py-2">Alternativas</th>
            </tr>
          </thead>
          <tbody>
            {result.assignments.map((a) => (
              <tr key={a.slot_id} className="border-t border-neutral-100">
                <td className="px-4 py-3 font-medium text-neutral-700">{a.slot_label}</td>
                <td className="px-4 py-3 text-xs text-neutral-600">{a.profile_name}</td>
                <td className="px-4 py-3">
                  {a.player_id ? (
                    <button
                      type="button"
                      onClick={() => router.push(`/players/${a.player_id}`)}
                      className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                    >
                      {a.player_name}
                    </button>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-700">{a.player_team ?? '—'}</td>
                <td className="px-4 py-3 text-neutral-600">{a.player_age ?? '—'}</td>
                <td className="px-4 py-3 text-right font-semibold text-neutral-900">
                  {a.score != null ? a.score.toFixed(1) : '—'}
                </td>
                <td className="px-4 py-3">
                  {a.alternatives.length === 0 ? (
                    <span className="text-xs text-neutral-400">—</span>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {a.alternatives.map((alt) => (
                        <button
                          key={alt.player_id}
                          type="button"
                          onClick={() => router.push(`/players/${alt.player_id}`)}
                          className="text-left text-xs text-neutral-600 hover:text-emerald-700 hover:underline"
                        >
                          {alt.player_name} <span className="text-neutral-400">· {alt.score.toFixed(1)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Pitch({
  assignments,
  router,
}: {
  assignments: Assignment[];
  router: ReturnType<typeof useRouter>;
}) {
  const w = 340;
  const h = 510;
  const padding = 10;

  const toSVG = (x: number, y: number) => ({
    cx: padding + (x / 100) * (w - 2 * padding),
    cy: h - (padding + (y / 100) * (h - 2 * padding)),
  });

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="mx-auto w-full" style={{ maxWidth: w }}>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="block rounded-md" preserveAspectRatio="xMidYMid meet">
          <rect x={0} y={0} width={w} height={h} fill="#15803d" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect
              key={i}
              x={0}
              y={(i * h) / 8}
              width={w}
              height={h / 8}
              fill={i % 2 === 0 ? '#16a34a' : '#15803d'}
              opacity={0.35}
            />
          ))}
          <g stroke="white" strokeWidth={1.5} fill="none" opacity={0.9}>
            <rect x={padding} y={padding} width={w - 2 * padding} height={h - 2 * padding} />
            <line x1={padding} y1={h / 2} x2={w - padding} y2={h / 2} />
            <circle cx={w / 2} cy={h / 2} r={36} />
            <circle cx={w / 2} cy={h / 2} r={1.5} fill="white" />
            <rect x={w / 2 - 70} y={h - padding - 60} width={140} height={60} />
            <rect x={w / 2 - 30} y={h - padding - 22} width={60} height={22} />
            <rect x={w / 2 - 70} y={padding} width={140} height={60} />
            <rect x={w / 2 - 30} y={padding} width={60} height={22} />
          </g>

          {assignments.map((a) => {
            const { cx, cy } = toSVG(a.slot_x, a.slot_y);
            const filled = a.player_id != null;
            return (
              <g key={a.slot_id}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={18}
                  fill={filled ? '#fef3c7' : '#fecaca'}
                  stroke={filled ? '#f59e0b' : '#ef4444'}
                  strokeWidth={2}
                  style={{ cursor: filled ? 'pointer' : 'default' }}
                  onClick={() => a.player_id && router.push(`/players/${a.player_id}`)}
                />
                <text
                  x={cx}
                  y={cy + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={8}
                  fontWeight={600}
                  fill="#171717"
                  style={{ pointerEvents: 'none' }}
                >
                  {a.slot_label}
                </text>
                {filled && (
                  <>
                    <text
                      x={cx}
                      y={cy + 30}
                      textAnchor="middle"
                      fontSize={10}
                      fontWeight={600}
                      fill="white"
                      stroke="#14532d"
                      strokeWidth={0.5}
                      paintOrder="stroke fill"
                    >
                      {truncate(a.player_name ?? '', 14)}
                    </text>
                    <text
                      x={cx}
                      y={cy + 42}
                      textAnchor="middle"
                      fontSize={8}
                      fill="#f5f5f5"
                      stroke="#14532d"
                      strokeWidth={0.5}
                      paintOrder="stroke fill"
                    >
                      {a.score?.toFixed(1)} · {a.player_age ?? '?'}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex-1">
        <p className="mb-3 text-xs text-neutral-500">
          Clica num círculo para abrir a ficha do jogador.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {assignments.map((a) => (
            <div
              key={a.slot_id}
              className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-neutral-700">{a.slot_label}</span>
                {a.score != null && (
                  <span className="font-semibold text-neutral-900">{a.score.toFixed(1)}</span>
                )}
              </div>
              <div className="mt-0.5 text-neutral-900">
                {a.player_name ? (
                  <button
                    type="button"
                    onClick={() => a.player_id && router.push(`/players/${a.player_id}`)}
                    className="font-medium hover:text-emerald-700 hover:underline"
                  >
                    {a.player_name}
                  </button>
                ) : (
                  <span className="text-red-700">Sem jogador elegível</span>
                )}
              </div>
              <div className="text-neutral-500">
                {[a.player_team, a.player_position].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export default function BestElevenPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-neutral-50 py-10">
          <div className="mx-auto max-w-6xl px-6 text-sm text-neutral-500">
            A carregar…
          </div>
        </main>
      }
    >
      <BestElevenContent />
    </Suspense>
  );
}