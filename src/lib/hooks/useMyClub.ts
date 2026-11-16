'use client';

/**
 * "Meu clube": o clube com que o utilizador trabalha.
 *
 * Fica guardado nas preferências da conta (user_metadata do Supabase Auth), não
 * numa tabela — cada utilizador tem o seu e não é preciso mexer na base.
 *
 * Guarda-se o NOME do clube e a competição, não a pool: as pools mudam a cada
 * época. `/api/teams/locate` encontra a pool mais recente onde o clube aparece,
 * por isso o atalho continua a funcionar depois de importar uma época nova ou
 * de o clube mudar de escalão.
 *
 * Estado partilhado ao nível do módulo, como em useFavorites: a barra lateral,
 * a página Equipas e a página Reforços vêem a mesma coisa e actualizam juntas.
 */

import { useCallback, useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

export type MyClub = { team: string; competition_key: string | null };

export type MyClubLocation = {
  pool_id: string;
  pool_name: string;
  season: string;
  competition: string | null;
};

type State = {
  /** false até se saber se o utilizador tem clube definido. */
  loaded: boolean;
  club: MyClub | null;
  /** null enquanto se procura, ou quando o clube não está em nenhuma pool. */
  location: MyClubLocation | null;
};

let state: State = { loaded: false, club: null, location: null };
const subscribers = new Set<(s: State) => void>();
let listening = false;
let locateSeq = 0;

function publish(next: State) {
  state = next;
  for (const s of subscribers) s(next);
}

/** Lê o clube das preferências, desconfiando do formato. */
function readClub(metadata: unknown): MyClub | null {
  const raw = (metadata as { my_club?: unknown } | null | undefined)?.my_club;
  if (!raw || typeof raw !== 'object') return null;
  const { team, competition_key } = raw as { team?: unknown; competition_key?: unknown };
  if (typeof team !== 'string' || team.trim() === '') return null;
  return { team, competition_key: typeof competition_key === 'string' ? competition_key : null };
}

function sameClub(a: MyClub | null, b: MyClub | null): boolean {
  if (!a || !b) return a === b;
  return a.team === b.team && a.competition_key === b.competition_key;
}

async function locate(club: MyClub) {
  const seq = ++locateSeq;
  try {
    const params = new URLSearchParams({ team: club.team });
    if (club.competition_key) params.set('competition_key', club.competition_key);
    const res = await fetch(`/api/teams/locate?${params}`);
    const json = res.ok ? await res.json() : null;
    // Só conta a resposta do pedido mais recente, e só se o clube ainda for o mesmo.
    if (seq !== locateSeq || !sameClub(state.club, club)) return;
    publish({ ...state, location: (json?.located as MyClubLocation | null) ?? null });
  } catch {
    // Sem localização o atalho fica só com o nome — não bloqueia nada.
  }
}

function applyClub(club: MyClub | null) {
  if (state.loaded && sameClub(state.club, club)) return;
  publish({ loaded: true, club, location: null });
  if (club) void locate(club);
}

function startListening() {
  if (listening) return;
  listening = true;
  const supabase = createSupabaseBrowserClient();
  // O primeiro evento (INITIAL_SESSION) traz a sessão actual; USER_UPDATED chega
  // quando o clube é mudado, aqui ou noutro separador.
  supabase.auth.onAuthStateChange((_event, session) => {
    applyClub(readClub(session?.user?.user_metadata));
  });
}

export function useMyClub() {
  const [snapshot, setSnapshot] = useState<State>(state);

  useEffect(() => {
    subscribers.add(setSnapshot);
    startListening();
    return () => {
      subscribers.delete(setSnapshot);
    };
  }, []);

  /** Define o clube, ou limpa-o com null. Devolve a mensagem de erro, se houver. */
  const setClub = useCallback(async (club: MyClub | null): Promise<string | null> => {
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ data: { my_club: club } });
    if (error) return error.message;
    applyClub(club);
    return null;
  }, []);

  return { ...snapshot, setClub };
}
