/**
 * Definições das formações tácticas do Scout XI.
 *
 * Cada slot tem:
 *   - line: 'GK' | 'DEF' | 'MID' | 'ATT' (para agrupar visualmente)
 *   - accepted_positions: posições Wyscout que o slot aceita
 *   - x, y: coordenadas 0-100 (percentagem da área do campo)
 *
 * Os slots estão ordenados DENTRO de cada formação por linha (GK → DEF → MID → ATT)
 * e dentro de cada linha da ESQUERDA para a DIREITA. Isto garante que tanto a
 * grelha de configuração como a tabela de resultados seguem a ordem natural.
 */

export type SlotDef = {
  id: string;
  label: string;
  line: 'GK' | 'DEF' | 'MID' | 'ATT';
  accepted_positions: string[];
  x: number;
  y: number;
};

export type FormationDef = {
  id: string;
  name: string;
  description: string;
  slots: SlotDef[];
};

export const FORMATIONS: FormationDef[] = [
  {
    id: '4-3-3',
    name: '4-3-3',
    description: 'Clássico: GK + 4 defesas + 3 médios (1 DMF + 2 CMFs) + 3 avançados.',
    slots: [
      { id: 'GK', label: 'GR', line: 'GK', accepted_positions: ['GK'], x: 50, y: 6 },
      { id: 'LB', label: 'LE', line: 'DEF', accepted_positions: ['LB', 'LWB'], x: 12, y: 24 },
      { id: 'CB_L', label: 'DC E', line: 'DEF', accepted_positions: ['CB', 'LCB'], x: 35, y: 20 },
      { id: 'CB_R', label: 'DC D', line: 'DEF', accepted_positions: ['CB', 'RCB'], x: 65, y: 20 },
      { id: 'RB', label: 'LD', line: 'DEF', accepted_positions: ['RB', 'RWB'], x: 88, y: 24 },
      { id: 'CM_L', label: 'MC E', line: 'MID', accepted_positions: ['CMF', 'AMF', 'DMF'], x: 28, y: 52 },
      { id: 'DMF', label: 'MD', line: 'MID', accepted_positions: ['DMF', 'CMF'], x: 50, y: 42 },
      { id: 'CM_R', label: 'MC D', line: 'MID', accepted_positions: ['CMF', 'AMF', 'DMF'], x: 72, y: 52 },
      { id: 'LW', label: 'EXT E', line: 'ATT', accepted_positions: ['LW', 'LWF', 'LAMF'], x: 15, y: 80 },
      { id: 'CF', label: 'PL', line: 'ATT', accepted_positions: ['CF'], x: 50, y: 86 },
      { id: 'RW', label: 'EXT D', line: 'ATT', accepted_positions: ['RW', 'RWF', 'RAMF'], x: 85, y: 80 },
    ],
  },
  {
    id: '4-2-3-1',
    name: '4-2-3-1',
    description: 'Moderno: GK + 4 defesas + 2 DMFs + 1 AMF + 2 extremos + 1 PL. Ideal para um 10 clássico.',
    slots: [
      { id: 'GK', label: 'GR', line: 'GK', accepted_positions: ['GK'], x: 50, y: 6 },
      { id: 'LB', label: 'LE', line: 'DEF', accepted_positions: ['LB', 'LWB'], x: 12, y: 24 },
      { id: 'CB_L', label: 'DC E', line: 'DEF', accepted_positions: ['CB', 'LCB'], x: 35, y: 20 },
      { id: 'CB_R', label: 'DC D', line: 'DEF', accepted_positions: ['CB', 'RCB'], x: 65, y: 20 },
      { id: 'RB', label: 'LD', line: 'DEF', accepted_positions: ['RB', 'RWB'], x: 88, y: 24 },
      { id: 'DMF_L', label: 'MD E', line: 'MID', accepted_positions: ['DMF', 'CMF'], x: 35, y: 42 },
      { id: 'DMF_R', label: 'MD D', line: 'MID', accepted_positions: ['DMF', 'CMF'], x: 65, y: 42 },
      { id: 'AMF', label: '10', line: 'MID', accepted_positions: ['AMF', 'CMF'], x: 50, y: 62 },
      { id: 'LW', label: 'EXT E', line: 'ATT', accepted_positions: ['LW', 'LWF', 'LAMF'], x: 15, y: 72 },
      { id: 'CF', label: 'PL', line: 'ATT', accepted_positions: ['CF'], x: 50, y: 88 },
      { id: 'RW', label: 'EXT D', line: 'ATT', accepted_positions: ['RW', 'RWF', 'RAMF'], x: 85, y: 72 },
    ],
  },
  {
    id: '4-4-2',
    name: '4-4-2',
    description: 'Tradicional: GK + 4 defesas + 4 médios em linha + 2 avançados.',
    slots: [
      { id: 'GK', label: 'GR', line: 'GK', accepted_positions: ['GK'], x: 50, y: 6 },
      { id: 'LB', label: 'LE', line: 'DEF', accepted_positions: ['LB', 'LWB'], x: 12, y: 24 },
      { id: 'CB_L', label: 'DC E', line: 'DEF', accepted_positions: ['CB', 'LCB'], x: 35, y: 20 },
      { id: 'CB_R', label: 'DC D', line: 'DEF', accepted_positions: ['CB', 'RCB'], x: 65, y: 20 },
      { id: 'RB', label: 'LD', line: 'DEF', accepted_positions: ['RB', 'RWB'], x: 88, y: 24 },
      { id: 'LM', label: 'MEC E', line: 'MID', accepted_positions: ['LW', 'LM', 'LAMF', 'CMF'], x: 15, y: 52 },
      { id: 'CM_L', label: 'MC E', line: 'MID', accepted_positions: ['CMF', 'DMF', 'AMF'], x: 38, y: 50 },
      { id: 'CM_R', label: 'MC D', line: 'MID', accepted_positions: ['CMF', 'DMF', 'AMF'], x: 62, y: 50 },
      { id: 'RM', label: 'MEC D', line: 'MID', accepted_positions: ['RW', 'RM', 'RAMF', 'CMF'], x: 85, y: 52 },
      { id: 'CF_L', label: 'PL E', line: 'ATT', accepted_positions: ['CF'], x: 38, y: 85 },
      { id: 'CF_R', label: 'PL D', line: 'ATT', accepted_positions: ['CF'], x: 62, y: 85 },
    ],
  },
  {
    id: '3-5-2',
    name: '3-5-2',
    description: 'Com 3 centrais e alas ofensivos (wing-backs): GK + 3 CBs + 2 WBs + 3 médios + 2 PLs.',
    slots: [
      { id: 'GK', label: 'GR', line: 'GK', accepted_positions: ['GK'], x: 50, y: 6 },
      { id: 'CB_L', label: 'DC E', line: 'DEF', accepted_positions: ['CB', 'LCB'], x: 25, y: 22 },
      { id: 'CB_C', label: 'DC', line: 'DEF', accepted_positions: ['CB'], x: 50, y: 18 },
      { id: 'CB_R', label: 'DC D', line: 'DEF', accepted_positions: ['CB', 'RCB'], x: 75, y: 22 },
      { id: 'WB_L', label: 'ALA E', line: 'MID', accepted_positions: ['LWB', 'LB', 'LW', 'LM', 'LAMF'], x: 8, y: 48 },
      { id: 'CM_L', label: 'MC E', line: 'MID', accepted_positions: ['CMF', 'AMF'], x: 32, y: 58 },
      { id: 'DMF', label: 'MD', line: 'MID', accepted_positions: ['DMF', 'CMF'], x: 50, y: 42 },
      { id: 'CM_R', label: 'MC D', line: 'MID', accepted_positions: ['CMF', 'AMF'], x: 68, y: 58 },
      { id: 'WB_R', label: 'ALA D', line: 'MID', accepted_positions: ['RWB', 'RB', 'RW', 'RM', 'RAMF'], x: 92, y: 48 },
      { id: 'CF_L', label: 'PL E', line: 'ATT', accepted_positions: ['CF'], x: 38, y: 85 },
      { id: 'CF_R', label: 'PL D', line: 'ATT', accepted_positions: ['CF'], x: 62, y: 85 },
    ],
  },
  {
    id: '3-4-3',
    name: '3-4-3',
    description:
      '3 centrais + linha de 4 (2 MCs + 2 alas) + 3 na frente (2 extremos interiorizados + 1 PL).',
    slots: [
      { id: 'GK', label: 'GR', line: 'GK', accepted_positions: ['GK'], x: 50, y: 6 },
      { id: 'CB_L', label: 'DC E', line: 'DEF', accepted_positions: ['CB', 'LCB'], x: 25, y: 22 },
      { id: 'CB_C', label: 'DC', line: 'DEF', accepted_positions: ['CB'], x: 50, y: 18 },
      { id: 'CB_R', label: 'DC D', line: 'DEF', accepted_positions: ['CB', 'RCB'], x: 75, y: 22 },
      { id: 'WM_L', label: 'ALA E', line: 'MID', accepted_positions: ['LWB', 'LB', 'LW', 'LM', 'LAMF'], x: 8, y: 50 },
      { id: 'CM_L', label: 'MC E', line: 'MID', accepted_positions: ['CMF', 'DMF', 'AMF'], x: 35, y: 50 },
      { id: 'CM_R', label: 'MC D', line: 'MID', accepted_positions: ['CMF', 'DMF', 'AMF'], x: 65, y: 50 },
      { id: 'WM_R', label: 'ALA D', line: 'MID', accepted_positions: ['RWB', 'RB', 'RW', 'RM', 'RAMF'], x: 92, y: 50 },
      { id: 'LW', label: 'EXT E', line: 'ATT', accepted_positions: ['LW', 'LWF', 'LAMF', 'AMF'], x: 25, y: 80 },
      { id: 'CF', label: 'PL', line: 'ATT', accepted_positions: ['CF'], x: 50, y: 88 },
      { id: 'RW', label: 'EXT D', line: 'ATT', accepted_positions: ['RW', 'RWF', 'RAMF', 'AMF'], x: 75, y: 80 },
    ],
  },
];

export function getFormation(id: string): FormationDef | null {
  return FORMATIONS.find((f) => f.id === id) ?? null;
}