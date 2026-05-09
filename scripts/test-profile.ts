/**
 * Script de validação do scorer contra dados reais.
 *
 * Uso:
 *   npx tsx scripts/test-profile.ts [pool_id]
 *
 * Se não passares pool_id, corre no pool da Liga 3 (hardcoded abaixo — ajusta ao teu).
 *
 * Imprime no terminal:
 *   - Top 20 jogadores pelo perfil 'Extremo desequilibrador'
 *   - Bottom 5 (sanity check)
 *   - Breakdown detalhado do #1 (explicabilidade)
 *   - Warnings (amostras pequenas, etc.)
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { scoreProfile, type PlayerInput, type StatInput } from '../src/lib/scouting/scorer';
import type { ScoutingProfile } from '../src/lib/scouting/profile-types';

// ── Perfil-semente: Extremo desequilibrador 1v1 ─────────────────────────
const PROFILE: ScoutingProfile = {
  name: 'Extremo desequilibrador 1v1',
  description: 'Extremo que cria rupturas no corredor, ganha o 1v1 e finaliza.',
  filters: {
    positions: ['LW', 'RW', 'LWF', 'RWF'],
    min_minutes: 500, // ~6 jogos completos
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

// ── Ler .env.local ──────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const lines = text.split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Supabase env vars em falta em .env.local');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ── Descobrir pool ────────────────────────────────────────────────────
  const poolIdArg = process.argv[2];
  let poolId = poolIdArg;
  if (!poolId) {
    const { data: pools } = await supabase
      .from('pools')
      .select('id, name, season')
      .order('created_at', { ascending: false });
    console.log('\nPools disponíveis:');
    pools?.forEach((p) => console.log(`  ${p.id}  ${p.name}  (${p.season})`));
    if (!pools || pools.length === 0) {
      console.error('Sem pools na base.');
      process.exit(1);
    }
    poolId = pools[0].id;
    console.log(`\nA usar a mais recente: ${poolId}\n`);
  }

  // ── Buscar players + stats + directions ──────────────────────────────
  // Players — paginado (mesmo padrão das stats abaixo) para evitar o limite
  // implícito de 1000 do PostgREST em pools grandes.
  const players: PlayerInput[] = [];
  const PLAYERS_PAGE = 1000;
  let playersFrom = 0;
  while (true) {
    const { data: page, error: playersErr } = await supabase
      .from('players')
      .select(
        'id, name, current_team, position_primary, age, minutes_played, contract_until, market_value_eur, on_loan'
      )
      .eq('pool_id', poolId)
      .range(playersFrom, playersFrom + PLAYERS_PAGE - 1);
    if (playersErr) throw playersErr;
    if (!page || page.length === 0) break;
    players.push(...(page as PlayerInput[]));
    if (page.length < PLAYERS_PAGE) break;
    playersFrom += PLAYERS_PAGE;
  }

  // Stats: inner join com pools via players, paginado
  const stats: StatInput[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data: page, error: statsErr } = await supabase
      .from('player_stats')
      .select('player_id, metric_code, metric_value, players!inner(pool_id)')
      .eq('players.pool_id', poolId)
      .range(from, from + PAGE - 1);
    if (statsErr) throw statsErr;
    if (!page || page.length === 0) break;
    // O join mete um campo aninhado 'players' que não queremos — limpamos
    for (const row of page) {
      stats.push({
        player_id: (row as { player_id: string }).player_id,
        metric_code: (row as { metric_code: string }).metric_code,
        metric_value: (row as { metric_value: number | null }).metric_value,
      });
    }
    if (page.length < PAGE) break;
    from += PAGE;
  }

  // Directions
  const { data: metricsData, error: metricsErr } = await supabase
    .from('metrics')
    .select('code, direction');
  if (metricsErr) throw metricsErr;
  const directions: Record<string, 'higher' | 'lower'> = {};
  for (const m of metricsData ?? []) {
    if (m.direction === 'higher' || m.direction === 'lower') directions[m.code] = m.direction;
  }

  console.log(`Pool carregado: ${players.length} jogadores, ${stats.length} stats`);

  // ── Correr o scorer ───────────────────────────────────────────────────
  const result = scoreProfile({
    pool_id: poolId,
    profile: PROFILE,
    players,
    stats,
    metric_directions: directions,
  });

  // ── Imprimir ──────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  PERFIL: ${PROFILE.name}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Pool:                   ${poolId}`);
  console.log(`Jogadores no pool:      ${result.total_players_in_pool}`);
  console.log(`Peer group (percentis): ${result.peer_group_size}`);
  console.log(`Elegíveis (filtros):    ${result.eligible_count}`);
  if (result.warnings.length) {
    console.log('\nWarnings:');
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  console.log('\n━━━ TOP 20 ━━━');
  console.log(
    '  #   SCORE  NOME                          EQUIPA                   POS  IDADE  MIN    CONTRATO    VALOR'
  );
  result.ranked.slice(0, 20).forEach((p, i) => {
    console.log(
      `  ${String(i + 1).padStart(2)}  ${p.score.toFixed(1).padStart(5)}  ${(p.name ?? '').slice(0, 28).padEnd(28)}  ${(p.current_team ?? '-').slice(0, 22).padEnd(22)}  ${(p.position_primary ?? '?').padEnd(4)} ${String(p.age ?? '-').padStart(3)}   ${String(p.minutes_played ?? '-').padStart(5)}  ${p.contract_until ?? '-'}  ${p.market_value_eur ? '€' + p.market_value_eur.toLocaleString() : '-'}`
    );
  });

  console.log('\n━━━ BOTTOM 5 (sanity) ━━━');
  result.ranked.slice(-5).forEach((p) => {
    console.log(
      `  ${p.score.toFixed(1).padStart(5)}  ${(p.name ?? '').padEnd(25)}  ${(p.current_team ?? '-').padEnd(20)}  ${p.position_primary}`
    );
  });

  // Breakdown do #1
  if (result.ranked.length > 0) {
    const top = result.ranked[0];
    console.log('\n━━━ BREAKDOWN DO #1 ━━━');
    console.log(`${top.name} (${top.current_team}) — score ${top.score}`);
    console.log('  métrica                          valor      percentil  peso  contribui');
    top.contributions.forEach((c) => {
      console.log(
        `  ${c.metric_code.padEnd(32)} ${String(c.raw_value ?? 'null').padStart(8)}   ${c.percentile.toFixed(1).padStart(5)}      ${String(c.weight).padStart(3)}%  ${c.contribution.toFixed(2).padStart(5)}`
      );
    });
    if (top.missing_metrics.length) {
      console.log(`  Missing metrics: ${top.missing_metrics.join(', ')}`);
    }
  }

  // Estatísticas globais úteis
  console.log('\n━━━ DISTRIBUIÇÃO DE SCORES ━━━');
  const scores = result.ranked.map((p) => p.score);
  const mean = scores.reduce((s, x) => s + x, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const median = scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  console.log(`  Min:    ${min.toFixed(1)}`);
  console.log(`  Mediana: ${median.toFixed(1)}`);
  console.log(`  Média:  ${mean.toFixed(1)}`);
  console.log(`  Max:    ${max.toFixed(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});