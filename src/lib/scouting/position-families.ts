/**
 * Famílias de posição: o nível a que um clube pensa quando procura um reforço
 * ("preciso de um lateral"), mais largo do que as posições do Wyscout (LB, RB,
 * LWB, RWB).
 *
 * Usadas pela página Reforços para escolher quem do plantel entra na
 * comparação e que perfis oferecer, e pelo ajuste entre escalões
 * (lib/scouting/league-step.ts), que tem casos por família.
 */

export type PositionFamily = {
  key: string;
  label: string;
  positions: string[];
};

export const POSITION_FAMILIES: PositionFamily[] = [
  { key: 'gk', label: 'Guarda-redes', positions: ['GK'] },
  { key: 'cb', label: 'Central', positions: ['CB', 'LCB', 'RCB'] },
  { key: 'fb', label: 'Lateral', positions: ['LB', 'RB', 'LWB', 'RWB'] },
  { key: 'dm', label: 'Médio defensivo', positions: ['DMF', 'LDMF', 'RDMF'] },
  { key: 'cm', label: 'Médio centro', positions: ['LCMF', 'RCMF', 'CMF'] },
  { key: 'am', label: 'Médio ofensivo', positions: ['AMF'] },
  { key: 'w', label: 'Extremo', positions: ['LW', 'RW', 'LWF', 'RWF', 'LAMF', 'RAMF'] },
  { key: 'cf', label: 'Avançado', positions: ['CF'] },
];

export function familyByKey(key: string | null | undefined): PositionFamily | null {
  if (!key) return null;
  return POSITION_FAMILIES.find((f) => f.key === key) ?? null;
}

export function familyOfPosition(position: string | null | undefined): PositionFamily | null {
  const pos = (position ?? '').trim();
  if (!pos) return null;
  return POSITION_FAMILIES.find((f) => f.positions.includes(pos)) ?? null;
}
