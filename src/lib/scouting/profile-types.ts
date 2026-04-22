/**
 * Tipos para o sistema de perfis de scouting.
 *
 * Um perfil é a especificação completa de "que tipo de jogador procuro":
 *   - quem é elegível (filtros)
 *   - o que valorizo (pesos por métrica)
 *
 * O scorer transforma isto num ranking aplicado a um pool.
 */

/** Filtros de elegibilidade: jogadores que NÃO passam são excluídos do ranking. */
export type ProfileFilters = {
  /** Posições primárias aceites. Ex: ['LW', 'RW', 'LWF', 'RWF']. Vazio = todas. */
  positions?: string[];
  /** Minutos mínimos jogados (para evitar amostras absurdas). */
  min_minutes?: number;
  /** Idade mínima/máxima inclusivas. */
  min_age?: number;
  max_age?: number;
  /** Contract_until <= esta data (YYYY-MM-DD). Útil para targets de fim de contrato. */
  contract_until_before?: string;
  /** Se true, só aceita jogadores emprestados; se false, só não-emprestados; undef = ambos. */
  on_loan?: boolean;
};

/** Peso de uma métrica no perfil. Pesos devem somar 100 (validamos). */
export type MetricWeight = {
  metric_code: string; // tem de existir na tabela `metrics`
  weight: number; // 0-100
  /**
   * Override da direcção. Default usa a coluna `direction` em `metrics`.
   * 'higher' = maior é melhor (default), 'lower' = menor é melhor (ex: faltas, cartões).
   */
  direction?: 'higher' | 'lower';
};

/** Definição completa de um perfil. */
export type ScoutingProfile = {
  name: string;
  description?: string;
  filters: ProfileFilters;
  weights: MetricWeight[];
  /**
   * Grupo posicional para cálculo de percentis. Os percentis de um jogador são
   * calculados DENTRO do seu grupo, não do pool inteiro. Ex: um extremo é comparado
   * com outros extremos, não com centrais.
   *
   * Se não fornecido, usa `filters.positions` como grupo — mas isto pode ser
   * demasiado restritivo (ex: só LW tem ~30 jogadores, pouco para percentis estáveis).
   * Por isso separamos: filtros podem ser [LW, RW] e peer_group pode ser mais largo
   * [LW, RW, LWF, RWF, LM, RM] para ter amostra decente.
   */
  peer_group_positions?: string[];
};

/** Jogador com score calculado e explicação. */
export type ScoredPlayer = {
  player_id: string;
  name: string;
  current_team: string | null;
  position_primary: string | null;
  age: number | null;
  minutes_played: number | null;
  contract_until: string | null;
  market_value_eur: number | null;
  score: number; // 0-100
  /** Breakdown por métrica para explicar como se chegou ao score. */
  contributions: Array<{
    metric_code: string;
    raw_value: number | null;
    percentile: number; // 0-100
    weight: number;
    contribution: number; // percentile × (weight / 100)
  }>;
  /** Métricas do perfil para as quais o jogador não tinha valor. */
  missing_metrics: string[];
};

/** Resultado completo do scoring. */
export type ScoringResult = {
  profile: ScoutingProfile;
  pool_id: string;
  total_players_in_pool: number;
  eligible_count: number; // passaram os filtros
  peer_group_size: number; // tamanho da amostra para cálculo de percentis
  ranked: ScoredPlayer[]; // ordenado por score descendente
  warnings: string[];
};