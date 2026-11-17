-- Pesquisa de equipas pelo nome, uma linha por equipa e pool.
-- Aplicado ao projecto a 17/11/2026 (migração search_teams_function).
-- Substitui a leitura dos primeiros 200 jogadores, que deixava épocas de fora.
-- A equipa é o team_in_period; current_team só quando o primeiro não existe.
create or replace function public.search_teams(q text)
returns table (team text, pool_id uuid)
language sql
stable
set search_path = public
as $$
  select distinct t.team, t.pool_id
  from (
    select btrim(coalesce(p.team_in_period, p.current_team)) as team, p.pool_id
    from public.players p
    where length(btrim(q)) >= 2
      and (
        p.team_in_period ilike '%' || btrim(q) || '%'
        or (p.team_in_period is null and p.current_team ilike '%' || btrim(q) || '%')
      )
  ) t
  where t.team <> ''
$$;

-- Só as rotas /api, com a chave de serviço, a podem chamar.
revoke all on function public.search_teams(text) from public, anon, authenticated;
grant execute on function public.search_teams(text) to service_role;
