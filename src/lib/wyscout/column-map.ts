/**
 * Mapeamento entre colunas do export Wyscout (português) e o schema canónico.
 *
 * Duas estruturas:
 *  - PLAYER_FIELD_MAP: colunas que alimentam a tabela `players` directamente
 *  - METRIC_MAP: colunas que geram linhas em `player_stats` (uma linha por par player × métrica)
 *
 * Notas importantes:
 *  - Nomes das colunas Wyscout foram tirados de um ficheiro real (Search_results-74.xlsx).
 *    Contêm acentos, maiúsculas, vírgulas e mesmo um ':' — matching é EXACTO.
 *  - A coluna 22 ("Duelos aérios/90") tem typo do Wyscout ("aérios" em vez de "aéreos").
 *    Respeitamos o valor tal como vem — se mudarem amanhã, ajusta aqui.
 *  - A coluna 106 é duplicada ("Duelos aérios/90") e usada para guarda-redes.
 *    Na prática tem valor vazio para jogadores de campo, por isso resolvemos isto no parser
 *    ao tratar strings vazias como `null`.
 */

/** Chaves do objecto em `players` que o parser preenche (excluindo pool_id, id, created_at). */
export type PlayerFieldKey =
  | 'name'
  | 'current_team'
  | 'team_in_period'
  | 'position_primary'
  | 'positions_secondary'
  | 'age'
  | 'market_value_eur'
  | 'contract_until'
  | 'games_played'
  | 'minutes_played'
  | 'foot'
  | 'height_cm'
  | 'weight_kg'
  | 'nationality'
  | 'naturality'

/**
 * Transformações por coluna. Devolvem undefined quando o valor Wyscout deve ser ignorado
 * (ex: string vazia).
 */
export const PLAYER_FIELD_MAP: Record<
  string,
  { field: PlayerFieldKey; transform: (raw: unknown) => unknown }
> = {
  'Jogador': { field: 'name', transform: (v) => String(v ?? '').trim() },
  'Equipa': { field: 'current_team', transform: (v) => toStringOrNull(v) },
  'Equipa dentro de um período de tempo seleccionado': {
    field: 'team_in_period',
    transform: (v) => toStringOrNull(v),
  },
  'Posição': {
    field: 'position_primary',
    transform: (v) => {
      const s = toStringOrNull(v);
      if (!s) return null;
      const first = s.split(',')[0]?.trim();
      return first || null;
    },
  },
  // A mesma coluna "Posição" alimenta também `positions_secondary` — tratamos isso no parser
  // de forma especial (uma coluna, dois destinos).
  'Idade': { field: 'age', transform: toIntOrNull },
  'Valor de mercado': { field: 'market_value_eur', transform: toIntOrNull },
  'Contrato termina': {
    field: 'contract_until',
    transform: (v) => {
      const s = toStringOrNull(v);
      if (!s) return null;
      // Wyscout vem como 'YYYY-MM-DD' — validar superficialmente
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    },
  },
  'Partidas jogadas': { field: 'games_played', transform: toIntOrNull },
  'Minutos jogados:': { field: 'minutes_played', transform: toIntOrNull }, // o ':' está no XLSX real
  'Naturalidade': { field: 'naturality', transform: toStringOrNull },
  'País de nacionalidade': { field: 'nationality', transform: toStringOrNull },
  'Pé': { field: 'foot', transform: toStringOrNull },
  'Altura': { field: 'height_cm', transform: toIntOrNull },
  'Peso': { field: 'weight_kg', transform: toIntOrNull },
};

/**
 * Mapeamento coluna Wyscout -> metric_code canónico.
 * metric_code tem de existir na tabela `metrics` (44 entradas seedadas).
 */
export const METRIC_MAP: Record<string, string> = {
  // ─── Defensivas ─────────────────────────────────────────────────────────
  'Ações defensivas com êxito/90': 'successful_defensive_actions_90',
  'Duelos defensivos ganhos, %': 'defensive_duels_won_pct',
  'Duelos aéreos ganhos, %': 'aerial_duels_won_pct',
  'Cortes/90': 'tackles_90',
  'Cortes de carrinho ajust. à posse': 'tackles_adj_90',
  'Remates intercetados/90': 'shots_blocked_90',
  'Interseções/90': 'interceptions_90',
  'Interceções ajust. à posse': 'interceptions_adj_90',
  'Faltas/90': 'fouls_90',
  'Cartões amarelos': 'yellow_cards',
  'Cartões vermelhos': 'red_cards',

  // ─── Ofensivas ──────────────────────────────────────────────────────────
  'Acções atacantes com sucesso/90': 'successful_attacks_90',
  'Golos/90': 'goals_per_90',
  'Golos esperados/90': 'xg_per_90',
  'Golos de cabeça': 'header_goals',
  'Remates/90': 'shots_per_90',
  'Remates à baliza, %': 'shots_on_target_pct',
  'Golos marcados, %': 'goal_conversion_pct',
  'Assistências/90': 'assists_per_90',
  'Toques na área/90': 'touches_box_per_90',
  'Assistências esperadas/90': 'xa_per_90',

  // ─── Físicas ────────────────────────────────────────────────────────────
  'Duelos ofensivos ganhos, %': 'offensive_duels_won_pct',
  'Faltas sofridas/90': 'fouls_suffered_90',

  // ─── Técnicas ───────────────────────────────────────────────────────────
  'Cruzamentos/90': 'crosses_90',
  'Cruzamentos certos, %': 'crosses_acc_pct',
  'Dribles/90': 'dribbles_90',
  'Dribles com sucesso, %': 'dribbles_success_pct',
  'Corridas progressivas/90': 'progressive_runs_90',
  'Acelerações/90': 'accelerations_90',
  'Passes certos, %': 'pass_accuracy_pct',
  'Passes para a frente certos, %': 'forward_pass_acc_pct',
  'Passes longos certos, %': 'long_pass_acc_pct',
  'Passes inteligentes/90': 'smart_passes_90',
  'Passes chave/90': 'key_passes_90',
  'Passes para terço final/90': 'passes_final_third_90',
  'Passes certos para terço final, %': 'passes_final_third_acc_pct',
  'Passes em profundidade/90': 'through_passes_90',
  'Receção de passes em profundidade/90': 'deep_completions_90',
  'Passes progressivos/90': 'progressive_passes_90',
  'Passes progressivos certos, %': 'progressive_passes_acc_pct',

  // ─── Guarda-redes ───────────────────────────────────────────────────────
  'Golos sofridos/90': 'goals_conceded_90',
  'Jogos sem sofrer golos': 'clean_sheets',
  'Defesas, %': 'save_pct',
  'Golos expectáveis defendidos por 90´': 'xg_prevented_90', // nota o ´ (acento agudo) no fim
  'Saídas/90': 'gk_exits_90',
  
};

// ── helpers ──────────────────────────────────────────────────────────────
function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}