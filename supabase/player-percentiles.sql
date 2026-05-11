-- ─────────────────────────────────────────────────────────────────────
-- player_percentiles — percentis pré-calculados por (pool, posição, métrica)
-- Correr manualmente no Supabase Dashboard SQL Editor.
--
-- Populada por src/lib/similarity/recalculate.ts (TS). Chamada:
--   - Automática no fim de POST /api/import/wyscout
--   - Manual via POST /api/admin/recalculate-percentiles?pool_id=X
--
-- Naming: metric_code (consistente com player_stats, metrics, scouting_profiles).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE player_percentiles (
  pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  position TEXT NOT NULL,
  metric_code TEXT NOT NULL REFERENCES metrics(code) ON DELETE CASCADE,
  raw_value NUMERIC,
  percentile NUMERIC NOT NULL,
  PRIMARY KEY (pool_id, player_id, position, metric_code)
);

CREATE INDEX idx_pp_pool_pos ON player_percentiles(pool_id, position);
CREATE INDEX idx_pp_player ON player_percentiles(player_id);
