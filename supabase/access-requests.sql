-- Pedidos de acesso feitos na página pública "Pedir acesso".
-- Aplicado ao projecto a 17/11/2026 (migração access_requests).
-- Um por email. O administrador aprova ou recusa dentro do produto.
create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  role text,
  club text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);
create index access_requests_status_idx on public.access_requests (status, created_at desc);

-- RLS ligado e sem políticas: só as rotas /api, com a chave de serviço.
alter table public.access_requests enable row level security;

-- Marca de aprovação na própria conta, para o servidor a verificar em cada
-- pedido sem ir à base de dados. Quem já tinha acesso ficou marcado.
update auth.users u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"approved": true}'::jsonb
where lower(u.email) in (select lower(email) from public.allowed_users);
