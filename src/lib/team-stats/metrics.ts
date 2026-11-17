/**
 * Estatística de equipa: o que se calcula a partir das linhas por jogo e como
 * se compara uma equipa com as outras.
 *
 * Tudo são médias por jogo (ou percentagens sobre o total dos jogos). O lugar
 * é dado dentro de um conjunto de equipas — a série, ou a pool inteira.
 *
 * Funções puras, sem base de dados, para poderem ser testadas com os ficheiros.
 */

export type TeamGameRow = {
  team: string;
  opponent: string;
  match_date: string;
  /** Duração do jogo em minutos. Em falta, usa-se a média dos outros jogos. */
  duration?: number | null;
  stats: Record<string, number>;
};

/** Duração assumida quando nenhum jogo a traz. */
const DEFAULT_DURATION = 95;

export type MetricGroup = 'defender' | 'posse' | 'atacar';

export type MetricFormat = { decimals: number; unit?: '%' | 'm'; signed?: boolean };

export type TeamMetricDef = {
  code: string;
  label: string;
  /** Nome curto para o gráfico, quando o completo não cabe. */
  short?: string;
  group: MetricGroup;
  /** Entra nos três gráficos circulares. As outras só aparecem nas listas. */
  chart: boolean;
  /** Verdadeiro quando o 1.º lugar é de quem tem o valor mais baixo. */
  lower_first?: boolean;
  format: MetricFormat;
  compute: (own: Stats[], opp: Stats[]) => number | null;
};

type Stats = Record<string, number>;

const sum = (rows: Stats[], key: string): number => rows.reduce((acc, r) => acc + (r[key] ?? 0), 0);

/** Média por jogo. */
const avg = (rows: Stats[], key: string): number | null => (rows.length ? sum(rows, key) / rows.length : null);

/** Percentagem sobre o total de todos os jogos (não a média das percentagens). */
const pct = (rows: Stats[], num: string, den: string): number | null => {
  const d = sum(rows, den);
  return d > 0 ? (100 * sum(rows, num)) / d : null;
};

const per = (rows: Stats[], num: string, den: string): number | null => {
  const d = sum(rows, den);
  return d > 0 ? sum(rows, num) / d : null;
};

export const GROUP_LABELS: Record<MetricGroup, string> = { defender: 'Defender', posse: 'Posse', atacar: 'Atacar' };

export const TEAM_METRICS: TeamMetricDef[] = [
  // ── Defender ──────────────────────────────────────────────────────────
  { code: 'pressure', label: 'Pressão (PPDA)', group: 'defender', chart: true, lower_first: true, format: { decimals: 1 }, compute: (o) => avg(o, 'ppda') },
  { code: 'defensive_duels', label: 'Duelos defensivos', group: 'defender', chart: true, format: { decimals: 0, unit: '%' }, compute: (o) => pct(o, 'defensive_duels_ok', 'defensive_duels') },
  { code: 'aerial_duels', label: 'Duelos aéreos', group: 'defender', chart: true, format: { decimals: 0, unit: '%' }, compute: (o) => pct(o, 'aerial_duels_ok', 'aerial_duels') },
  {
    // Aproximação à "Challenge intensity" do Wyscout: acções defensivas por
    // minuto de posse do adversário. Desconta a posse, ao contrário de uma
    // simples soma por jogo. Não inclui os duelos por bola solta, que o
    // ficheiro de equipa não separa, e usa a duração total do jogo em vez do
    // tempo útil — por isso não coincide com o número do Wyscout.
    code: 'challenge_intensity', label: 'Intensidade nas disputas', short: 'Intensidade', group: 'defender', chart: true, format: { decimals: 2 },
    compute: (o, p) => {
      let actions = 0;
      let minutes = 0;
      o.forEach((own, i) => {
        actions += (own.defensive_duels ?? 0) + (own.interceptions ?? 0) + (own.sliding_tackles ?? 0);
        minutes += ((own.duration ?? 0) * (p[i]?.possession_pct ?? 0)) / 100;
      });
      return minutes > 0 ? actions / minutes : null;
    },
  },
  { code: 'interceptions', label: 'Intercepções', group: 'defender', chart: true, format: { decimals: 1 }, compute: (o) => avg(o, 'interceptions') },
  { code: 'clearances', label: 'Alívios', group: 'defender', chart: true, format: { decimals: 1 }, compute: (o) => avg(o, 'clearances') },
  { code: 'shots_against', label: 'Remates consentidos', group: 'defender', chart: true, lower_first: true, format: { decimals: 1 }, compute: (_o, p) => avg(p, 'shots') },
  { code: 'xg_against', label: 'Golos esperados consentidos', group: 'defender', chart: false, lower_first: true, format: { decimals: 2 }, compute: (_o, p) => avg(p, 'xg') },
  { code: 'shot_quality_against', label: 'Qualidade do remate consentido', group: 'defender', chart: false, lower_first: true, format: { decimals: 2 }, compute: (_o, p) => per(p, 'xg', 'shots') },
  { code: 'shot_distance_against', label: 'Distância do remate consentido', group: 'defender', chart: false, format: { decimals: 1, unit: 'm' }, compute: (_o, p) => avg(p, 'shot_distance') },
  { code: 'fouls', label: 'Faltas cometidas', group: 'defender', chart: false, lower_first: true, format: { decimals: 1 }, compute: (o) => avg(o, 'fouls') },
  { code: 'yellow_cards', label: 'Cartões amarelos', group: 'defender', chart: false, lower_first: true, format: { decimals: 2 }, compute: (o) => avg(o, 'yellow_cards') },

  // ── Posse ─────────────────────────────────────────────────────────────
  { code: 'possession', label: 'Tempo de posse', group: 'posse', chart: true, format: { decimals: 0, unit: '%' }, compute: (o) => avg(o, 'possession_pct') },
  { code: 'passes_per_possession', label: 'Passes por posse', group: 'posse', chart: true, format: { decimals: 2 }, compute: (o) => avg(o, 'passes_per_possession') },
  { code: 'pass_accuracy', label: 'Precisão de passe', group: 'posse', chart: true, format: { decimals: 0, unit: '%' }, compute: (o) => pct(o, 'passes_ok', 'passes') },
  { code: 'progression', label: 'Progressão', group: 'posse', chart: true, format: { decimals: 1 }, compute: (o) => avg(o, 'progressive_passes_ok') },
  {
    code: 'territory', label: 'Domínio territorial', group: 'posse', chart: true, format: { decimals: 0, unit: '%' },
    compute: (o, p) => {
      const mine = sum(o, 'final_third_passes_ok');
      const total = mine + sum(p, 'final_third_passes_ok');
      return total > 0 ? (100 * mine) / total : null;
    },
  },
  { code: 'fouls_won', label: 'Faltas sofridas', group: 'posse', chart: true, format: { decimals: 1 }, compute: (_o, p) => avg(p, 'fouls') },

  // ── Atacar ────────────────────────────────────────────────────────────
  { code: 'xg', label: 'Ocasiões (golos esperados)', short: 'Ocasiões', group: 'atacar', chart: true, format: { decimals: 2 }, compute: (o) => avg(o, 'xg') },
  { code: 'box_touches', label: 'Toques na área', group: 'atacar', chart: true, format: { decimals: 1 }, compute: (o) => avg(o, 'box_touches') },
  { code: 'crosses', label: 'Cruzamentos', group: 'atacar', chart: true, format: { decimals: 1 }, compute: (o) => avg(o, 'crosses') },
  { code: 'direct_play', label: 'Jogo directo', group: 'atacar', chart: true, format: { decimals: 0, unit: '%' }, compute: (o) => avg(o, 'long_pass_pct') },
  { code: 'set_piece_shots', label: 'Bolas paradas', group: 'atacar', chart: true, format: { decimals: 1 }, compute: (o) => avg(o, 'set_pieces_ok') },
  { code: 'shot_quality', label: 'Qualidade do remate', group: 'atacar', chart: true, format: { decimals: 2 }, compute: (o) => per(o, 'xg', 'shots') },
  {
    code: 'finishing', label: 'Finalização', group: 'atacar', chart: true, format: { decimals: 2, signed: true },
    compute: (o) => (o.length ? (sum(o, 'goals') - sum(o, 'xg')) / o.length : null),
  },
  { code: 'shots_on_target', label: 'Remates à baliza', group: 'atacar', chart: false, format: { decimals: 1, unit: '%' }, compute: (o) => pct(o, 'shots_ok', 'shots') },
  { code: 'deep_passes', label: 'Passes em profundidade', group: 'atacar', chart: false, format: { decimals: 2 }, compute: (o) => avg(o, 'deep_passes') },
  { code: 'corners_with_shot', label: 'Cantos com remate', group: 'atacar', chart: false, format: { decimals: 1, unit: '%' }, compute: (o) => pct(o, 'corners_ok', 'corners') },
  { code: 'free_kicks_with_shot', label: 'Livres com remate', group: 'atacar', chart: false, format: { decimals: 1, unit: '%' }, compute: (o) => pct(o, 'free_kicks_ok', 'free_kicks') },
];

export type TeamAggregate = {
  team: string;
  games: number;
  last_date: string | null;
  values: Record<string, number | null>;
  /** Golos esperados criados menos consentidos, por jogo. */
  xg_diff: number | null;
};

/** Junta as linhas por equipa e calcula todas as medidas. */
export function aggregateTeams(rows: TeamGameRow[]): Map<string, TeamAggregate> {
  // A linha do adversário no mesmo jogo é a da equipa `opponent` nessa data.
  const known = rows.map((r) => r.duration).filter((d): d is number => typeof d === 'number' && d > 0);
  const fallback = known.length ? known.reduce((x, y) => x + y, 0) / known.length : DEFAULT_DURATION;
  // A duração entra nas estatísticas do jogo, para as medidas por minuto.
  const withDuration = (r: TeamGameRow): Stats => ({ ...r.stats, duration: r.duration && r.duration > 0 ? r.duration : fallback });

  const byKey = new Map<string, Stats>();
  for (const r of rows) byKey.set(`${r.match_date}|${r.team}|${r.opponent}`, withDuration(r));

  const own = new Map<string, Stats[]>();
  const opp = new Map<string, Stats[]>();
  const last = new Map<string, string>();
  for (const r of rows) {
    const other = byKey.get(`${r.match_date}|${r.opponent}|${r.team}`);
    if (!other) continue; // jogo com uma só metade: não entra
    if (!own.has(r.team)) {
      own.set(r.team, []);
      opp.set(r.team, []);
    }
    own.get(r.team)!.push(withDuration(r));
    opp.get(r.team)!.push(other);
    if (!last.has(r.team) || r.match_date > last.get(r.team)!) last.set(r.team, r.match_date);
  }

  const out = new Map<string, TeamAggregate>();
  for (const [team, o] of own) {
    const p = opp.get(team)!;
    const values: Record<string, number | null> = {};
    for (const m of TEAM_METRICS) values[m.code] = m.compute(o, p);
    const xg = values.xg;
    const xga = values.xg_against;
    out.set(team, {
      team,
      games: o.length,
      last_date: last.get(team) ?? null,
      values,
      xg_diff: xg != null && xga != null ? xg - xga : null,
    });
  }
  return out;
}

/**
 * Séries: equipas ligadas por jogos entre si. Numa liga de todos contra todos
 * dá um só grupo; no Campeonato de Portugal dá um por série.
 */
export function teamGroups(rows: TeamGameRow[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  for (const r of rows) {
    if (!parent.has(r.team)) parent.set(r.team, r.team);
    if (!parent.has(r.opponent)) parent.set(r.opponent, r.opponent);
    const a = find(r.team);
    const b = find(r.opponent);
    if (a !== b) parent.set(a, b);
  }
  const groups = new Map<string, string[]>();
  for (const t of parent.keys()) {
    const root = find(t);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(t);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a.localeCompare(b, 'pt')));
}

export type Ranked = { value: number | null; rank: number | null; of: number; mean: number | null };

/**
 * Lugar de uma equipa numa medida, dentro de um conjunto de equipas. Empates
 * ficam no mesmo lugar (1, 2, 2, 4).
 */
export function rankIn(
  team: string,
  pick: (a: TeamAggregate) => number | null,
  set: TeamAggregate[],
  lowerFirst = false
): Ranked {
  const withValue = set.filter((a) => pick(a) != null);
  const mine = set.find((a) => a.team === team);
  const value = mine ? pick(mine) : null;
  const mean = withValue.length ? withValue.reduce((acc, a) => acc + (pick(a) as number), 0) / withValue.length : null;
  if (value == null) return { value: null, rank: null, of: withValue.length, mean };
  const better = withValue.filter((a) => {
    const v = pick(a) as number;
    return lowerFirst ? v < value : v > value;
  }).length;
  return { value, rank: better + 1, of: withValue.length, mean };
}

/** Nomes de equipa escritos de forma ligeiramente diferente entre exports. */
export function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|cd|gd|sc|jd|ud|ad|cf|sad|clube|futebol)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Encontra, entre os nomes com estatística, o que corresponde a `name`. */
export function matchTeamName(name: string, candidates: string[]): string | null {
  if (candidates.includes(name)) return name;
  const target = normalizeTeamName(name);
  if (!target) return null;
  const hits = candidates.filter((c) => normalizeTeamName(c) === target);
  return hits.length === 1 ? hits[0] : null;
}
