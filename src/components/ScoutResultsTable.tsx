'use client';

import { useMemo } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { Metric } from './MetricPickerModal';

export type DisplayPlayer = {
  id: string;
  name: string;
  current_team: string | null;
  team_in_period: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  metric_values: Array<{
    metric_code: string;
    raw_value: number | null;
    percentile: number | null;
  }>;
};

export type SortState = { field: string; direction: 'asc' | 'desc' };

type Props = {
  players: DisplayPlayer[];
  activeMetricCodes: string[];
  metricByCode: Map<string, Metric>;
  poolName: string;
  selectedIds: Set<string>;
  sort: SortState;
  onSort: (field: string) => void;
  onToggleSelect: (playerId: string) => void;
  onToggleSelectAll: () => void;
  onOpenPlayer: (playerId: string) => void;
};

const STRING_FIELDS = new Set(['name', 'team', 'pos']);

function compareValues(av: unknown, bv: unknown, direction: 'asc' | 'desc'): number {
  const dir = direction === 'desc' ? -1 : 1;
  if (av == null && bv == null) return 0;
  if (av == null) return 1; // nulls sempre no fim
  if (bv == null) return -1;
  if (typeof av === 'string' && typeof bv === 'string') {
    return av.localeCompare(bv, 'pt') * dir;
  }
  return ((av as number) - (bv as number)) * dir;
}

function getSortValue(p: DisplayPlayer, field: string): unknown {
  switch (field) {
    case 'name':
      return p.name;
    case 'team':
      return p.team_in_period ?? p.current_team;
    case 'pos':
      return p.position_primary;
    case 'age':
      return p.age;
    case 'minutes':
      return p.minutes_played;
    default:
      // Assume metric_code
      return p.metric_values.find((v) => v.metric_code === field)?.raw_value ?? null;
  }
}

export function ScoutResultsTable({
  players,
  activeMetricCodes,
  metricByCode,
  poolName,
  selectedIds,
  sort,
  onSort,
  onToggleSelect,
  onToggleSelectAll,
  onOpenPlayer,
}: Props) {
  const sortedPlayers = useMemo(() => {
    return [...players].sort((a, b) =>
      compareValues(getSortValue(a, sort.field), getSortValue(b, sort.field), sort.direction)
    );
  }, [players, sort]);

  const allSelected = players.length > 0 && players.every((p) => selectedIds.has(p.id));
  const someSelected = players.some((p) => selectedIds.has(p.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="w-10 px-4 py-2">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allSelected && someSelected;
                }}
                onChange={onToggleSelectAll}
                className="h-3.5 w-3.5 cursor-pointer rounded border-neutral-300"
                aria-label="Seleccionar todos"
              />
            </th>
            <SortHeader field="name" label="Jogador" sort={sort} onSort={onSort} />
            <SortHeader field="team" label="Equipa" sort={sort} onSort={onSort} />
            <SortHeader field="pos" label="Pos" sort={sort} onSort={onSort} />
            <SortHeader field="age" label="Idade" sort={sort} onSort={onSort} align="right" />
            <SortHeader field="minutes" label="Min" sort={sort} onSort={onSort} align="right" />
            {activeMetricCodes.map((code) => {
              const m = metricByCode.get(code);
              return (
                <SortHeader
                  key={code}
                  field={code}
                  label={m?.label_pt ?? code}
                  sort={sort}
                  onSort={onSort}
                  align="right"
                />
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map((p) => {
            const team = p.team_in_period ?? p.current_team;
            const transferred =
              p.team_in_period && p.current_team && p.team_in_period !== p.current_team
                ? p.current_team
                : null;
            const valuesByCode = new Map(p.metric_values.map((v) => [v.metric_code, v]));
            const selected = selectedIds.has(p.id);
            return (
              <tr
                key={p.id}
                className={`border-t border-neutral-100 ${
                  selected ? 'bg-emerald-50/40' : 'hover:bg-neutral-50'
                }`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleSelect(p.id)}
                    className="h-3.5 w-3.5 cursor-pointer rounded border-neutral-300"
                    aria-label={`Seleccionar ${p.name}`}
                  />
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(p.id)}
                    className="font-medium text-neutral-900 hover:text-emerald-700 hover:underline"
                  >
                    {p.name}
                  </button>
                  <div className="text-xs text-neutral-400">{poolName}</div>
                </td>
                <td className="px-4 py-3 text-neutral-700">
                  {team ?? '—'}
                  {transferred && (
                    <div className="text-xs text-neutral-400">→ {transferred}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-600">{p.position_primary ?? '—'}</td>
                <td className="px-4 py-3 text-right text-neutral-600">{p.age ?? '—'}</td>
                <td className="px-4 py-3 text-right text-neutral-600">
                  {p.minutes_played?.toLocaleString() ?? '—'}
                </td>
                {activeMetricCodes.map((code) => {
                  const v = valuesByCode.get(code);
                  return (
                    <td key={code} className="px-4 py-3 text-right">
                      {v?.raw_value == null ? (
                        <span className="text-neutral-400">—</span>
                      ) : (
                        <>
                          <span className="font-medium text-neutral-900">
                            {formatVal(v.raw_value)}
                          </span>
                          {v.percentile != null && (
                            <span className="ml-1 text-xs text-neutral-400">
                              (P{v.percentile.toFixed(0)})
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  field,
  label,
  sort,
  onSort,
  align = 'left',
}: {
  field: string;
  label: string;
  sort: SortState;
  onSort: (field: string) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.field === field;
  const isString = STRING_FIELDS.has(field);
  return (
    <th
      className={`cursor-pointer select-none px-4 py-2 ${
        align === 'right' ? 'text-right' : 'text-left'
      } hover:text-neutral-900`}
      onClick={() => onSort(field)}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span>{label}</span>
        {active ? (
          sort.direction === 'desc' ? (
            <ArrowDown className="h-3 w-3" strokeWidth={2.2} />
          ) : (
            <ArrowUp className="h-3 w-3" strokeWidth={2.2} />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-neutral-300" strokeWidth={1.8} />
        )}
      </span>
      {/* Tooltip subtil para indicar tipo de ordenação default */}
      <span className="sr-only">
        {active
          ? `Ordenado ${sort.direction === 'desc' ? 'descendente' : 'ascendente'} por ${label}`
          : `Clica para ordenar por ${label} ${isString ? 'ascendente' : 'descendente'}`}
      </span>
    </th>
  );
}

function formatVal(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}
