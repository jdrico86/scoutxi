/**
 * Parser Wyscout -> estruturas prontas para inserir no Supabase.
 *
 * Design:
 * - Função pura: recebe buffer do XLSX, devolve objectos. Não toca na base de dados.
 * - A persistência é feita na rota API (`/api/import/wyscout`).
 * - Qualquer erro de estrutura é lançado; qualquer coluna ignorada ou valor vazio
 *   é registado em `warnings`.
 *
 * Deduplicação:
 * - O Wyscout por vezes exporta linhas duplicadas para o mesmo jogador com
 *   dados ligeiramente diferentes — provavelmente um glitch do exporter.
 *   Antes de processar, deduplicamos por nome + equipa + altura + pé
 *   (lib/wyscout/player-key.ts, a mesma chave da rota de import), ficando
 *   com a linha de mais minutos. A idade não entra: muda entre exports.
 *   Casos como "Diogo Marques" no Lagoa vs FC Serpa (jogadores diferentes
 *   ou transferência) NÃO são afectados — clubes diferentes mantêm linhas
 *   separadas.
 */
import * as XLSX from 'xlsx';
import { METRIC_MAP, PLAYER_FIELD_MAP, toNumberOrNull } from './column-map';
import { playerKey } from './player-key';

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
  duplicatesRemoved: number; // linhas removidas por deduplicação (nome+equipa+altura+pé)
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

  // ── Deduplicação ─────────────────────────────────────────────────────
  // Agrupa linhas por (nome, equipa, altura, pé) e fica com a linha de mais minutos.
  // O Wyscout às vezes exporta duplicados com a mesma chave mas dados ligeiramente
  // diferentes (provavelmente bug do exporter). Esta dedup acontece ANTES de
  // criar players/stats, garantindo um único registo por jogador no resultado.
  type IndexedRow = { row: Record<string, unknown>; rowIndex: number };
  const dedupMap = new Map<string, IndexedRow>();
  let duplicatesRemoved = 0;

  rows.forEach((row, i) => {
    const rowIndex = i + 2; // +1 (0-based) +1 (header)
    const name = String(row['Jogador'] ?? '').trim();
    if (!name) return; // linhas vazias ignoradas no loop principal a seguir

    // Mesma chave que a rota de import: nome + equipa + altura + pé, com a
    // equipa do período como recurso quando 'Equipa' vem vazia.
    const team =
      String(row['Equipa'] ?? '').trim() ||
      String(row['Equipa dentro de um período de tempo seleccionado'] ?? '').trim();
    const key = playerKey(name, team, row['Altura'], row['Pé']);

    const minutesNow = toNumberOrNull(row['Minutos jogados:']) ?? 0;

    const existing = dedupMap.get(key);
    if (!existing) {
      dedupMap.set(key, { row, rowIndex });
      return;
    }

    duplicatesRemoved++;
    const minutesExisting = toNumberOrNull(existing.row['Minutos jogados:']) ?? 0;
    if (minutesNow > minutesExisting) {
      // Esta linha tem mais minutos — substituir
      dedupMap.set(key, { row, rowIndex });
      warnings.push(
        `Duplicado removido: linha ${existing.rowIndex} (${minutesExisting} min) substituída por linha ${rowIndex} (${minutesNow} min) — ${name} / ${row['Equipa'] ?? '—'}.`
      );
    } else {
      // Esta linha tem menos ou iguais minutos — descartar
      warnings.push(
        `Duplicado removido: linha ${rowIndex} (${minutesNow} min) descartada — ${name} / ${row['Equipa'] ?? '—'} (mantida linha ${existing.rowIndex} com ${minutesExisting} min).`
      );
    }
  });

  // ── Fichas fantasma ──────────────────────────────────────────────────
  // O Wyscout parte por vezes o registo de um jogador em dois: mesma pessoa,
  // mas uma das linhas vem sem altura. A chave acima não as junta (a altura
  // difere), por isso tratamos o caso à parte: mesmo nome + equipa + idade +
  // posição primária, e só uma das linhas sem altura. Fica a de mais minutos e
  // herda a altura e o pé da outra. A idade e a posição protegem os homónimos.
  const hasHeight = (r: Record<string, unknown>) => (toNumberOrNull(r['Altura']) ?? 0) > 0;
  const ghostKey = (r: Record<string, unknown>) =>
    [
      String(r['Jogador'] ?? '').trim().toLowerCase(),
      (
        String(r['Equipa'] ?? '').trim() ||
        String(r['Equipa dentro de um período de tempo seleccionado'] ?? '').trim()
      ).toLowerCase(),
      String(r['Idade'] ?? '').trim(),
      String(r['Posição'] ?? '').split(',')[0].trim(),
    ].join('::');
  const byGhostKey = new Map<string, Array<[string, IndexedRow]>>();
  for (const entry of dedupMap.entries()) {
    const k = ghostKey(entry[1].row);
    const list = byGhostKey.get(k);
    if (list) list.push(entry);
    else byGhostKey.set(k, [entry]);
  }
  for (const group of byGhostKey.values()) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    if (hasHeight(a[1].row) === hasHeight(b[1].row)) continue; // dois jogadores a sério
    const full = hasHeight(a[1].row) ? a : b;
    const ghost = full === a ? b : a;
    const minutes = (e: [string, IndexedRow]) => toNumberOrNull(e[1].row['Minutos jogados:']) ?? 0;
    const keep = minutes(ghost) > minutes(full) ? ghost : full;
    const merged: Record<string, unknown> = { ...keep[1].row, Altura: full[1].row['Altura'], Pé: full[1].row['Pé'] };
    dedupMap.delete(ghost[0]);
    dedupMap.set(full[0], { row: merged, rowIndex: keep[1].rowIndex });
    duplicatesRemoved++;
    warnings.push(
      `Ficha fantasma fundida: ${String(merged['Jogador'])} / ${String(merged['Equipa'] ?? '—')} (linhas ${a[1].rowIndex} e ${b[1].rowIndex}).`
    );
  }

  // Lista deduplicada, ordenada por rowIndex original
  const dedupedRows = Array.from(dedupMap.values()).sort((a, b) => a.rowIndex - b.rowIndex);

  // ── Processar linhas (já deduplicadas) ───────────────────────────────
  dedupedRows.forEach(({ row, rowIndex }) => {
    const name = String(row['Jogador'] ?? '').trim();
    if (!name) {
      warnings.push(`Linha ${rowIndex}: sem nome de jogador, ignorada.`);
      return;
    }

    // Skip linhas sem qualquer indicação de equipa.
    // O Wyscout às vezes exporta linhas malformadas para nomes abreviados
    // (ex: "R. Trotta") sem clube atribuído. Importar isto cria registos
    // órfãos sem utilidade. Verificamos as duas colunas porque uma pode
    // estar preenchida e outra não.
    const equipaRaw = String(row['Equipa'] ?? '').trim();
    const equipaPeriodoRaw = String(row['Equipa dentro de um período de tempo seleccionado'] ?? '').trim();
    if (!equipaRaw && !equipaPeriodoRaw) {
      warnings.push(`Linha ${rowIndex}: ${name} — sem equipa atribuída, ignorado.`);
      return;
    }

    // Monta objecto `players`
    const playerData: Record<string, unknown> = {};
    for (const [col, { field, transform }] of Object.entries(PLAYER_FIELD_MAP)) {
      if (!presentColumns.has(col)) continue;
      const val = transform(row[col]);
      if (val !== undefined) playerData[field] = val;
    }

    // Fallbacks: garantir que current_team e team_in_period nunca ficam ambos null.
    // Se o XLSX é antigo (sem 'Equipa dentro de um período...'), team_in_period é null —
    // copia de current_team. Se é caso raro de só ter team_in_period preenchido,
    // copia para current_team. Compatível com exports Wyscout antigos e novos.
    if (!playerData.team_in_period && playerData.current_team) {
      playerData.team_in_period = playerData.current_team;
    }
    if (!playerData.current_team && playerData.team_in_period) {
      playerData.current_team = playerData.team_in_period;
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

    // Stats: uma linha por métrica mapeada.
    // Associamos as stats à equipa onde o jogador jogou no contexto deste pool
    // (team_in_period), não ao clube actual. Para o Brendo Marins que está no "365"
    // mas jogou pelo Marialvas, as stats ficam ligadas a "Marialvas".
    const team = typeof playerData.team_in_period === 'string' ? playerData.team_in_period : null;
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
    duplicatesRemoved,
  };
}