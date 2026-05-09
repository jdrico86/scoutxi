-- ─────────────────────────────────────────────────────────────────────
-- Equipas-Sombra (Squad Builder)
-- Correr manualmente no Supabase Dashboard SQL Editor.
-- Padrão de ownership igual a `shortlists`: apenas `owner_id`, sem RLS.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE squads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  formation TEXT NOT NULL DEFAULT '4-3-3'
    CHECK (formation IN ('4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_squads_owner_id ON squads(owner_id);

CREATE TABLE squad_players (
  squad_id UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot TEXT,
  is_starter BOOLEAN NOT NULL DEFAULT false,
  squad_note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (squad_id, player_id)
);

CREATE INDEX idx_squad_players_squad_id ON squad_players(squad_id);

CREATE OR REPLACE FUNCTION update_squads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER squads_updated_at
  BEFORE UPDATE ON squads
  FOR EACH ROW
  EXECUTE FUNCTION update_squads_updated_at();
