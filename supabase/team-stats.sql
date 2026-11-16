-- Estatísticas de equipa por jogo (ficheiros "Team Stats" do Wyscout).
-- Aplicado ao projecto a 16/11/2026 (migração team_match_stats).
-- Uma linha por equipa e por jogo; o adversário tem a sua própria linha.
create table public.team_match_stats (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.pools(id) on delete cascade,
  match_date date not null,
  match_label text not null,
  team text not null,
  opponent text not null,
  duration integer,
  scheme text,
  stats jsonb not null,
  created_at timestamptz not null default now(),
  constraint team_match_stats_unique unique (pool_id, match_date, team, opponent)
);
create index team_match_stats_pool_idx on public.team_match_stats (pool_id);

-- Uma linha por pool: até que jornada vão os dados importados.
create table public.team_stats_meta (
  pool_id uuid primary key references public.pools(id) on delete cascade,
  round_label text,
  updated_at timestamptz not null default now()
);

-- Como nas restantes tabelas: RLS ligado e sem políticas; o acesso é feito
-- pelas rotas /api com a chave de serviço.
alter table public.team_match_stats enable row level security;
alter table public.team_stats_meta enable row level security;
