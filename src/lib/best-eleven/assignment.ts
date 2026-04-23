/**
 * Algoritmo greedy de atribuição jogador → slot.
 *
 * Dado:
 *   - 11 slots (cada um com um perfil a aplicar)
 *   - Scores calculados de todos os jogadores elegíveis em cada perfil
 *
 * Gera: 1 jogador por slot, sem repetições, maximizando a soma dos scores.
 *
 * Algoritmo (greedy com desempate):
 *   1. Para cada (slot, jogador elegível) calculamos o score
 *   2. Ordenamos TODAS as atribuições possíveis por score descendente
 *   3. Percorremos a lista: se nem o slot nem o jogador foram ainda atribuídos,
 *      fazemos a atribuição
 *   4. Continuamos até todos os slots estarem preenchidos (ou esgotarmos)
 *
 * Não é óptimo em todos os casos (o problema exacto é Hungarian assignment),
 * mas resolve bem 99% dos casos reais porque os jogadores tipicamente têm
 * uma preferência de posição forte.
 */

import type { SlotDef } from './formations';

export type PlayerScoreInSlot = {
  slot_id: string;
  player_id: string;
  player_name: string;
  player_team: string | null;
  player_position: string | null;
  player_age: number | null;
  player_minutes: number | null;
  player_market_value_eur: number | null;
  player_contract_until: string | null;
  profile_id: string;
  profile_name: string;
  score: number;
};

export type Assignment = {
  slot_id: string;
  slot_label: string;
  profile_id: string;
  profile_name: string;
  player_id: string | null;
  player_name: string | null;
  player_team: string | null;
  player_position: string | null;
  player_age: number | null;
  score: number | null;
  slot_x: number;
  slot_y: number;
  alternatives: Array<{
    player_id: string;
    player_name: string;
    player_team: string | null;
    player_position: string | null;
    score: number;
  }>;
};

export function assignPlayersToSlots(
  slots: SlotDef[],
  slotProfiles: Record<string, { id: string; name: string }>,
  candidates: PlayerScoreInSlot[]
): Assignment[] {
  // Ordenar candidatos por score decrescente
  const sorted = [...candidates].sort((a, b) => b.score - a.score);

  const usedPlayers = new Set<string>();
  const slotAssignments = new Map<string, PlayerScoreInSlot>();
  const slotAlternatives = new Map<string, PlayerScoreInSlot[]>();

  // Inicializar alternativas por slot
  for (const s of slots) slotAlternatives.set(s.id, []);

  // Primeira passada: atribuir principal
  for (const cand of sorted) {
    if (slotAssignments.has(cand.slot_id)) continue;
    if (usedPlayers.has(cand.player_id)) continue;
    slotAssignments.set(cand.slot_id, cand);
    usedPlayers.add(cand.player_id);
  }

  // Segunda passada: recolher top-3 alternativas por slot
  // (jogadores elegíveis ao slot que não foram usados como titular DESSE slot)
  for (const cand of sorted) {
    const alts = slotAlternatives.get(cand.slot_id);
    if (!alts) continue;
    const principal = slotAssignments.get(cand.slot_id);
    if (principal && principal.player_id === cand.player_id) continue;
    if (alts.length >= 3) continue;
    alts.push(cand);
  }

  // Montar resposta ordenada pela ordem original dos slots
  return slots.map((s) => {
    const principal = slotAssignments.get(s.id);
    const profile = slotProfiles[s.id];
    const alts = slotAlternatives.get(s.id) ?? [];
    return {
      slot_id: s.id,
      slot_label: s.label,
      profile_id: profile?.id ?? '',
      profile_name: profile?.name ?? '',
      player_id: principal?.player_id ?? null,
      player_name: principal?.player_name ?? null,
      player_team: principal?.player_team ?? null,
      player_position: principal?.player_position ?? null,
      player_age: principal?.player_age ?? null,
      score: principal?.score ?? null,
      slot_x: s.x,
      slot_y: s.y,
      alternatives: alts.map((a) => ({
        player_id: a.player_id,
        player_name: a.player_name,
        player_team: a.player_team,
        player_position: a.player_position,
        score: a.score,
      })),
    };
  });
}