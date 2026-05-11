'use client';

import { X } from 'lucide-react';
import type { Metric } from './MetricPickerModal';

export type MetricFilterMode = 'absolute' | 'percentile';

export type MetricFilterValue = {
  metric_code: string;
  operator: 'gte' | 'lte' | 'between' | 'top_percentile';
  value?: number;
  value_range?: [number, number];
  percentile?: number;
  mode?: MetricFilterMode;
};

export type MetricThresholds = {
  min: number;
  max: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
};

type Props = {
  metric: Metric;
  value: MetricFilterValue;
  thresholds?: MetricThresholds;
  onChange: (next: MetricFilterValue) => void;
  onRemove: () => void;
};

const OPERATOR_LABELS: Record<MetricFilterValue['operator'], string> = {
  gte: '≥',
  lte: '≤',
  between: 'entre',
  top_percentile: 'top X%',
};

/**
 * Interpolação linear entre os pontos conhecidos da distribuição
 * (min, p10, p25, p50, p75, p90, p95, max). Aproximação para mostrar
 * "≈ percentil X" ou "≈ valor Y" lado a lado. O filtro real é feito no
 * backend com a distribuição completa (no caso de top_percentile/percentil)
 * ou com o valor absoluto (no caso de gte/lte/between+absolute).
 */
function interpolate(x: number, points: Array<[number, number]>): number {
  if (points.length === 0) return 0;
  if (x <= points[0][0]) return points[0][1];
  if (x >= points[points.length - 1][0]) return points[points.length - 1][1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (x >= x1 && x <= x2) {
      if (x2 === x1) return y1;
      return y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
    }
  }
  return points[points.length - 1][1];
}

function valueToPercentile(value: number, t: MetricThresholds): number {
  return interpolate(value, [
    [t.min, 0],
    [t.p10, 10],
    [t.p25, 25],
    [t.p50, 50],
    [t.p75, 75],
    [t.p90, 90],
    [t.p95, 95],
    [t.max, 100],
  ]);
}

function percentileToValue(percentile: number, t: MetricThresholds): number {
  return interpolate(percentile, [
    [0, t.min],
    [10, t.p10],
    [25, t.p25],
    [50, t.p50],
    [75, t.p75],
    [90, t.p90],
    [95, t.p95],
    [100, t.max],
  ]);
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

export function MetricFilterRow({ metric, value, thresholds, onChange, onRemove }: Props) {
  const setOperator = (op: MetricFilterValue['operator']) => {
    // Reset valor ao mudar de operador (semânticas diferentes)
    if (op === 'top_percentile') {
      onChange({ metric_code: value.metric_code, operator: op, percentile: 75, mode: 'percentile' });
    } else if (op === 'between') {
      const m = value.mode === 'percentile' ? 'percentile' : 'absolute';
      onChange({
        metric_code: value.metric_code,
        operator: op,
        value_range: [0, 100],
        mode: m,
      });
    } else {
      const m = value.mode === 'percentile' ? 'percentile' : 'absolute';
      onChange({ metric_code: value.metric_code, operator: op, value: 0, mode: m });
    }
  };

  const setMode = (mode: MetricFilterMode) => {
    onChange({ ...value, mode });
  };

  const showModeToggle = value.operator !== 'top_percentile';
  const isPctMode = value.mode === 'percentile' || value.operator === 'top_percentile';

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-neutral-900">{metric.label_pt}</div>
          <div className="font-mono text-xs text-neutral-400">{metric.code}</div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
          title="Remover filtro"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={value.operator}
          onChange={(e) => setOperator(e.target.value as MetricFilterValue['operator'])}
          className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
        >
          {(Object.keys(OPERATOR_LABELS) as MetricFilterValue['operator'][]).map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </select>

        {showModeToggle && (
          <div className="inline-flex rounded-md border border-neutral-300 bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode('absolute')}
              className={`rounded px-2 py-0.5 ${
                value.mode !== 'percentile'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Valor
            </button>
            <button
              type="button"
              onClick={() => setMode('percentile')}
              className={`rounded px-2 py-0.5 ${
                value.mode === 'percentile'
                  ? 'bg-neutral-900 text-white'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Percentil
            </button>
          </div>
        )}

        {(value.operator === 'gte' || value.operator === 'lte') && (
          <NumberInputWithConversion
            mode={value.mode === 'percentile' ? 'percentile' : 'absolute'}
            current={value.value ?? 0}
            thresholds={thresholds}
            onChange={(n) => onChange({ ...value, value: n })}
          />
        )}

        {value.operator === 'between' && (
          <>
            <NumberInputWithConversion
              mode={value.mode === 'percentile' ? 'percentile' : 'absolute'}
              current={value.value_range?.[0] ?? 0}
              thresholds={thresholds}
              onChange={(n) =>
                onChange({
                  ...value,
                  value_range: [n, value.value_range?.[1] ?? n],
                })
              }
            />
            <span className="text-xs text-neutral-500">e</span>
            <NumberInputWithConversion
              mode={value.mode === 'percentile' ? 'percentile' : 'absolute'}
              current={value.value_range?.[1] ?? 0}
              thresholds={thresholds}
              onChange={(n) =>
                onChange({
                  ...value,
                  value_range: [value.value_range?.[0] ?? n, n],
                })
              }
            />
          </>
        )}

        {value.operator === 'top_percentile' && (
          <NumberInputWithConversion
            mode="percentile"
            current={value.percentile ?? 75}
            thresholds={thresholds}
            onChange={(n) => onChange({ ...value, percentile: n })}
          />
        )}
      </div>

      {!thresholds && (
        <div className="mt-2 text-xs text-neutral-400">
          {isPctMode
            ? 'Valor absoluto correspondente disponível após primeira pesquisa.'
            : 'Percentil correspondente disponível após primeira pesquisa.'}
        </div>
      )}
    </div>
  );
}

function NumberInputWithConversion({
  mode,
  current,
  thresholds,
  onChange,
}: {
  mode: MetricFilterMode;
  current: number;
  thresholds?: MetricThresholds;
  onChange: (n: number) => void;
}) {
  const conversion = (() => {
    if (!thresholds) return null;
    if (mode === 'percentile') {
      const v = percentileToValue(current, thresholds);
      return `≈ ${formatNum(v)}`;
    }
    const p = valueToPercentile(current, thresholds);
    return `≈ P${formatNum(p)}`;
  })();

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        value={Number.isFinite(current) ? current : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs"
        step={mode === 'percentile' ? 5 : 0.1}
        min={mode === 'percentile' ? 0 : undefined}
        max={mode === 'percentile' ? 100 : undefined}
      />
      {conversion && <span className="text-xs text-neutral-400">{conversion}</span>}
    </div>
  );
}
