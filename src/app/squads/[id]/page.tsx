'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, X, Plus, Search, Check } from 'lucide-react';
import { FORMATIONS, getFormation, type FormationDef, type SlotDef } from '@/lib/best-eleven/formations';
import { ModalShell } from '@/components/ModalShell';

type SquadPlayer = {
  player_id: string;
  name: string | null;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  pool_id: string | null;
  pool_name: string | null;
  slot: string | null;
  is_starter: boolean;
  squad_note: string | null;
  added_at: string;
};

type SquadDetail = {
  id: string;
  name: string;
  formation: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  players: SquadPlayer[];
};

type ScoreInfo = { score: number; profile_name: string };

type SearchHit = {
  id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  pool_name: string | null;
};

const FORMATION_IDS = FORMATIONS.map((f) => f.id);

export default function SquadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [squad, setSquad] = useState<SquadDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<Map<string, ScoreInfo>>(new Map());

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);

  const [pickerSlot, setPickerSlot] = useState<SlotDef | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/squads/${id}`);
    const j = await res.json();
    if (!res.ok) {
      setError(j.error ?? 'Erro a carregar equipa.');
      setSquad(null);
    } else {
      setSquad(j);
      setNameDraft(j.name);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  // Fetch scores em paralelo para cada jogador da squad
  useEffect(() => {
    if (!squad) return;
    const ids = squad.players.map((p) => p.player_id);
    if (ids.length === 0) return;

    const missing = ids.filter((pid) => !scores.has(pid));
    if (missing.length === 0) return;

    let cancelled = false;
    Promise.all(
      missing.map((pid) =>
        fetch(`/api/players/${pid}`)
          .then((r) => r.json())
          .then((j): [string, ScoreInfo | null] => {
            const top = (j.applicable_profiles ?? []).find(
              (p: { eligible: boolean; score: number | null }) => p.eligible && p.score != null
            );
            if (!top) return [pid, null];
            return [pid, { score: top.score, profile_name: top.profile_name }];
          })
          .catch(() => [pid, null] as [string, ScoreInfo | null])
      )
    ).then((results) => {
      if (cancelled) return;
      setScores((prev) => {
        const next = new Map(prev);
        for (const [pid, info] of results) {
          if (info) next.set(pid, info);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [squad, scores]);

  const formation: FormationDef = useMemo(
    () => getFormation(squad?.formation ?? '4-3-3') ?? FORMATIONS[0],
    [squad?.formation]
  );

  const playerBySlot = useMemo(() => {
    const map = new Map<string, SquadPlayer>();
    if (!squad) return map;
    for (const p of squad.players) {
      if (p.is_starter && p.slot) map.set(p.slot, p);
    }
    return map;
  }, [squad]);

  const benchPlayers = useMemo(
    () => (squad?.players ?? []).filter((p) => !p.is_starter || !p.slot),
    [squad]
  );

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!squad || !name || name === squad.name) {
      setEditingName(false);
      setNameDraft(squad?.name ?? '');
      return;
    }
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/squads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        setSquad((s) => (s ? { ...s, name } : s));
        setEditingName(false);
      } else {
        const j = await res.json();
        alert(`Erro: ${j.error}`);
      }
    } finally {
      setSavingMeta(false);
    }
  };

  const changeFormation = async (newFormation: string) => {
    if (!squad || newFormation === squad.formation) return;
    setSavingMeta(true);
    try {
      const res = await fetch(`/api/squads/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formation: newFormation }),
      });
      const j = await res.json();
      if (!res.ok) {
        alert(`Erro: ${j.error}`);
        return;
      }
      if (j.slots_invalidated > 0) {
        setBanner({
          kind: 'warn',
          text: `${j.slots_invalidated} jogador(es) movido(s) para o banco — slot já não existe na nova formação.`,
        });
      } else {
        setBanner(null);
      }
      await reload();
    } finally {
      setSavingMeta(false);
    }
  };

  const deleteSquad = async () => {
    if (!squad) return;
    if (!confirm(`Apagar a equipa "${squad.name}"? Esta acção não pode ser desfeita.`)) return;
    const res = await fetch(`/api/squads/${id}`, { method: 'DELETE' });
    if (res.ok) router.push('/squads');
  };

  const removePlayer = async (playerId: string) => {
    const res = await fetch(`/api/squads/${id}/players/${playerId}`, { method: 'DELETE' });
    if (res.ok) await reload();
  };

  const assignSlot = async (playerId: string, slotId: string, isInSquad: boolean) => {
    let res: Response;
    if (isInSquad) {
      res = await fetch(`/api/squads/${id}/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: slotId }),
      });
    } else {
      res = await fetch(`/api/squads/${id}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player_id: playerId, slot: slotId }),
      });
    }
    if (!res.ok && res.status !== 409) {
      const j = await res.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? 'desconhecido'}`);
      return;
    }
    setPickerSlot(null);
    await reload();
  };

  const addToBench = async (playerId: string) => {
    const res = await fetch(`/api/squads/${id}/players`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: playerId }),
    });
    if (!res.ok && res.status !== 409) {
      const j = await res.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? 'desconhecido'}`);
      return;
    }
    setAddOpen(false);
    await reload();
  };

  if (loading) {
    return <div className="p-10 text-sm text-neutral-500">A carregar…</div>;
  }
  if (error || !squad) {
    return (
      <div className="p-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error ?? 'Equipa não encontrada.'}
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-50 py-8">
      <div className="mx-auto max-w-6xl px-6">
        <button
          type="button"
          onClick={() => router.push('/squads')}
          className="mb-3 text-xs text-neutral-500 hover:text-neutral-800"
        >
          ← Minhas equipas
        </button>

        {/* Header */}
        <header className="mb-6 rounded-lg border border-neutral-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    autoFocus
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName();
                      if (e.key === 'Escape') {
                        setEditingName(false);
                        setNameDraft(squad.name);
                      }
                    }}
                    className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-2xl font-semibold text-neutral-900 focus:border-neutral-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold text-neutral-900">{squad.name}</h1>
                  <button
                    type="button"
                    onClick={() => setEditingName(true)}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    title="Editar nome"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              )}
              <p className="mt-1 text-xs text-neutral-500">
                {squad.players.length} jogador{squad.players.length === 1 ? '' : 'es'} ·
                {' '}
                {squad.players.filter((p) => p.is_starter && p.slot).length}/11 titulares
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={squad.formation}
                onChange={(e) => changeFormation(e.target.value)}
                disabled={savingMeta}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium"
              >
                {FORMATION_IDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={deleteSquad}
                className="flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                title="Apagar equipa"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                Apagar
              </button>
            </div>
          </div>

          {banner && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                banner.kind === 'warn'
                  ? 'border-amber-200 bg-amber-50 text-amber-800'
                  : 'border-blue-200 bg-blue-50 text-blue-800'
              }`}
            >
              <span className="flex-1">{banner.text}</span>
              <button type="button" onClick={() => setBanner(null)} className="hover:underline">
                Fechar
              </button>
            </div>
          )}
        </header>

        {/* Layout 2 colunas */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Campo */}
          <section className="rounded-lg border border-neutral-200 bg-white p-5 lg:col-span-2">
            <Pitch
              formation={formation}
              playerBySlot={playerBySlot}
              scores={scores}
              onSlotClick={(slot) => setPickerSlot(slot)}
              onPlayerClick={(playerId) => router.push(`/players/${playerId}`)}
            />
          </section>

          {/* Lista lateral */}
          <section className="rounded-lg border border-neutral-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-900">Plantel</h2>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
              >
                <Plus className="h-3 w-3" strokeWidth={2} />
                Adicionar
              </button>
            </div>

            <Roster
              formation={formation}
              players={squad.players}
              benchPlayers={benchPlayers}
              scores={scores}
              onRemove={removePlayer}
            />
          </section>
        </div>
      </div>

      {/* Modais */}
      {pickerSlot && (
        <SlotPickerModal
          slot={pickerSlot}
          squadPlayers={squad.players}
          onClose={() => setPickerSlot(null)}
          onAssign={assignSlot}
        />
      )}

      {addOpen && (
        <AddPlayerModal
          existingIds={new Set(squad.players.map((p) => p.player_id))}
          onClose={() => setAddOpen(false)}
          onAdd={addToBench}
        />
      )}
    </main>
  );
}

// ── Pitch ────────────────────────────────────────────────────────────────
function Pitch({
  formation,
  playerBySlot,
  scores,
  onSlotClick,
  onPlayerClick,
}: {
  formation: FormationDef;
  playerBySlot: Map<string, SquadPlayer>;
  scores: Map<string, ScoreInfo>;
  onSlotClick: (slot: SlotDef) => void;
  onPlayerClick: (playerId: string) => void;
}) {
  const w = 360;
  const h = 540;
  const padding = 10;

  const toSVG = (x: number, y: number) => ({
    cx: padding + (x / 100) * (w - 2 * padding),
    cy: h - (padding + (y / 100) * (h - 2 * padding)),
  });

  return (
    <div className="mx-auto w-full" style={{ maxWidth: w }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        className="block rounded-md"
        preserveAspectRatio="xMidYMid meet"
      >
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

        {formation.slots.map((slot) => {
          const { cx, cy } = toSVG(slot.x, slot.y);
          const player = playerBySlot.get(slot.id);
          const filled = !!player;
          const score = player ? scores.get(player.player_id) : null;
          const teamLabel = player?.team_in_period ?? player?.current_team ?? null;

          return (
            <g key={slot.id} style={{ cursor: 'pointer' }}>
              <circle
                cx={cx}
                cy={cy}
                r={20}
                fill={filled ? '#fef3c7' : 'rgba(255,255,255,0.08)'}
                stroke={filled ? '#f59e0b' : 'white'}
                strokeWidth={2}
                strokeDasharray={filled ? undefined : '4 3'}
                onClick={() => (filled ? onPlayerClick(player.player_id) : onSlotClick(slot))}
              />
              <text
                x={cx}
                y={cy + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={9}
                fontWeight={600}
                fill={filled ? '#171717' : 'white'}
                style={{ pointerEvents: 'none' }}
              >
                {slot.label}
              </text>
              {filled && (
                <>
                  <text
                    x={cx}
                    y={cy + 32}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="white"
                    stroke="#14532d"
                    strokeWidth={0.5}
                    paintOrder="stroke fill"
                    style={{ pointerEvents: 'none' }}
                  >
                    {truncate(player.name ?? '', 14)}
                  </text>
                  <text
                    x={cx}
                    y={cy + 44}
                    textAnchor="middle"
                    fontSize={8}
                    fill="#f5f5f5"
                    stroke="#14532d"
                    strokeWidth={0.5}
                    paintOrder="stroke fill"
                    style={{ pointerEvents: 'none' }}
                  >
                    {[score ? score.score.toFixed(1) : null, teamLabel ? truncate(teamLabel, 12) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      <p className="mt-3 text-center text-xs text-neutral-500">
        Clica num slot vazio para escolher jogador. Clica num jogador para abrir a ficha.
      </p>
    </div>
  );
}

// ── Roster (lista lateral) ───────────────────────────────────────────────
function Roster({
  formation,
  players,
  benchPlayers,
  scores,
  onRemove,
}: {
  formation: FormationDef;
  players: SquadPlayer[];
  benchPlayers: SquadPlayer[];
  scores: Map<string, ScoreInfo>;
  onRemove: (playerId: string) => void;
}) {
  // Linha por slot id, para agrupar titulares por GK/DEF/MID/ATT
  const lineBySlotId = useMemo(() => {
    const m = new Map<string, 'GK' | 'DEF' | 'MID' | 'ATT'>();
    for (const s of formation.slots) m.set(s.id, s.line);
    return m;
  }, [formation]);

  const startersByLine: Record<'GK' | 'DEF' | 'MID' | 'ATT', SquadPlayer[]> = {
    GK: [],
    DEF: [],
    MID: [],
    ATT: [],
  };
  for (const p of players) {
    if (p.is_starter && p.slot) {
      const line = lineBySlotId.get(p.slot);
      if (line) startersByLine[line].push(p);
    }
  }

  const lineLabels: Record<'GK' | 'DEF' | 'MID' | 'ATT', string> = {
    GK: 'Guarda-redes',
    DEF: 'Defesa',
    MID: 'Médio',
    ATT: 'Ataque',
  };

  const totalStarters = players.filter((p) => p.is_starter && p.slot).length;

  return (
    <div className="space-y-4">
      {totalStarters > 0 ? (
        (['GK', 'DEF', 'MID', 'ATT'] as const).map((line) => {
          const list = startersByLine[line];
          if (list.length === 0) return null;
          return (
            <div key={line}>
              <div className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400">
                {lineLabels[line]}
              </div>
              <ul className="space-y-1.5">
                {list.map((p) => (
                  <RosterItem key={p.player_id} player={p} scores={scores} onRemove={onRemove} />
                ))}
              </ul>
            </div>
          );
        })
      ) : (
        <p className="text-xs text-neutral-500">Sem titulares atribuídos.</p>
      )}

      <div>
        <div className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-400">
          Banco ({benchPlayers.length})
        </div>
        {benchPlayers.length === 0 ? (
          <p className="text-xs text-neutral-500">Banco vazio.</p>
        ) : (
          <ul className="space-y-1.5">
            {benchPlayers.map((p) => (
              <RosterItem key={p.player_id} player={p} scores={scores} onRemove={onRemove} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RosterItem({
  player,
  scores,
  onRemove,
}: {
  player: SquadPlayer;
  scores: Map<string, ScoreInfo>;
  onRemove: (playerId: string) => void;
}) {
  const router = useRouter();
  const score = scores.get(player.player_id);
  const team = player.team_in_period ?? player.current_team ?? null;
  const transferred =
    player.team_in_period && player.current_team && player.team_in_period !== player.current_team
      ? player.current_team
      : null;

  return (
    <li className="group flex items-start justify-between gap-2 rounded-md border border-neutral-100 bg-neutral-50 px-2 py-1.5">
      <button
        type="button"
        onClick={() => router.push(`/players/${player.player_id}`)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-neutral-900 group-hover:text-emerald-700">
            {player.name ?? '—'}
          </span>
          {score && (
            <span className="shrink-0 text-xs font-semibold text-neutral-700">
              {score.score.toFixed(1)}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-neutral-500">
          {[team, player.position_primary, player.age != null ? `${player.age}a` : null]
            .filter(Boolean)
            .join(' · ')}
        </div>
        {transferred && (
          <div className="truncate text-xs text-neutral-400">Actualmente em {transferred}</div>
        )}
      </button>
      <button
        type="button"
        onClick={() => onRemove(player.player_id)}
        className="shrink-0 rounded p-0.5 text-neutral-300 hover:bg-red-50 hover:text-red-600"
        title="Remover da equipa"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </li>
  );
}

// ── Modal: escolher jogador para um slot ─────────────────────────────────
function SlotPickerModal({
  slot,
  squadPlayers,
  onClose,
  onAssign,
}: {
  slot: SlotDef;
  squadPlayers: SquadPlayer[];
  onClose: () => void;
  onAssign: (playerId: string, slotId: string, isInSquad: boolean) => Promise<void>;
}) {
  const isCompatible = (pos: string | null | undefined) =>
    pos != null && slot.accepted_positions.includes(pos);

  const squadPlayersForSlot = useMemo(() => {
    const others = squadPlayers.filter((p) => p.slot !== slot.id);
    return [...others].sort((a, b) => {
      const ac = isCompatible(a.position_primary) ? 0 : 1;
      const bc = isCompatible(b.position_primary) ? 0 : 1;
      return ac - bc;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadPlayers, slot]);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(q.trim())}`);
        const j = await res.json();
        const hits: SearchHit[] = j.players ?? [];
        // Mostramos todos os hits — só ordenamos: compatíveis primeiro, não-naturais depois.
        const sorted = [...hits].sort((a, b) => {
          const ac = a.position_primary && slot.accepted_positions.includes(a.position_primary) ? 0 : 1;
          const bc = b.position_primary && slot.accepted_positions.includes(b.position_primary) ? 0 : 1;
          return ac - bc;
        });
        setResults(sorted);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [q, slot]);

  const inSquadIds = useMemo(() => new Set(squadPlayers.map((p) => p.player_id)), [squadPlayers]);

  return (
    <ModalShell title={`Escolher jogador para ${slot.label}`} onClose={onClose}>
      <p className="mb-3 text-xs text-neutral-500">
        Posições aceites: <span className="font-mono">{slot.accepted_positions.join(', ')}</span>
      </p>

      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Da equipa ({squadPlayersForSlot.length})
          </div>
          {squadPlayersForSlot.length === 0 ? (
            <p className="text-xs text-neutral-500">Sem outros jogadores na equipa.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {squadPlayersForSlot.map((p) => {
                const compat = isCompatible(p.position_primary);
                return (
                  <li key={p.player_id}>
                    <button
                      type="button"
                      onClick={() => onAssign(p.player_id, slot.id, true)}
                      className="flex w-full items-center justify-between gap-2 rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-neutral-900">{p.name}</span>
                          <CompatibilityBadge compatible={compat} />
                        </div>
                        <div className="truncate text-xs text-neutral-500">
                          {[p.team_in_period ?? p.current_team, p.position_primary]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      {p.is_starter && p.slot && (
                        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                          actual: {p.slot}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Adicionar de fora
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
              strokeWidth={2}
            />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome do jogador (mín 2 letras)…"
              className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm focus:border-neutral-400 focus:bg-white focus:outline-none"
            />
          </div>

          {q.trim().length >= 2 && (
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-neutral-200">
              {searching ? (
                <div className="px-3 py-2 text-xs text-neutral-500">A procurar…</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-2 text-xs text-neutral-500">Sem resultados.</div>
              ) : (
                <ul>
                  {results.map((p) => {
                    const already = inSquadIds.has(p.id);
                    const compat = isCompatible(p.position_primary);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={already}
                          onClick={() => onAssign(p.id, slot.id, false)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-neutral-900">{p.name}</span>
                              <CompatibilityBadge compatible={compat} />
                            </div>
                            <div className="truncate text-xs text-neutral-500">
                              {[p.current_team, p.position_primary, p.age].filter(Boolean).join(' · ')}
                              {p.pool_name && (
                                <span className="text-neutral-400"> · {p.pool_name}</span>
                              )}
                            </div>
                          </div>
                          {already && (
                            <span className="shrink-0 text-xs text-neutral-400">já na equipa</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

// ── Modal: adicionar jogador ao banco (busca livre) ──────────────────────
function AddPlayerModal({
  existingIds,
  onClose,
  onAdd,
}: {
  existingIds: Set<string>;
  onClose: () => void;
  onAdd: (playerId: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(q.trim())}`);
        const j = await res.json();
        setResults((j.players ?? []) as SearchHit[]);
      } finally {
        setSearching(false);
      }
    }, 250);
  }, [q]);

  return (
    <ModalShell title="Adicionar jogador ao banco" onClose={onClose}>
      <p className="mb-3 text-xs text-neutral-500">
        O jogador é adicionado sem slot — depois atribuis um slot do campo se quiseres.
      </p>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
          strokeWidth={2}
        />
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
          placeholder="Nome do jogador (mín 2 letras)…"
          className="w-full rounded-md border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm focus:border-neutral-400 focus:bg-white focus:outline-none"
        />
      </div>

      {q.trim().length >= 2 && (
        <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-neutral-200">
          {searching ? (
            <div className="px-3 py-2 text-xs text-neutral-500">A procurar…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-neutral-500">Sem resultados.</div>
          ) : (
            <ul>
              {results.map((p) => {
                const already = existingIds.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => onAdd(p.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-neutral-900">{p.name}</div>
                        <div className="truncate text-xs text-neutral-500">
                          {[p.current_team, p.position_primary, p.age].filter(Boolean).join(' · ')}
                          {p.pool_name && <span className="text-neutral-400"> · {p.pool_name}</span>}
                        </div>
                      </div>
                      {already ? (
                        <span className="shrink-0 text-xs text-neutral-400">já na equipa</span>
                      ) : (
                        <Check className="h-3.5 w-3.5 shrink-0 text-neutral-300" strokeWidth={2} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </ModalShell>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function CompatibilityBadge({ compatible }: { compatible: boolean }) {
  return compatible ? (
    <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500">
      Compatível
    </span>
  ) : (
    <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
      Não-natural
    </span>
  );
}
