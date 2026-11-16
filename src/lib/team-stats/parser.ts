/**
 * Lê um ficheiro "Team Stats" do Wyscout: um ficheiro por equipa, com duas
 * linhas por jogo (a equipa e o adversário).
 *
 * Função pura: recebe o buffer, devolve linhas. Não toca na base de dados.
 */
import * as XLSX from 'xlsx';
import { TEAM_STATS_COLUMNS, TEAM_STATS_ID_HEADERS, TEAM_STATS_REQUIRED } from './columns';

export type TeamStatsRow = {
  /** AAAA-MM-DD */
  match_date: string;
  /** Tal como vem no ficheiro: "Aljustrelense - FC Serpa 0:4". */
  match_label: string;
  competition: string;
  team: string;
  duration: number | null;
  scheme: string | null;
  stats: Record<string, number>;
};

export type TeamStatsFile = {
  /** Equipa a que o ficheiro diz respeito (primeira linha de médias). */
  file_team: string | null;
  rows: TeamStatsRow[];
  /** Cabeçalhos do ficheiro que não conhecemos. */
  unknown_headers: string[];
};

const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Data sem hora: usar os campos locais evita recuar um dia em fusos a leste.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const p = XLSX.SSF.parse_date_code(v);
    if (!p) return null;
    return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  }
  const s = clean(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const pt = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s);
  if (pt) return `${pt[3]}-${pt[2].padStart(2, '0')}-${pt[1].padStart(2, '0')}`;
  return null;
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = clean(v).replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseTeamStatsXlsx(buffer: ArrayBuffer | Buffer): TeamStatsFile {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Ficheiro sem folhas.');
  const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
  const header = (grid[0] ?? []).map(clean);

  const at = new Map<string, number>();
  header.forEach((h, i) => {
    if (h && !at.has(h)) at.set(h, i);
  });

  const missingId = TEAM_STATS_ID_HEADERS.filter((h) => !at.has(h));
  const missing = TEAM_STATS_REQUIRED.filter((h) => !at.has(clean(h)));
  if (missingId.length > 0 || missing.length > 0) {
    throw new Error(
      `Não parece um ficheiro "Team Stats" do Wyscout. Faltam as colunas: ${[...missingId, ...missing].join(', ')}.`
    );
  }

  const known = new Set<string>([...TEAM_STATS_ID_HEADERS, ...TEAM_STATS_COLUMNS.map((c) => clean(c.header))]);
  const unknown_headers = header.filter((h) => h && !known.has(h));

  const col = (h: string) => at.get(h) as number;
  // A primeira linha de dados é a média da equipa e traz o nome dela na coluna
  // da data; a segunda é a média dos adversários.
  const firstCell = clean((grid[1] ?? [])[0]);
  const file_team = firstCell && toIsoDate(firstCell) === null ? firstCell : null;

  const rows: TeamStatsRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const match_date = toIsoDate(line[col('Data')]);
    const team = clean(line[col('Equipa')]);
    const match_label = clean(line[col('Jogo')]);
    if (!match_date || !team || !match_label) continue; // linhas de médias e linhas vazias

    const stats: Record<string, number> = {};
    for (const c of TEAM_STATS_COLUMNS) {
      const start = at.get(clean(c.header));
      if (start === undefined) continue;
      c.keys.forEach((key, k) => {
        const n = toNumber(line[start + k]);
        if (n !== null) stats[key] = n;
      });
    }

    rows.push({
      match_date,
      match_label,
      competition: clean(line[col('Competição')]),
      team,
      duration: toNumber(line[col('Duração')]),
      scheme: clean(line[col('Sistema')]) || null,
      stats,
    });
  }

  return { file_team, rows, unknown_headers };
}
