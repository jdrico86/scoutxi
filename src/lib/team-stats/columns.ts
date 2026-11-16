/**
 * Colunas do ficheiro "Team Stats" do Wyscout (exportado em português).
 *
 * Cada cabeçalho ocupa uma ou mais colunas: "Remates / à baliza" são três
 * (total, à baliza, percentagem). `keys` dá o nome com que cada uma fica
 * guardada em `team_match_stats.stats`. Cabeçalhos que não estão aqui são
 * ignorados e devolvidos como aviso.
 */
export type TeamStatsColumn = { header: string; keys: string[] };

const triple = (code: string): string[] => [code, `${code}_ok`, `${code}_pct`];

export const TEAM_STATS_COLUMNS: TeamStatsColumn[] = [
  { header: 'Golos', keys: ['goals'] },
  { header: 'Golos esperados', keys: ['xg'] },
  { header: 'Remates / à baliza', keys: triple('shots') },
  { header: 'Passes / certos', keys: triple('passes') },
  { header: 'Posse, %', keys: ['possession_pct'] },
  { header: 'Perdas / curto/ médio / longo', keys: ['losses', 'losses_low', 'losses_mid', 'losses_high'] },
  {
    header: 'Recuperações / curto / médio / longo',
    keys: ['recoveries', 'recoveries_low', 'recoveries_mid', 'recoveries_high'],
  },
  { header: 'Duelos/ganhos', keys: triple('duels') },
  { header: 'Remates de fora da área / no alvo', keys: triple('shots_outside') },
  { header: 'Ataques posicionais / com remates', keys: triple('positional_attacks') },
  { header: 'Contra-ataques / com remates', keys: triple('counterattacks') },
  { header: 'Bolas paradas / com remates', keys: triple('set_pieces') },
  { header: 'Cantos / com remates', keys: triple('corners') },
  { header: 'Pontapés livre / com remates', keys: triple('free_kicks') },
  { header: 'Penaltis / convertidos', keys: triple('penalties') },
  { header: 'Cruzamentos / certos', keys: triple('crosses') },
  { header: 'Cruzamentos em profundidade recebidos', keys: ['deep_crosses'] },
  { header: 'Passes em profundidade recebidos', keys: ['deep_passes'] },
  { header: 'Entradas na grande área (corridas/cruzamentos)', keys: ['box_entries', 'box_entries_runs', 'box_entries_crosses'] },
  { header: 'Toques na área', keys: ['box_touches'] },
  { header: 'Duelos ofensivos / ganhos', keys: triple('offensive_duels') },
  { header: 'Foras de jogo', keys: ['offsides'] },
  { header: 'Golos sofridos', keys: ['goals_against'] },
  { header: 'Remates contra / no alvo', keys: triple('shots_against') },
  { header: 'Duelos defensivos / ganhos', keys: triple('defensive_duels') },
  { header: 'Duelos aéreos / ganhos', keys: triple('aerial_duels') },
  { header: 'Carrinhos / bem sucedidos', keys: triple('sliding_tackles') },
  { header: 'Interseções,', keys: ['interceptions'] },
  { header: 'Alívios', keys: ['clearances'] },
  { header: 'Faltas', keys: ['fouls'] },
  { header: 'Cartões amarelos', keys: ['yellow_cards'] },
  { header: 'Cartões vermelhos', keys: ['red_cards'] },
  { header: 'Passes para a frente / certos', keys: triple('forward_passes') },
  { header: 'Passes para trás / certos', keys: triple('back_passes') },
  { header: 'Passes laterais / certos', keys: triple('lateral_passes') },
  { header: 'Passes longos / certos', keys: triple('long_passes') },
  { header: 'Passes para terço final / certos', keys: triple('final_third_passes') },
  { header: 'Passes progressivos / precisos', keys: triple('progressive_passes') },
  { header: 'Passes inteligentes / certos', keys: triple('smart_passes') },
  { header: 'Lançamentos / certos', keys: triple('throw_ins') },
  { header: 'Pontapés de baliza', keys: ['goal_kicks'] },
  { header: 'Intensidade de jogo', keys: ['match_tempo'] },
  { header: 'Média de passes por posse', keys: ['passes_per_possession'] },
  { header: '% de passe longo', keys: ['long_pass_pct'] },
  { header: 'Distância média do remate', keys: ['shot_distance'] },
  { header: 'Comprimento médio de passes', keys: ['pass_length'] },
  { header: 'PPDA', keys: ['ppda'] },
];

/** Cabeçalhos de identificação do jogo, antes das estatísticas. */
export const TEAM_STATS_ID_HEADERS = ['Data', 'Jogo', 'Competição', 'Duração', 'Equipa', 'Sistema'] as const;

/** Colunas sem as quais o ficheiro não serve para nada. */
export const TEAM_STATS_REQUIRED = ['Golos esperados', 'Remates / à baliza', 'Passes / certos', 'Posse, %', 'PPDA'];
