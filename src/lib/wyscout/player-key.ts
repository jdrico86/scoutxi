/**
 * Chave de identidade de um jogador dentro de uma pool.
 *
 * Nome + equipa por quem joga nesta competição + altura + pé.
 *
 * A equipa é a "equipa dentro do período" do Wyscout, NÃO o clube de inscrição
 * (`current_team`). O clube de inscrição muda entre exports — empréstimos,
 * regressos ao clube de origem, subidas da equipa B à principal — e cada mudança
 * criava uma segunda linha para o mesmo jogador (24 repetidos nas pools do
 * Campeonato de Portugal, limpos a 14/11/2026). A equipa do período só muda se
 * o jogador mudar mesmo de equipa dentro da competição.
 *
 * NUNCA a idade na chave: o Wyscout escreve-a à data do export, por isso quem
 * faz anos entre duas importações passava a ser um jogador novo (143 duplicados
 * no CP 26/27 à J8). A idade serve só para separar homónimos — ver
 * `agesCompatible` e `PlayerMatcher`.
 *
 * Vive num ficheiro só e é usada pelo parser (duplicados dentro do ficheiro) e
 * pela rota de import (jogadores já existentes na pool). As duas têm de usar
 * exactamente a mesma regra — a correcção de 11/11/2026 perdeu-se uma vez por
 * estar escrita inline na rota.
 *
 * Altura 0 e altura vazia contam como iguais: o Wyscout escreve 0 quando não
 * tem o dado. Pé "unknown" conta como vazio pela mesma razão.
 *
 * A chave exacta não chega: o Wyscout completa fichas entre exports (preenche
 * a altura, troca o pé de "unknown" para "direito") e, mais raramente, muda a
 * equipa do período. Ao carregar a jornada 4 do CP 26/27 sobre a pool da
 * jornada 8, 5 jogadores em 1080 falharam a chave por isso. `PlayerMatcher`
 * faz uma segunda tentativa, mais larga e só com candidato único — ver
 * `claimLoose`.
 */
export function playerKey(
  name: string,
  team: string | null | undefined,
  height: unknown,
  foot: unknown
): string {
  return [normText(name), normText(team), heightPart(height), footPart(foot)].join('::');
}

function normText(v: unknown): string {
  return v == null ? '' : String(v).trim().toLowerCase();
}

function heightPart(height: unknown): string {
  const h = Number(height);
  return Number.isFinite(h) && h > 0 ? String(Math.round(h)) : '';
}

function footPart(foot: unknown): string {
  const f = normText(foot);
  return f === 'unknown' ? '' : f;
}

/** Equipa que entra na chave: a do período, e o clube de inscrição só como recurso. */
export function periodTeam(teamInPeriod: unknown, currentTeam: unknown): string {
  const clean = (v: unknown) => (v == null ? '' : String(v).trim());
  return clean(teamInPeriod) || clean(currentTeam);
}

function toAge(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Duas idades podem ser da mesma pessoa? Sim se diferirem no máximo um ano (o
 * aniversário entre dois exports) ou se faltar uma delas. Dois "Paulinho" no
 * mesmo clube, com a mesma altura e o mesmo pé, de 34 e 28 anos, são duas
 * pessoas — sem esta regra uma reimportação fundia-os numa linha só.
 */
export function agesCompatible(a: unknown, b: unknown): boolean {
  const x = toAge(a);
  const y = toAge(b);
  if (x === null || y === null) return true;
  return Math.abs(x - y) <= 1;
}

/** Os campos de um jogador que servem para o reconhecer, tal como vêm da base de dados ou do ficheiro. */
export type PlayerKeyFields = {
  name?: unknown;
  team_in_period?: unknown;
  current_team?: unknown;
  height_cm?: unknown;
  foot?: unknown;
  age?: unknown;
};

type Entry<T> = {
  value: T;
  claimed: boolean;
  key: string;
  name: string;
  team: string;
  clubs: string[];
  height: string;
  foot: string;
  age: number | null;
};

function describe(f: PlayerKeyFields) {
  const name = normText(f.name);
  const team = normText(periodTeam(f.team_in_period, f.current_team));
  const height = heightPart(f.height_cm);
  const foot = footPart(f.foot);
  return {
    key: [name, team, height, foot].join('::'),
    name,
    team,
    // Equipa do período e clube de inscrição: qualquer uma liga o jogador a um clube.
    clubs: Array.from(new Set([team, normText(f.current_team)].filter(Boolean))),
    height,
    foot,
    age: toAge(f.age),
  };
}

/** Iguais, ou um dos lados vazio (o Wyscout ainda não tinha o dado). */
function fillsIn(a: string, b: string): boolean {
  return a === b || a === '' || b === '';
}

/**
 * Índice de jogadores que sabe distinguir homónimos pela idade e nunca entrega
 * o mesmo registo a duas linhas do ficheiro.
 *
 * Usar em duas passagens: primeiro `claim` para TODAS as linhas, só depois
 * `claimLoose` para as que sobraram. Assim a tentativa larga nunca tira a uma
 * linha o registo que lhe corresponde exactamente.
 */
export class PlayerMatcher<T> {
  private byKey = new Map<string, Entry<T>[]>();
  private byName = new Map<string, Entry<T>[]>();

  add(fields: PlayerKeyFields, value: T): void {
    const entry: Entry<T> = { value, claimed: false, ...describe(fields) };
    const push = (map: Map<string, Entry<T>[]>, k: string) => {
      const list = map.get(k);
      if (list) list.push(entry);
      else map.set(k, [entry]);
    };
    push(this.byKey, entry.key);
    push(this.byName, entry.name);
  }

  /** Chave exacta e idade compatível (o de idade mais próxima); fica reservado. */
  claim(fields: PlayerKeyFields): T | undefined {
    const wanted = describe(fields);
    let best: Entry<T> | undefined;
    let bestGap = Infinity;
    for (const entry of this.byKey.get(wanted.key) ?? []) {
      if (entry.claimed || !agesCompatible(entry.age, wanted.age)) continue;
      const gap = entry.age === null || wanted.age === null ? 0.5 : Math.abs(entry.age - wanted.age);
      if (gap < bestGap) {
        best = entry;
        bestGap = gap;
      }
    }
    if (best) best.claimed = true;
    return best?.value;
  }

  /**
   * Segunda tentativa, para quando o Wyscout mudou um dado entre exports.
   * Mesmo nome, idade compatível e uma destas:
   *  - mesma equipa, e a altura e o pé só diferem por um dos lados estar vazio;
   *  - mesma altura e mesmo pé, e os dois partilham um clube (equipa do
   *    período ou clube de inscrição).
   * Só liga com exactamente um candidato livre: na dúvida não liga.
   */
  claimLoose(fields: PlayerKeyFields): T | undefined {
    const wanted = describe(fields);
    if (!wanted.name) return undefined;
    const candidates = (this.byName.get(wanted.name) ?? []).filter((entry) => {
      if (entry.claimed || !agesCompatible(entry.age, wanted.age)) return false;
      const sameTeam = entry.team !== '' && entry.team === wanted.team;
      if (sameTeam) return fillsIn(entry.height, wanted.height) && fillsIn(entry.foot, wanted.foot);
      const sharesClub = entry.clubs.some((c) => wanted.clubs.includes(c));
      return sharesClub && entry.height === wanted.height && entry.foot === wanted.foot;
    });
    if (candidates.length !== 1) return undefined;
    candidates[0].claimed = true;
    return candidates[0].value;
  }
}
