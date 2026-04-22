/**
 * Seed dos perfis-semente na tabela `scouting_profiles`.
 *
 * Uso:
 *   npx tsx scripts/seed-profiles.ts
 *
 * Idempotente: procura por `name` antes de inserir. Se já existe, faz UPDATE
 * dos filtros/pesos (útil para iterar nos perfis).
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { SEED_PROFILES } from '../src/lib/scouting/seed-profiles';
import type { Database, Json } from '../src/lib/supabase/database.types';

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Env vars em falta. Preciso de NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  console.log(`A preparar ${SEED_PROFILES.length} perfis-semente...`);

  let created = 0;
  let updated = 0;
  for (const p of SEED_PROFILES) {
    const { data: existing, error: selErr } = await supabase
      .from('scouting_profiles')
      .select('id')
      .eq('name', p.name)
      .maybeSingle();
    if (selErr) {
      console.error(`Erro a procurar "${p.name}":`, selErr.message);
      continue;
    }

    const payload = {
      name: p.name,
      description: p.description ?? null,
      filters: p.filters as unknown as Json,
      weights: { entries: p.weights, peer_group_positions: p.peer_group_positions ?? [] } as unknown as Json,
      tags: ['seed'],
    };

    if (existing?.id) {
      const { error } = await supabase
        .from('scouting_profiles')
        .update(payload)
        .eq('id', existing.id);
      if (error) {
        console.error(`✗ Falha a actualizar "${p.name}": ${error.message}`);
      } else {
        console.log(`↻ ${p.name} actualizado`);
        updated++;
      }
    } else {
      const { error } = await supabase.from('scouting_profiles').insert(payload);
      if (error) {
        console.error(`✗ Falha a criar "${p.name}": ${error.message}`);
      } else {
        console.log(`+ ${p.name} criado`);
        created++;
      }
    }
  }

  console.log(`\nConcluído: ${created} criados, ${updated} actualizados.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});