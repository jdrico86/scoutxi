/**
 * Ajuste entre escalões: quanto mudam os números de um jogador quando sobe.
 *
 * Para cada degrau (Liga 3 → Liga 2, Liga 2 → Liga Portugal), grupo de posição
 * e métrica, guarda-se a distribuição do rácio "valor na época seguinte, no
 * escalão de cima" / "valor na época de partida": número de casos, quartil 25,
 * mediana e quartil 75. O intervalo mostrado ao utilizador é [q25, q75] — metade
 * dos jogadores que deram o salto ficou lá dentro.
 *
 * Casos: jogadores com 900+ minutos na época de partida e minutos regulares na
 * seguinte (900; 300 em 26/27), seguidos pela identidade, épocas 21/22 a 26/27,
 * incluindo quem subiu com o clube. Só entram combinações com 10 ou mais casos.
 *
 * Os números são FIXOS, calculados a 16/11/2026 directamente na base. Têm de
 * ser recalculados quando entrarem épocas novas — não se actualizam sozinhos.
 * A consulta está em "Scout XI — teste da projecção" no projecto.
 *
 * Limites conhecidos (ver "Scout XI — método"):
 *  - por posição os casos são poucos (10 a 30); por isso existe o recurso à
 *    linha (defesa, meio-campo, ataque) quando a posição não tem casos;
 *  - só vale para quem joga com regularidade no escalão de cima;
 *  - não entra a força nem o estilo da equipa de chegada.
 */

/** [casos, q25, mediana, q75] */
export type StepRow = [number, number, number, number];

type StepTable = Record<string, Record<string, StepRow>>;

export const STEP_COMPUTED_AT = '2026-11-16';

/** Chave: `${escalão de partida}>${escalão de chegada}`, depois grupo, depois métrica. */
export const STEP_FACTORS: Record<string, StepTable> = {
  '2>1': {
    att: {
      fouls_90: [42, 0.71, 0.85, 1.13], xa_per_90: [42, 0.51, 0.82, 1.25], xg_per_90: [42, 0.63, 0.94, 1.28],
      crosses_90: [42, 0.64, 0.79, 1.03], tackles_90: [32, 0.38, 1.01, 2.34], dribbles_90: [42, 0.65, 0.83, 0.97],
      key_passes_90: [41, 0.61, 0.91, 1.31], tackles_adj_90: [32, 0.35, 0.98, 2], crosses_acc_pct: [41, 0.77, 0.99, 1.29],
      smart_passes_90: [38, 0.39, 0.59, 1.09], accelerations_90: [41, 0.42, 0.65, 1.11], interceptions_90: [42, 0.84, 0.99, 1.19],
      long_pass_acc_pct: [41, 0.8, 0.92, 1.22], pass_accuracy_pct: [42, 0.95, 1.02, 1.04], through_passes_90: [41, 0.35, 0.64, 1.18],
      touches_box_per_90: [42, 0.7, 0.8, 1.05], deep_completions_90: [42, 0.6, 0.89, 1.21], goal_conversion_pct: [41, 0.48, 0.74, 1.01],
      progressive_runs_90: [42, 0.68, 0.85, 1.02], shots_on_target_pct: [42, 0.69, 0.95, 1.2], aerial_duels_won_pct: [42, 0.74, 0.95, 1.2],
      dribbles_success_pct: [42, 0.92, 1.09, 1.22], forward_pass_acc_pct: [42, 0.88, 0.95, 1.05], interceptions_adj_90: [42, 0.72, 0.86, 1.02],
      passes_final_third_90: [42, 0.85, 1.09, 1.28], progressive_passes_90: [42, 0.81, 0.98, 1.18], successful_attacks_90: [42, 0.71, 0.79, 0.99],
      defensive_duels_won_pct: [42, 0.87, 0.99, 1.08], offensive_duels_won_pct: [42, 0.93, 1.06, 1.14],
      passes_final_third_acc_pct: [42, 0.81, 0.94, 1.12], progressive_passes_acc_pct: [42, 0.83, 0.94, 1.04],
      successful_defensive_actions_90: [42, 0.8, 0.96, 1.12],
    },
    cf: {
      fouls_90: [14, 0.7, 0.8, 1.06], xa_per_90: [14, 0.53, 1, 1.4], xg_per_90: [14, 0.46, 0.59, 0.76],
      crosses_90: [14, 0.62, 0.9, 1.16], dribbles_90: [14, 0.57, 0.86, 0.99], key_passes_90: [14, 0.65, 0.94, 1.3],
      crosses_acc_pct: [13, 0.61, 1.01, 1.44], smart_passes_90: [12, 0.2, 0.42, 0.95], interceptions_90: [14, 0.85, 0.99, 1.24],
      long_pass_acc_pct: [14, 0.73, 0.88, 1.31], pass_accuracy_pct: [14, 0.92, 1, 1.05], touches_box_per_90: [14, 0.69, 0.73, 0.84],
      deep_completions_90: [14, 0.64, 1.01, 1.29], goal_conversion_pct: [14, 0.61, 0.82, 0.84], progressive_runs_90: [14, 0.69, 0.87, 1.01],
      shots_on_target_pct: [14, 0.64, 0.77, 1.11], aerial_duels_won_pct: [14, 0.77, 0.85, 1.06], dribbles_success_pct: [14, 0.8, 1.21, 1.36],
      forward_pass_acc_pct: [14, 0.87, 0.97, 1.16], interceptions_adj_90: [14, 0.8, 0.87, 1.1], passes_final_third_90: [14, 1.03, 1.26, 1.44],
      progressive_passes_90: [14, 0.95, 1.14, 1.4], successful_attacks_90: [14, 0.58, 0.74, 0.97], defensive_duels_won_pct: [14, 0.92, 1, 1.09],
      offensive_duels_won_pct: [14, 0.87, 1.03, 1.4], passes_final_third_acc_pct: [14, 0.85, 0.97, 1.09],
      progressive_passes_acc_pct: [14, 0.84, 0.96, 1.06], successful_defensive_actions_90: [14, 0.76, 0.99, 1.33],
    },
    w: {
      fouls_90: [25, 0.73, 0.91, 1.13], xa_per_90: [25, 0.54, 0.8, 1.27], xg_per_90: [25, 0.81, 1.1, 1.3],
      crosses_90: [25, 0.74, 0.82, 1.02], tackles_90: [22, 0.49, 1.11, 2.24], dribbles_90: [25, 0.68, 0.84, 0.96],
      key_passes_90: [24, 0.61, 0.92, 1.35], tackles_adj_90: [22, 0.41, 1.2, 1.87], crosses_acc_pct: [25, 0.83, 0.99, 1.25],
      smart_passes_90: [23, 0.46, 0.57, 0.9], accelerations_90: [25, 0.57, 0.68, 1.13], interceptions_90: [25, 0.85, 1, 1.13],
      long_pass_acc_pct: [24, 0.81, 0.93, 1.1], pass_accuracy_pct: [25, 0.96, 1.01, 1.03], through_passes_90: [25, 0.49, 0.7, 1.18],
      touches_box_per_90: [25, 0.72, 0.82, 1.06], deep_completions_90: [25, 0.6, 0.69, 1.06], goal_conversion_pct: [24, 0.41, 0.6, 0.88],
      progressive_runs_90: [25, 0.69, 0.84, 1.08], shots_on_target_pct: [25, 0.72, 0.95, 1.17], aerial_duels_won_pct: [25, 0.56, 0.99, 1.45],
      dribbles_success_pct: [25, 0.93, 1.08, 1.17], forward_pass_acc_pct: [25, 0.9, 0.94, 0.99], interceptions_adj_90: [25, 0.71, 0.85, 1.03],
      passes_final_third_90: [25, 0.85, 1.05, 1.15], progressive_passes_90: [25, 0.83, 0.95, 1.14], successful_attacks_90: [25, 0.77, 0.79, 0.99],
      defensive_duels_won_pct: [25, 0.87, 0.99, 1.09], offensive_duels_won_pct: [25, 0.95, 1.06, 1.13],
      passes_final_third_acc_pct: [25, 0.81, 0.89, 1.11], progressive_passes_acc_pct: [25, 0.83, 0.91, 1.01],
      successful_defensive_actions_90: [25, 0.8, 0.96, 1.07],
    },
    mid: {
      fouls_90: [35, 0.81, 0.95, 1.24], xa_per_90: [34, 0.5, 0.7, 1.11], xg_per_90: [35, 0.61, 0.88, 1.16],
      crosses_90: [34, 0.6, 0.85, 1], tackles_90: [34, 0.34, 0.58, 1.02], dribbles_90: [35, 0.61, 0.77, 0.93],
      key_passes_90: [34, 0.39, 0.68, 1.12], tackles_adj_90: [34, 0.3, 0.57, 0.89], crosses_acc_pct: [33, 0.55, 0.88, 1.2],
      smart_passes_90: [34, 0.29, 0.59, 0.93], accelerations_90: [30, 0.43, 0.66, 1.13], interceptions_90: [35, 0.86, 1.01, 1.2],
      shots_blocked_90: [34, 0.46, 1.06, 2.1], long_pass_acc_pct: [35, 0.87, 1.01, 1.12], pass_accuracy_pct: [35, 0.96, 0.99, 1.01],
      through_passes_90: [35, 0.42, 0.59, 1], touches_box_per_90: [35, 0.58, 0.85, 1.28], deep_completions_90: [35, 0.45, 0.65, 1.25],
      progressive_runs_90: [35, 0.69, 0.85, 1.28], shots_on_target_pct: [33, 0.67, 0.9, 1.24], aerial_duels_won_pct: [35, 0.91, 1.05, 1.27],
      dribbles_success_pct: [35, 0.77, 1.02, 1.28], forward_pass_acc_pct: [35, 0.93, 0.96, 1.03], interceptions_adj_90: [35, 0.79, 0.89, 1.06],
      passes_final_third_90: [35, 0.7, 0.83, 0.98], progressive_passes_90: [35, 0.75, 0.88, 1], successful_attacks_90: [35, 0.63, 0.74, 0.87],
      defensive_duels_won_pct: [35, 0.9, 0.97, 1.06], offensive_duels_won_pct: [35, 0.93, 0.99, 1.17],
      passes_final_third_acc_pct: [35, 0.9, 0.97, 1.05], progressive_passes_acc_pct: [35, 0.85, 0.97, 1.02],
      successful_defensive_actions_90: [35, 0.86, 0.96, 1.09],
    },
    cm: {
      fouls_90: [16, 0.82, 0.94, 1.29], xa_per_90: [16, 0.49, 0.66, 1], xg_per_90: [16, 0.65, 0.95, 1.16],
      crosses_90: [15, 0.62, 0.74, 0.9], tackles_90: [16, 0.57, 0.95, 1.76], dribbles_90: [16, 0.68, 0.79, 0.94],
      key_passes_90: [16, 0.4, 0.64, 1.28], tackles_adj_90: [16, 0.53, 0.82, 1.49], crosses_acc_pct: [15, 0.67, 0.94, 1.39],
      smart_passes_90: [16, 0.27, 0.43, 0.92], accelerations_90: [13, 0.48, 0.58, 0.92], interceptions_90: [16, 0.93, 1.01, 1.11],
      shots_blocked_90: [16, 0.68, 1.04, 1.61], long_pass_acc_pct: [16, 0.88, 0.98, 1.11], pass_accuracy_pct: [16, 0.96, 0.99, 1],
      through_passes_90: [16, 0.42, 0.68, 1.13], touches_box_per_90: [16, 0.52, 0.94, 1.57], deep_completions_90: [16, 0.46, 0.56, 0.93],
      progressive_runs_90: [16, 0.67, 0.72, 0.87], shots_on_target_pct: [15, 0.63, 0.9, 1.44], aerial_duels_won_pct: [16, 0.89, 1.07, 1.22],
      dribbles_success_pct: [16, 0.83, 1.02, 1.28], forward_pass_acc_pct: [16, 0.91, 0.96, 1.02], interceptions_adj_90: [16, 0.82, 0.88, 1.04],
      passes_final_third_90: [16, 0.71, 0.81, 1.01], progressive_passes_90: [16, 0.75, 0.85, 0.99], successful_attacks_90: [16, 0.69, 0.79, 0.89],
      defensive_duels_won_pct: [16, 0.93, 0.99, 1.07], offensive_duels_won_pct: [16, 0.92, 0.95, 1.17],
      passes_final_third_acc_pct: [16, 0.89, 0.97, 1.01], progressive_passes_acc_pct: [16, 0.85, 0.92, 0.97],
      successful_defensive_actions_90: [16, 0.88, 0.97, 1.08],
    },
    def: {
      fouls_90: [57, 0.73, 0.92, 1.18], xa_per_90: [47, 0.33, 0.57, 1.12], xg_per_90: [55, 0.51, 1, 1.29],
      crosses_90: [53, 0.72, 0.94, 1.39], tackles_90: [55, 0.44, 0.8, 1.28], dribbles_90: [57, 0.6, 0.81, 1.25],
      key_passes_90: [51, 0.39, 0.9, 1.2], tackles_adj_90: [55, 0.4, 0.76, 1.14], crosses_acc_pct: [51, 0.73, 0.94, 1.2],
      accelerations_90: [53, 0.25, 0.52, 1.22], interceptions_90: [57, 0.93, 1.01, 1.22], shots_blocked_90: [55, 0.76, 1.27, 1.52],
      long_pass_acc_pct: [57, 0.88, 0.95, 1.08], pass_accuracy_pct: [57, 0.96, 0.99, 1.03], through_passes_90: [57, 0.38, 0.76, 1.13],
      touches_box_per_90: [57, 0.72, 0.92, 1.25], deep_completions_90: [57, 0.45, 0.73, 1.08], progressive_runs_90: [57, 0.53, 0.76, 1.06],
      shots_on_target_pct: [53, 0.6, 1.13, 1.75], aerial_duels_won_pct: [57, 0.81, 0.94, 1.08], dribbles_success_pct: [57, 0.71, 0.94, 1.15],
      forward_pass_acc_pct: [57, 0.94, 0.98, 1.02], interceptions_adj_90: [57, 0.8, 0.93, 1.03], passes_final_third_90: [57, 0.72, 0.93, 1.11],
      progressive_passes_90: [57, 0.79, 0.88, 1.04], successful_attacks_90: [57, 0.7, 0.83, 1.04], defensive_duels_won_pct: [57, 0.85, 0.95, 1.06],
      offensive_duels_won_pct: [57, 0.82, 0.98, 1.15], passes_final_third_acc_pct: [57, 0.85, 0.93, 1.02],
      progressive_passes_acc_pct: [57, 0.88, 0.93, 0.98], successful_defensive_actions_90: [57, 0.9, 0.99, 1.11],
    },
    cb: {
      fouls_90: [26, 0.78, 0.89, 1.14], xg_per_90: [26, 0.54, 1, 1.36], crosses_90: [22, 0.38, 0.98, 1.7],
      tackles_90: [26, 0.39, 0.74, 0.99], dribbles_90: [26, 0.63, 0.92, 1.31], tackles_adj_90: [26, 0.3, 0.65, 0.92],
      interceptions_90: [26, 0.87, 1.07, 1.3], shots_blocked_90: [26, 0.95, 1.29, 1.74], long_pass_acc_pct: [26, 0.87, 0.95, 1.02],
      pass_accuracy_pct: [26, 0.98, 1, 1.03], through_passes_90: [26, 0.48, 0.76, 1.04], touches_box_per_90: [26, 0.8, 1.02, 1.3],
      deep_completions_90: [26, 0.41, 0.79, 1.55], progressive_runs_90: [26, 0.47, 0.82, 1.23], shots_on_target_pct: [24, 0.59, 1.29, 1.83],
      aerial_duels_won_pct: [26, 0.88, 0.95, 1.03], dribbles_success_pct: [26, 0.49, 0.73, 1.14], forward_pass_acc_pct: [26, 0.95, 0.98, 1.01],
      interceptions_adj_90: [26, 0.82, 0.98, 1.1], passes_final_third_90: [26, 0.74, 0.94, 1.06], progressive_passes_90: [26, 0.76, 0.87, 1.02],
      successful_attacks_90: [26, 0.71, 0.86, 1.08], defensive_duels_won_pct: [26, 0.84, 0.97, 1.07], offensive_duels_won_pct: [26, 0.74, 0.98, 1.11],
      passes_final_third_acc_pct: [26, 0.88, 0.98, 1.08], progressive_passes_acc_pct: [26, 0.89, 0.94, 0.98],
      successful_defensive_actions_90: [26, 0.9, 1.03, 1.13],
    },
    fb: {
      fouls_90: [29, 0.76, 0.97, 1.2], xa_per_90: [28, 0.55, 0.74, 1.19], xg_per_90: [27, 0.6, 1, 1.25],
      crosses_90: [29, 0.79, 0.94, 1.02], tackles_90: [27, 0.61, 1.1, 1.52], dribbles_90: [29, 0.6, 0.77, 0.94],
      key_passes_90: [29, 0.52, 0.97, 1.09], tackles_adj_90: [27, 0.63, 0.94, 1.2], crosses_acc_pct: [29, 0.81, 0.94, 1.08],
      smart_passes_90: [27, 0.2, 0.45, 0.66], accelerations_90: [28, 0.34, 0.81, 1.23], interceptions_90: [29, 0.96, 1, 1.11],
      shots_blocked_90: [28, 0.67, 1.22, 1.44], long_pass_acc_pct: [29, 0.89, 0.94, 1.08], pass_accuracy_pct: [29, 0.94, 0.98, 1.01],
      through_passes_90: [29, 0.37, 0.72, 1.07], touches_box_per_90: [29, 0.63, 0.89, 1.24], deep_completions_90: [29, 0.5, 0.72, 1.02],
      progressive_runs_90: [29, 0.54, 0.74, 1.02], shots_on_target_pct: [27, 0.67, 1, 1.72], aerial_duels_won_pct: [29, 0.79, 0.93, 1.13],
      dribbles_success_pct: [29, 0.89, 0.98, 1.15], forward_pass_acc_pct: [29, 0.91, 0.97, 1.03], interceptions_adj_90: [29, 0.8, 0.87, 0.97],
      passes_final_third_90: [29, 0.71, 0.89, 1.11], progressive_passes_90: [29, 0.8, 0.88, 1.05], successful_attacks_90: [29, 0.7, 0.83, 1],
      defensive_duels_won_pct: [29, 0.85, 0.94, 1.05], offensive_duels_won_pct: [29, 0.84, 0.99, 1.2],
      passes_final_third_acc_pct: [29, 0.82, 0.93, 0.96], progressive_passes_acc_pct: [29, 0.86, 0.93, 0.97],
      successful_defensive_actions_90: [29, 0.9, 0.97, 1.09],
    },
  },
  '3>2': {
    att: {
      fouls_90: [31, 0.79, 0.98, 1.21], xa_per_90: [31, 0.56, 0.89, 1.24], xg_per_90: [31, 0.74, 0.89, 1.14],
      crosses_90: [31, 0.75, 0.91, 1.26], tackles_90: [24, 0.29, 0.66, 1.14], dribbles_90: [31, 0.65, 0.81, 0.94],
      key_passes_90: [31, 0.56, 1, 1.22], tackles_adj_90: [24, 0.28, 0.65, 1.13], crosses_acc_pct: [31, 0.68, 1.07, 1.29],
      smart_passes_90: [29, 0.32, 0.52, 0.8], accelerations_90: [29, 0.28, 0.55, 0.88], interceptions_90: [31, 0.77, 1.05, 1.21],
      long_pass_acc_pct: [30, 0.93, 1.13, 1.22], pass_accuracy_pct: [31, 0.97, 1, 1.03], through_passes_90: [29, 0.39, 0.57, 0.94],
      touches_box_per_90: [31, 0.81, 0.92, 1.08], deep_completions_90: [31, 0.65, 0.86, 1.06], goal_conversion_pct: [31, 0.26, 0.51, 0.93],
      progressive_runs_90: [31, 0.74, 0.9, 1.07], shots_on_target_pct: [31, 0.7, 0.92, 1.07], aerial_duels_won_pct: [31, 0.83, 0.96, 1.3],
      dribbles_success_pct: [31, 0.97, 1.06, 1.17], forward_pass_acc_pct: [31, 0.94, 1.01, 1.14], interceptions_adj_90: [31, 0.76, 1, 1.16],
      passes_final_third_90: [31, 0.8, 0.98, 1.24], progressive_passes_90: [31, 0.76, 1, 1.24], successful_attacks_90: [31, 0.7, 0.84, 1.05],
      defensive_duels_won_pct: [31, 0.89, 0.96, 1.09], offensive_duels_won_pct: [31, 0.95, 1.01, 1.2],
      passes_final_third_acc_pct: [31, 0.94, 1.06, 1.23], progressive_passes_acc_pct: [31, 0.89, 1.03, 1.11],
      successful_defensive_actions_90: [31, 0.86, 0.91, 1.07],
    },
    cf: {
      fouls_90: [10, 0.82, 1.2, 1.55], xa_per_90: [10, 0.4, 0.46, 1.19], xg_per_90: [10, 0.74, 0.85, 1.02],
      crosses_90: [10, 0.54, 0.83, 1.3], dribbles_90: [10, 0.66, 0.77, 0.88], key_passes_90: [10, 0.59, 1.18, 1.72],
      interceptions_90: [10, 0.93, 1.15, 1.38], pass_accuracy_pct: [10, 0.98, 1.01, 1.04], touches_box_per_90: [10, 0.83, 0.87, 1],
      deep_completions_90: [10, 0.57, 0.77, 1], progressive_runs_90: [10, 0.8, 0.89, 1.03], shots_on_target_pct: [10, 0.75, 0.91, 0.95],
      aerial_duels_won_pct: [10, 0.86, 1.03, 1.28], dribbles_success_pct: [10, 0.77, 0.95, 1.19], forward_pass_acc_pct: [10, 1.01, 1.06, 1.15],
      interceptions_adj_90: [10, 0.94, 1.14, 1.54], passes_final_third_90: [10, 0.72, 1.02, 1.14], progressive_passes_90: [10, 0.62, 0.83, 1.22],
      successful_attacks_90: [10, 0.59, 0.71, 0.92], defensive_duels_won_pct: [10, 0.69, 0.95, 1.02], offensive_duels_won_pct: [10, 0.86, 0.97, 1.35],
      passes_final_third_acc_pct: [10, 0.95, 1.01, 1.16], progressive_passes_acc_pct: [10, 0.82, 0.89, 1.06],
      successful_defensive_actions_90: [10, 0.86, 0.99, 1.11],
    },
    w: {
      fouls_90: [17, 0.84, 0.98, 1.05], xa_per_90: [17, 0.6, 0.94, 1.09], xg_per_90: [17, 0.78, 1, 1.26],
      crosses_90: [17, 0.78, 0.95, 1.24], tackles_90: [14, 0.32, 0.84, 1.07], dribbles_90: [17, 0.73, 0.84, 0.94],
      key_passes_90: [17, 0.57, 0.82, 1.04], tackles_adj_90: [14, 0.31, 0.81, 1.09], crosses_acc_pct: [17, 0.96, 1.09, 1.47],
      smart_passes_90: [17, 0.42, 0.51, 0.6], accelerations_90: [17, 0.25, 0.55, 0.99], interceptions_90: [17, 0.67, 0.85, 1.11],
      long_pass_acc_pct: [17, 0.93, 1.11, 1.18], pass_accuracy_pct: [17, 0.95, 1, 1.02], through_passes_90: [17, 0.43, 0.57, 0.97],
      touches_box_per_90: [17, 0.8, 0.95, 1.16], deep_completions_90: [17, 0.69, 0.86, 1.05], goal_conversion_pct: [17, 0.28, 0.51, 0.94],
      progressive_runs_90: [17, 0.74, 0.94, 1.09], shots_on_target_pct: [17, 0.7, 0.98, 1.13], aerial_duels_won_pct: [17, 0.8, 0.87, 1.26],
      dribbles_success_pct: [17, 0.99, 1.08, 1.2], forward_pass_acc_pct: [17, 0.94, 1, 1.14], interceptions_adj_90: [17, 0.72, 0.99, 1.09],
      passes_final_third_90: [17, 0.82, 0.95, 1.21], progressive_passes_90: [17, 0.78, 1, 1.16], successful_attacks_90: [17, 0.8, 0.92, 1.11],
      defensive_duels_won_pct: [17, 0.93, 0.96, 1.1], offensive_duels_won_pct: [17, 1, 1.04, 1.23],
      passes_final_third_acc_pct: [17, 0.93, 1.12, 1.24], progressive_passes_acc_pct: [17, 0.99, 1.07, 1.12],
      successful_defensive_actions_90: [17, 0.87, 0.91, 0.96],
    },
    mid: {
      fouls_90: [35, 0.73, 0.91, 1.12], xa_per_90: [33, 0.5, 0.8, 1.44], xg_per_90: [34, 0.5, 0.71, 1.55],
      crosses_90: [35, 0.56, 0.85, 1.67], tackles_90: [35, 0.53, 0.85, 1.42], dribbles_90: [35, 0.52, 0.66, 0.81],
      key_passes_90: [33, 0.5, 0.72, 1.45], tackles_adj_90: [35, 0.56, 0.92, 1.3], crosses_acc_pct: [29, 0.62, 0.94, 1.33],
      smart_passes_90: [34, 0.26, 0.39, 0.88], interceptions_90: [35, 0.85, 1, 1.21], shots_blocked_90: [32, 0.76, 1.45, 2.32],
      long_pass_acc_pct: [35, 0.88, 1.02, 1.17], pass_accuracy_pct: [35, 0.99, 1.01, 1.03], through_passes_90: [35, 0.38, 0.55, 0.91],
      touches_box_per_90: [35, 0.51, 0.83, 1.3], deep_completions_90: [35, 0.56, 0.87, 1.18], progressive_runs_90: [35, 0.78, 0.96, 1.2],
      shots_on_target_pct: [32, 0.53, 0.72, 1.16], aerial_duels_won_pct: [35, 0.8, 1.01, 1.19], dribbles_success_pct: [35, 0.77, 0.97, 1.06],
      forward_pass_acc_pct: [35, 0.96, 1.01, 1.06], interceptions_adj_90: [35, 0.85, 1.06, 1.18], passes_final_third_90: [35, 0.78, 0.91, 0.98],
      progressive_passes_90: [35, 0.76, 0.9, 1.01], successful_attacks_90: [35, 0.52, 0.77, 0.87], defensive_duels_won_pct: [35, 0.89, 0.99, 1.06],
      offensive_duels_won_pct: [35, 0.92, 1.01, 1.16], passes_final_third_acc_pct: [35, 0.93, 1.01, 1.1],
      progressive_passes_acc_pct: [35, 0.92, 0.97, 1.04], successful_defensive_actions_90: [35, 0.81, 0.92, 1.07],
    },
    cm: {
      fouls_90: [11, 0.65, 0.81, 0.91], xa_per_90: [11, 0.5, 0.8, 1.58], xg_per_90: [11, 0.41, 0.56, 0.78],
      crosses_90: [11, 0.56, 0.69, 1.38], tackles_90: [11, 0.52, 0.82, 1.13], dribbles_90: [11, 0.6, 0.73, 1.03],
      key_passes_90: [11, 0.67, 0.73, 1.08], tackles_adj_90: [11, 0.52, 0.92, 1.14], crosses_acc_pct: [10, 0.7, 1, 1.24],
      smart_passes_90: [11, 0.3, 0.62, 0.8], interceptions_90: [11, 0.82, 1.01, 1.21], long_pass_acc_pct: [11, 0.85, 0.95, 1.07],
      pass_accuracy_pct: [11, 0.99, 1, 1.04], through_passes_90: [11, 0.43, 0.57, 0.79], touches_box_per_90: [11, 0.42, 0.67, 1.21],
      deep_completions_90: [11, 0.61, 0.87, 0.91], progressive_runs_90: [11, 0.85, 1.02, 1.32], shots_on_target_pct: [10, 0.52, 0.72, 1.05],
      aerial_duels_won_pct: [11, 0.81, 0.96, 1.16], dribbles_success_pct: [11, 0.84, 1, 1.08], forward_pass_acc_pct: [11, 0.95, 1.01, 1.1],
      interceptions_adj_90: [11, 0.85, 1.02, 1.23], passes_final_third_90: [11, 0.89, 0.94, 1.03], progressive_passes_90: [11, 0.83, 0.91, 0.96],
      successful_attacks_90: [11, 0.61, 0.85, 0.87], defensive_duels_won_pct: [11, 0.99, 1.05, 1.07], offensive_duels_won_pct: [11, 0.95, 1.1, 1.18],
      passes_final_third_acc_pct: [11, 0.95, 1.01, 1.14], progressive_passes_acc_pct: [11, 0.89, 0.93, 1.01],
      successful_defensive_actions_90: [11, 0.84, 0.95, 1.05],
    },
    def: {
      fouls_90: [50, 0.81, 0.96, 1.28], xa_per_90: [40, 0.38, 0.75, 1.15], xg_per_90: [47, 0.41, 1, 1.67],
      crosses_90: [45, 0.65, 0.99, 1.33], tackles_90: [46, 0.64, 0.98, 1.49], dribbles_90: [48, 0.5, 0.72, 0.94],
      key_passes_90: [39, 0.47, 0.86, 1.41], tackles_adj_90: [46, 0.59, 0.9, 1.59], crosses_acc_pct: [41, 0.64, 1, 1.11],
      accelerations_90: [38, 0.58, 0.99, 1.3], interceptions_90: [50, 0.92, 1.02, 1.17], shots_blocked_90: [47, 0.95, 1.17, 1.87],
      long_pass_acc_pct: [50, 0.92, 1, 1.12], pass_accuracy_pct: [50, 0.97, 1, 1.03], through_passes_90: [50, 0.47, 0.87, 1.37],
      touches_box_per_90: [50, 0.66, 0.91, 1.26], deep_completions_90: [47, 0.47, 0.88, 1.47], progressive_runs_90: [49, 0.7, 0.9, 1.32],
      shots_on_target_pct: [45, 0.59, 1, 1.75], aerial_duels_won_pct: [50, 0.83, 0.98, 1.16], dribbles_success_pct: [47, 0.79, 1, 1.13],
      forward_pass_acc_pct: [50, 0.96, 1.01, 1.08], interceptions_adj_90: [50, 0.93, 1.05, 1.18], passes_final_third_90: [50, 0.8, 0.96, 1.2],
      progressive_passes_90: [50, 0.83, 0.94, 1.13], successful_attacks_90: [50, 0.62, 0.86, 1.06], defensive_duels_won_pct: [50, 0.89, 0.98, 1.03],
      offensive_duels_won_pct: [50, 0.86, 1.04, 1.3], passes_final_third_acc_pct: [50, 0.93, 1.01, 1.1],
      progressive_passes_acc_pct: [50, 0.95, 1.02, 1.1], successful_defensive_actions_90: [50, 0.89, 0.95, 1.05],
    },
    cb: {
      fouls_90: [25, 0.82, 0.96, 1.33], xg_per_90: [24, 0.66, 1, 2.02], crosses_90: [20, 0.4, 1.16, 2.31],
      tackles_90: [24, 0.74, 1.16, 1.48], dribbles_90: [23, 0.37, 0.69, 1.06], header_goals: [10, 0.75, 1, 1],
      tackles_adj_90: [24, 0.83, 1.12, 1.64], accelerations_90: [14, 0.55, 1, 1.32], interceptions_90: [25, 0.92, 0.96, 1.1],
      shots_blocked_90: [25, 0.93, 1.13, 1.72], long_pass_acc_pct: [25, 0.97, 1.01, 1.13], pass_accuracy_pct: [25, 0.98, 1.01, 1.03],
      through_passes_90: [25, 0.5, 0.86, 1], touches_box_per_90: [25, 0.9, 1.1, 1.39], deep_completions_90: [22, 0.69, 1.37, 1.75],
      goal_conversion_pct: [15, 0.23, 0.75, 1.45], progressive_runs_90: [24, 0.54, 0.98, 1.37], shots_on_target_pct: [23, 0.63, 1, 1.89],
      aerial_duels_won_pct: [25, 0.84, 0.95, 1.18], dribbles_success_pct: [22, 0.52, 0.8, 1], forward_pass_acc_pct: [25, 0.97, 1.03, 1.1],
      interceptions_adj_90: [25, 0.93, 1.05, 1.21], passes_final_third_90: [25, 0.91, 1.07, 1.21], progressive_passes_90: [25, 0.91, 0.97, 1.16],
      successful_attacks_90: [25, 0.59, 0.97, 1.18], defensive_duels_won_pct: [25, 0.86, 0.97, 1.02], offensive_duels_won_pct: [25, 0.74, 0.93, 1.41],
      passes_final_third_acc_pct: [25, 0.94, 1.01, 1.05], progressive_passes_acc_pct: [25, 0.94, 1.02, 1.1],
      successful_defensive_actions_90: [25, 0.9, 0.95, 0.99],
    },
    fb: {
      fouls_90: [23, 0.76, 0.96, 1.2], xa_per_90: [23, 0.67, 1, 1.4], xg_per_90: [22, 0.33, 0.76, 1.25],
      crosses_90: [23, 0.65, 0.78, 1.07], tackles_90: [21, 0.53, 0.8, 1.52], dribbles_90: [23, 0.53, 0.74, 0.89],
      key_passes_90: [23, 0.67, 1.11, 1.41], tackles_adj_90: [21, 0.55, 0.8, 1.6], crosses_acc_pct: [23, 0.9, 1.02, 1.09],
      smart_passes_90: [20, 0.26, 0.75, 1.37], accelerations_90: [22, 0.58, 0.84, 1.19], interceptions_90: [23, 0.93, 1.06, 1.17],
      shots_blocked_90: [20, 1.07, 1.31, 2.28], long_pass_acc_pct: [23, 0.83, 0.96, 1.14], pass_accuracy_pct: [23, 0.97, 1, 1.04],
      through_passes_90: [23, 0.53, 0.87, 1.61], touches_box_per_90: [23, 0.51, 0.79, 0.92], deep_completions_90: [23, 0.44, 0.59, 0.99],
      progressive_runs_90: [23, 0.73, 0.84, 1.17], shots_on_target_pct: [21, 0.57, 0.71, 1.65], aerial_duels_won_pct: [23, 0.83, 0.99, 1.13],
      dribbles_success_pct: [23, 1, 1.12, 1.25], forward_pass_acc_pct: [23, 0.96, 1.01, 1.06], interceptions_adj_90: [23, 0.92, 1.03, 1.18],
      passes_final_third_90: [23, 0.75, 0.88, 1.01], progressive_passes_90: [23, 0.77, 0.87, 1.12], successful_attacks_90: [23, 0.62, 0.78, 0.91],
      defensive_duels_won_pct: [23, 0.91, 0.99, 1.03], offensive_duels_won_pct: [23, 1.02, 1.12, 1.25],
      passes_final_third_acc_pct: [23, 0.89, 0.97, 1.16], progressive_passes_acc_pct: [23, 0.95, 1.01, 1.05],
      successful_defensive_actions_90: [23, 0.87, 0.96, 1.07],
    },
  },
};

/** Linha a que cada família de posição recorre quando não tem casos próprios. */
const FAMILY_LINE: Record<string, 'def' | 'mid' | 'att'> = {
  cb: 'def',
  fb: 'def',
  dm: 'mid',
  cm: 'mid',
  am: 'mid',
  w: 'att',
  cf: 'att',
};

const GROUP_LABEL: Record<string, string> = {
  cb: 'centrais',
  fb: 'laterais',
  cm: 'médios centro',
  w: 'extremos',
  cf: 'avançados',
  def: 'defesas',
  mid: 'médios',
  att: 'atacantes',
};

/**
 * Abaixo deste q25 o rácio é demasiado instável para projectar (acontece em
 * métricas raras, em que muitos jogadores passam a zero). Fica "sem ajuste".
 */
const MIN_Q25 = 0.2;

export type StepFactor = {
  cases: number;
  q25: number;
  q50: number;
  q75: number;
  /** De que grupo vieram os casos, em palavras ("avançados", "atacantes"…). */
  group_label: string;
  /** false quando se recorreu à linha por a posição não ter casos. */
  specific: boolean;
};

/** Existe tabela para este par de escalões? */
export function hasStep(fromTier: number | null, toTier: number | null): boolean {
  if (fromTier == null || toTier == null) return false;
  return `${fromTier}>${toTier}` in STEP_FACTORS;
}

/**
 * Factor de ajuste de uma métrica, ou null quando não há casos suficientes.
 * Tenta a família de posição; se não houver, a linha.
 */
export function stepFactor(
  fromTier: number | null,
  toTier: number | null,
  family: string,
  metricCode: string
): StepFactor | null {
  if (fromTier == null || toTier == null) return null;
  const table = STEP_FACTORS[`${fromTier}>${toTier}`];
  if (!table) return null;

  const candidates: Array<[string, boolean]> = [[family, true]];
  const line = FAMILY_LINE[family];
  if (line) candidates.push([line, false]);

  for (const [group, specific] of candidates) {
    const row = table[group]?.[metricCode];
    if (!row) continue;
    const [cases, q25, q50, q75] = row;
    if (q25 < MIN_Q25) continue;
    return { cases, q25, q50, q75, group_label: GROUP_LABEL[group] ?? group, specific };
  }
  return null;
}

/**
 * Métricas que quase não se repetem de uma época para a seguinte (relação
 * abaixo de 0,25 nos testes de novembro de 2026). Dependem de poucos lances por
 * jogo, por isso uma época boa diz pouco sobre a seguinte. Mostram-se marcadas.
 */
export const LOW_REPEAT_METRICS: ReadonlySet<string> = new Set([
  'goal_conversion_pct',
  'shots_on_target_pct',
  'dribbles_success_pct',
  'defensive_duels_won_pct',
  'offensive_duels_won_pct',
  'key_passes_90',
  'goals_per_90',
  'assists_per_90',
  'header_goals',
  'crosses_acc_pct',
]);
