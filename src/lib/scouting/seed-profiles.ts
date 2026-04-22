/**
 * Biblioteca de perfis-semente do Scout XI.
 *
 * Estes perfis são o ponto de partida — pensados para divisões portuguesas
 * secundárias (CdP / Liga 3). Reflectem arquétipos modernos de cada posição:
 *
 *  - Extremo desequilibrador 1v1 (LW/RW)
 *  - Avançado referência na área (CF "poste")
 *  - Avançado móvel (CF associativo, alternativa)
 *  - Médio ofensivo (10 clássico)
 *  - Médio de ligação (8 box-to-box)
 *  - Médio recuperador-distribuidor (DMF/CMF)
 *  - Central defensor moderno (CB equilibrado)
 *  - Central físico (CB robusto, alternativa)
 *  - Lateral híbrido atacante (LB/RB)
 *  - Guarda-redes (GK)
 *
 * Podem ser copiados para a base (via script seed) e depois editados/clonados
 * pelo utilizador para criar perfis específicos para cada modelo de jogo.
 *
 * Todos os pesos somam 100. Filtros sensatos por defeito (min_minutes: 500,
 * idade 18-34) — ajustar por caso de uso.
 */

import type { ScoutingProfile } from './profile-types';

export const PROFILE_EXTREMO_DESEQUILIBRADOR: ScoutingProfile = {
  name: 'Extremo desequilibrador 1v1',
  description:
    'Extremo que cria rupturas no corredor, ganha o 1v1 e finaliza. Alto volume de drible, criação por xA, presença na área.',
  filters: {
    positions: ['LW', 'RW', 'LWF', 'RWF'],
    min_minutes: 500,
    min_age: 18,
    max_age: 32,
  },
  peer_group_positions: ['LW', 'RW', 'LWF', 'RWF', 'LM', 'RM', 'LAMF', 'RAMF'],
  weights: [
    { metric_code: 'dribbles_success_pct', weight: 15 },
    { metric_code: 'offensive_duels_won_pct', weight: 15 },
    { metric_code: 'progressive_runs_90', weight: 15 },
    { metric_code: 'xa_per_90', weight: 15 },
    { metric_code: 'xg_per_90', weight: 10 },
    { metric_code: 'touches_box_per_90', weight: 10 },
    { metric_code: 'dribbles_90', weight: 10 },
    { metric_code: 'successful_attacks_90', weight: 10 },
  ],
};

export const PROFILE_AVANCADO_REFERENCIA: ScoutingProfile = {
  name: 'Avançado referência na área',
  description:
    'Ponta-de-lança que finaliza, protege bola de costas, ganha duelos aéreos e aguenta marcação apertada.',
  filters: {
    positions: ['CF'],
    min_minutes: 500,
    min_age: 18,
    max_age: 34,
  },
  peer_group_positions: ['CF'],
  weights: [
    { metric_code: 'xg_per_90', weight: 20 },
    { metric_code: 'goal_conversion_pct', weight: 15 },
    { metric_code: 'aerial_duels_won_pct', weight: 15 },
    { metric_code: 'offensive_duels_won_pct', weight: 15 },
    { metric_code: 'touches_box_per_90', weight: 10 },
    { metric_code: 'shots_on_target_pct', weight: 10 },
    { metric_code: 'xa_per_90', weight: 10 },
    { metric_code: 'header_goals', weight: 5 },
  ],
};

export const PROFILE_AVANCADO_MOVEL: ScoutingProfile = {
  name: 'Avançado móvel (9 associativo)',
  description:
    'CF que joga entre linhas, combina, aparece na área na hora certa. Oposto do poste: mais agilidade e menos jogo de costas.',
  filters: {
    positions: ['CF'],
    min_minutes: 500,
    min_age: 18,
    max_age: 33,
  },
  peer_group_positions: ['CF'],
  weights: [
    { metric_code: 'xg_per_90', weight: 20 },
    { metric_code: 'xa_per_90', weight: 15 },
    { metric_code: 'goal_conversion_pct', weight: 15 },
    { metric_code: 'touches_box_per_90', weight: 10 },
    { metric_code: 'dribbles_success_pct', weight: 10 },
    { metric_code: 'progressive_runs_90', weight: 10 },
    { metric_code: 'offensive_duels_won_pct', weight: 10 },
    { metric_code: 'shots_on_target_pct', weight: 10 },
  ],
};

export const PROFILE_MEDIO_OFENSIVO: ScoutingProfile = {
  name: 'Médio ofensivo (10 clássico)',
  description:
    'Número 10 atrás do avançado. Criador principal, passes chave, chega à área. Distinto do médio recuperador.',
  filters: {
    positions: ['AMF', 'LAMF', 'RAMF'],
    min_minutes: 500,
    min_age: 18,
    max_age: 33,
  },
  peer_group_positions: ['AMF', 'LAMF', 'RAMF'],
  weights: [
    { metric_code: 'xa_per_90', weight: 20 },
    { metric_code: 'key_passes_90', weight: 15 },
    { metric_code: 'smart_passes_90', weight: 10 },
    { metric_code: 'xg_per_90', weight: 10 },
    { metric_code: 'passes_final_third_90', weight: 10 },
    { metric_code: 'touches_box_per_90', weight: 10 },
    { metric_code: 'dribbles_success_pct', weight: 10 },
    { metric_code: 'progressive_passes_90', weight: 10 },
    { metric_code: 'through_passes_90', weight: 5 },
  ],
};

export const PROFILE_MEDIO_LIGACAO: ScoutingProfile = {
  name: 'Médio de ligação (8 box-to-box)',
  description:
    'Médio que contribui nas duas fases. Volume, progressão, chegada à área. Entre o recuperador e o criador.',
  filters: {
    positions: ['CMF', 'LCMF', 'RCMF', 'AMF'],
    min_minutes: 500,
    min_age: 18,
    max_age: 33,
  },
  peer_group_positions: ['CMF', 'LCMF', 'RCMF', 'AMF', 'LAMF', 'RAMF'],
  weights: [
    { metric_code: 'progressive_passes_90', weight: 15 },
    { metric_code: 'successful_defensive_actions_90', weight: 15 },
    { metric_code: 'progressive_runs_90', weight: 10 },
    { metric_code: 'pass_accuracy_pct', weight: 10 },
    { metric_code: 'interceptions_adj_90', weight: 10 },
    { metric_code: 'touches_box_per_90', weight: 10 },
    { metric_code: 'xa_per_90', weight: 10 },
    { metric_code: 'defensive_duels_won_pct', weight: 10 },
    { metric_code: 'passes_final_third_90', weight: 10 },
  ],
};

export const PROFILE_MEDIO_RECUPERADOR: ScoutingProfile = {
  name: 'Médio recuperador-distribuidor',
  description:
    'Base do meio-campo. Recupera bola, liga jogo entre linhas e faz a equipa progredir pelo passe.',
  filters: {
    positions: ['CMF', 'DMF', 'LCMF', 'RCMF', 'LDMF', 'RDMF'],
    min_minutes: 500,
    min_age: 18,
    max_age: 33,
  },
  peer_group_positions: ['CMF', 'DMF', 'LCMF', 'RCMF', 'LDMF', 'RDMF'],
  weights: [
    { metric_code: 'interceptions_adj_90', weight: 15 },
    { metric_code: 'defensive_duels_won_pct', weight: 15 },
    { metric_code: 'progressive_passes_90', weight: 15 },
    { metric_code: 'pass_accuracy_pct', weight: 10 },
    { metric_code: 'successful_defensive_actions_90', weight: 10 },
    { metric_code: 'key_passes_90', weight: 10 },
    { metric_code: 'passes_final_third_90', weight: 10 },
    { metric_code: 'tackles_adj_90', weight: 10 },
    { metric_code: 'forward_pass_acc_pct', weight: 5 },
  ],
};

export const PROFILE_CENTRAL_MODERNO: ScoutingProfile = {
  name: 'Central defensor moderno',
  description:
    'Defesa central que ganha a primeira bola, inicia construção com passe progressivo e não comete erros básicos.',
  filters: {
    positions: ['CB', 'LCB', 'RCB'],
    min_minutes: 500,
    min_age: 18,
    max_age: 33,
  },
  peer_group_positions: ['CB', 'LCB', 'RCB'],
  weights: [
    { metric_code: 'aerial_duels_won_pct', weight: 20 },
    { metric_code: 'defensive_duels_won_pct', weight: 20 },
    { metric_code: 'interceptions_adj_90', weight: 15 },
    { metric_code: 'pass_accuracy_pct', weight: 10 },
    { metric_code: 'long_pass_acc_pct', weight: 10 },
    { metric_code: 'progressive_passes_90', weight: 10 },
    { metric_code: 'successful_defensive_actions_90', weight: 10 },
    { metric_code: 'forward_pass_acc_pct', weight: 5 },
  ],
};

export const PROFILE_CENTRAL_FISICO: ScoutingProfile = {
  name: 'Central físico (CB robusto)',
  description:
    'Alternativa ao central moderno. Pesa mais duelo e aéreo, menos construção. Para equipas defensivas ou jogo directo.',
  filters: {
    positions: ['CB', 'LCB', 'RCB'],
    min_minutes: 500,
    min_age: 18,
    max_age: 34,
  },
  peer_group_positions: ['CB', 'LCB', 'RCB'],
  weights: [
    { metric_code: 'aerial_duels_won_pct', weight: 25 },
    { metric_code: 'defensive_duels_won_pct', weight: 25 },
    { metric_code: 'interceptions_adj_90', weight: 15 },
    { metric_code: 'successful_defensive_actions_90', weight: 10 },
    { metric_code: 'tackles_adj_90', weight: 10 },
    { metric_code: 'pass_accuracy_pct', weight: 5 },
    { metric_code: 'shots_blocked_90', weight: 5 },
    { metric_code: 'header_goals', weight: 5 },
  ],
};

export const PROFILE_LATERAL_HIBRIDO: ScoutingProfile = {
  name: 'Lateral híbrido atacante',
  description:
    'Lateral que defende o corredor mas contribui ofensivamente por cruzamento e progressão com bola.',
  filters: {
    positions: ['LB', 'RB', 'LWB', 'RWB'],
    min_minutes: 500,
    min_age: 18,
    max_age: 32,
  },
  peer_group_positions: ['LB', 'RB', 'LWB', 'RWB'],
  weights: [
    { metric_code: 'defensive_duels_won_pct', weight: 15 },
    { metric_code: 'crosses_acc_pct', weight: 15 },
    { metric_code: 'progressive_runs_90', weight: 15 },
    { metric_code: 'xa_per_90', weight: 10 },
    { metric_code: 'interceptions_adj_90', weight: 10 },
    { metric_code: 'aerial_duels_won_pct', weight: 10 },
    { metric_code: 'crosses_90', weight: 10 },
    { metric_code: 'successful_defensive_actions_90', weight: 10 },
    { metric_code: 'pass_accuracy_pct', weight: 5 },
  ],
};

export const PROFILE_GUARDA_REDES: ScoutingProfile = {
  name: 'Guarda-redes moderno',
  description:
    'Guarda-redes cujo valor se mede em defesas acima do esperado (xG prevented), não só em percentagem de defesas.',
  filters: {
    positions: ['GK'],
    min_minutes: 500,
    min_age: 18,
    max_age: 38,
  },
  peer_group_positions: ['GK'],
  weights: [
    { metric_code: 'xg_prevented_90', weight: 40 },
    { metric_code: 'save_pct', weight: 25 },
    { metric_code: 'goals_conceded_90', weight: 20, direction: 'lower' },
    { metric_code: 'clean_sheets', weight: 15 },
  ],
};

/** Lista de todos os perfis-semente para facilitar seed em batch. */
export const SEED_PROFILES: ScoutingProfile[] = [
  PROFILE_EXTREMO_DESEQUILIBRADOR,
  PROFILE_AVANCADO_REFERENCIA,
  PROFILE_AVANCADO_MOVEL,
  PROFILE_MEDIO_OFENSIVO,
  PROFILE_MEDIO_LIGACAO,
  PROFILE_MEDIO_RECUPERADOR,
  PROFILE_CENTRAL_MODERNO,
  PROFILE_CENTRAL_FISICO,
  PROFILE_LATERAL_HIBRIDO,
  PROFILE_GUARDA_REDES,
];