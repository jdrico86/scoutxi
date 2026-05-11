/**
 * Mapping posição Wyscout → métricas relevantes para essa posição.
 *
 * Usado pela feature de Similaridade quando o lens é "perfil completo":
 * define o conjunto de métricas sobre o qual o vector de percentis é
 * comparado. Para lens "profile"/"custom" este mapping é ignorado.
 *
 * REGRA RÍGIDA: apenas métricas per_90 ou ratios. Métricas cumulativas
 * (header_goals, clean_sheets, yellow_cards, red_cards) são proibidas
 * porque enviesam percentis a favor de jogadores com mais minutos
 * (correlação espúria minutos↔valor). Excepções: nenhuma.
 *
 * Decisão de não fazer migration extra para `metrics.applicable_positions`:
 * mapping em código é versionado, mais ágil para iterar. Pode mover para BD
 * se a granularidade futura justificar.
 *
 * Cobertura validada contra as 21 posições primárias distintas em `players`
 * (script de inspecção, eliminado após uso). 9 arquétipos:
 *   GK · CB · FB · DMF · CMF · AMF · Winger · WideMid · CF
 */

const GK_METRICS = [
  'save_pct',
  'xg_prevented_90',
  'goals_conceded_90',
  'gk_exits_90',
  'pass_accuracy_pct',
  'long_pass_acc_pct',
];

const CB_METRICS = [
  // Defesa
  'defensive_duels_won_pct',
  'aerial_duels_won_pct',
  'interceptions_adj_90',
  'tackles_adj_90',
  'successful_defensive_actions_90',
  // Técnica
  'pass_accuracy_pct',
  'forward_pass_acc_pct',
  'progressive_passes_90',
  'long_pass_acc_pct',
  // Físico
  'offensive_duels_won_pct',
];

const FB_METRICS = [
  // Defesa
  'defensive_duels_won_pct',
  'interceptions_adj_90',
  'tackles_adj_90',
  // Ataque
  'xa_per_90',
  'touches_box_per_90',
  'key_passes_90',
  // Técnica
  'crosses_90',
  'crosses_acc_pct',
  'progressive_runs_90',
  'progressive_passes_90',
  'dribbles_success_pct',
  // Físico
  'offensive_duels_won_pct',
  'aerial_duels_won_pct',
];

const DMF_METRICS = [
  // Defesa
  'defensive_duels_won_pct',
  'interceptions_adj_90',
  'tackles_adj_90',
  'successful_defensive_actions_90',
  // Técnica
  'pass_accuracy_pct',
  'progressive_passes_90',
  'progressive_runs_90',
  'forward_pass_acc_pct',
  'long_pass_acc_pct',
  // Físico
  'aerial_duels_won_pct',
];

const CMF_METRICS = [
  // Defesa
  'defensive_duels_won_pct',
  'interceptions_adj_90',
  'tackles_adj_90',
  // Ataque
  'xa_per_90',
  'xg_per_90',
  'touches_box_per_90',
  'key_passes_90',
  // Técnica
  'pass_accuracy_pct',
  'progressive_passes_90',
  'dribbles_90',
  'deep_completions_90',
  // Físico
  'offensive_duels_won_pct',
];

const AMF_METRICS = [
  // Ataque
  'xa_per_90',
  'xg_per_90',
  'key_passes_90',
  'touches_box_per_90',
  'assists_per_90',
  'goals_per_90',
  'shots_per_90',
  // Técnica
  'dribbles_90',
  'dribbles_success_pct',
  'smart_passes_90',
  'through_passes_90',
  'passes_final_third_90',
  'deep_completions_90',
  // Físico
  'offensive_duels_won_pct',
];

// Winger puro: LW, RW, LWF, RWF — burst, dribbling, golo
const WINGER_METRICS = [
  // Ataque
  'xa_per_90',
  'xg_per_90',
  'goals_per_90',
  'touches_box_per_90',
  'shots_per_90',
  'successful_attacks_90',
  // Técnica
  'dribbles_90',
  'dribbles_success_pct',
  'crosses_90',
  'progressive_runs_90',
  'accelerations_90',
  'key_passes_90',
  // Físico
  'offensive_duels_won_pct',
];

// Médio-extremo tradicional: LM, RM — cruzamento, distribuição, contributo defensivo
const WIDEMID_METRICS = [
  // Ataque
  'xa_per_90',
  'key_passes_90',
  // Técnica
  'crosses_90',
  'crosses_acc_pct',
  'progressive_runs_90',
  'progressive_passes_90',
  'pass_accuracy_pct',
  'accelerations_90',
  // Defesa
  'defensive_duels_won_pct',
  'interceptions_adj_90',
  'tackles_adj_90',
  // Físico
  'offensive_duels_won_pct',
];

const CF_METRICS = [
  // Ataque
  'xg_per_90',
  'goals_per_90',
  'xa_per_90',
  'shots_per_90',
  'shots_on_target_pct',
  'goal_conversion_pct',
  'touches_box_per_90',
  'successful_attacks_90',
  // Técnica
  'dribbles_90',
  'progressive_runs_90',
  // Físico
  'aerial_duels_won_pct',
  'offensive_duels_won_pct',
];

export const POSITION_METRICS: Record<string, string[]> = {
  GK: GK_METRICS,

  CB: CB_METRICS,
  LCB: CB_METRICS,
  RCB: CB_METRICS,

  LB: FB_METRICS,
  RB: FB_METRICS,
  LWB: FB_METRICS,
  RWB: FB_METRICS,

  DMF: DMF_METRICS,
  LDMF: DMF_METRICS,
  RDMF: DMF_METRICS,

  CMF: CMF_METRICS,
  LCMF: CMF_METRICS,
  RCMF: CMF_METRICS,

  AMF: AMF_METRICS,
  LAMF: AMF_METRICS,
  RAMF: AMF_METRICS,

  LW: WINGER_METRICS,
  RW: WINGER_METRICS,
  LWF: WINGER_METRICS,
  RWF: WINGER_METRICS,

  LM: WIDEMID_METRICS,
  RM: WIDEMID_METRICS,

  CF: CF_METRICS,
};

/** Devolve a lista de métricas relevantes para uma posição. */
export function getMetricsForPosition(position: string): string[] {
  return POSITION_METRICS[position] ?? [];
}

/** Conjunto de todas as posições suportadas pelo mapping. */
export const SUPPORTED_POSITIONS = new Set(Object.keys(POSITION_METRICS));
