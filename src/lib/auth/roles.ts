/** Funções que se podem escolher ao pedir acesso. */
export const ACCESS_ROLES = ['Scout', 'Treinador', 'Analista', 'Agente', 'Director desportivo', 'Outro'] as const;
export type AccessRole = (typeof ACCESS_ROLES)[number];
