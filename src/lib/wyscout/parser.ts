/**
 * Parser Wyscout -> estruturas prontas para inserir no Supabase.
 *
 * Design:
 *  - Função pura: recebe buffer do XLSX, devolve objectos. Não toca na base de dados.
 *  - A persistência é feita na rota API (`/api/import/wyscout`).
 *  - Qualquer erro de estrutura é lançado; qualquer coluna ignorada ou valor vazio
 *    é registado em `warnings`.
 */

import * as XLSX from 'xlsx';
import { METRIC_MAP, PLAYER_FIELD_MAP, toNumberOrNull } from './column-map';

export type ParsedPlayer = {
  // índice de linha no XLSX (1-based, excluindo header), útil para debug
  rowIndex: number;
  // dados da tabela `players` (sem pool_id — a rota API injecta)
  data: Record<string, unknown>;
  // raw das posições (string original, p.ex. "RW, RWF, LW")
  positionsRaw: string | null;
};

export type ParsedStat = {
  rowIndex: number;
  playerName: string; // para ligar ao ParsedPlayer depois do insert
  playerTeam: string | null;
  metric_code: string;
  metric_value: number;
  raw_label: string; // nome original da coluna Wyscout
};

export type ParseResult = {
  rowCount: number;
  players: ParsedPlayer[];
  stats: ParsedStat[];
  warnings: string[];
  unmappedColumns: string[]; // colunas que existiam no XLSX e que ignorámos
  missingColumns: string[]; // colunas que o parser espera e não encontrou
};

/** Lê buffer de ficheiro XLSX e devolve estruturas prontas para persistência. */
export function parseWyscoutXlsx(buffer: ArrayBuffer | Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('Ficheiro XLSX sem folhas.');
  }
  const sheet = workbook.Sheets[firstSheetName];

  // defval: '' garante que células vazias vêm como string vazia em vez de serem omitidas,
  // o que tornaria impossível detectar "coluna existe mas valor está em branco"
  const rows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(sheet, {
    defval: '',
    raw: true,
  });

  if (rows.length === 0) {
    throw new Error('XLSX sem linhas de dados.');
  }

  const warnings: string[] = [];
  const players: ParsedPlayer[] = [];
  const stats: ParsedStat[] = [];

  // Colunas presentes no ficheiro (tiramos das chaves da primeira linha)
  const presentColumns = new Set(Object.keys(rows[0]));

  // Validar colunas essenciais
  const missingColumns: string[] = [];
  for (const col of Object.keys(PLAYER_FIELD_MAP)) {
    if (!presentColumns.has(col)) missingColumns.push(col);
  }
  if (!presentColumns.has('Jogador')) {
    throw new Error('Coluna "Jogador" em falta — ficheiro não parece Wyscout.');
  }

  // Colunas que ignorámos (nem vão para players nem para stats)
  const expectedColumns = new Set<string>([
    ...Object.keys(PLAYER_FIELD_MAP),
    ...Object.keys(METRIC_MAP),
  ]);
  const unmappedColumns = [...presentColumns].filter((c) => !expectedColumns.has(c));

  // Processar cada linha
  rows.forEach((row, i) => {
    const rowIndex = i + 2; // +1 porque 0-based, +1 por causa do header no XLSX

    const name = String(row['Jogador'] ?? '').trim();
    if (!name) {
      warnings.push(`Linha ${rowIndex}: sem nome de jogador, ignorada.`);
      return;
    }

    // Monta objecto `players`
    const playerData: Record<string, unknown> = {};
    for (const [col, { field, transform }] of Object.entries(PLAYER_FIELD_MAP)) {
      if (!presentColumns.has(col)) continue;
      const val = transform(row[col]);
      if (val !== undefined) playerData[field] = val;
    }

    // positions_secondary: extraído da coluna Posição
    const positionsRaw = row['Posição'] ? String(row['Posição']).trim() : null;
    if (positionsRaw) {
      const parts = positionsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        playerData.positions_secondary = parts.slice(1);
      }
    }

    players.push({
      rowIndex,
      data: playerData,
      positionsRaw,
    });

    // Stats: uma linha por métrica mapeada
    const team = typeof playerData.current_team === 'string' ? playerData.current_team : null;
    for (const [col, code] of Object.entries(METRIC_MAP)) {
      if (!presentColumns.has(col)) continue;
      const raw = row[col];
      const value = toNumberOrNull(raw);
      if (value === null) continue; // string vazia ou não-numérico -> salta, não insere lixo
      stats.push({
        rowIndex,
        playerName: name,
        playerTeam: team,
        metric_code: code,
        metric_value: value,
        raw_label: col,
      });
    }
  });

  return {
    rowCount: rows.length,
    players,
    stats,
    warnings,
    unmappedColumns,
    missingColumns,
  };
}