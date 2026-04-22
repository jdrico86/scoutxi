import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';

/**
 * GET /api/metrics
 * Lista todas as métricas disponíveis, ordenadas por categoria + label.
 * Usado pelo editor de perfis para mostrar opções agrupadas.
 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Env vars em falta.' }, { status: 500 });

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('metrics')
    .select('code, category, label_pt, direction, unit')
    .order('category')
    .order('label_pt');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ metrics: data ?? [] });
}