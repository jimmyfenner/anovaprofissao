-- =========================================================
-- A NOVA PROFISSÃO — painel dos licenciados (nov/2026)
--
-- anovaprofissao.com.br/painel: cada licenciado com espelho (tabela
-- licenciados) entra com um código de 6 dígitos mandado ao WhatsApp
-- cadastrado dele e vê só os leads da página dele. O Jimmy entra com o
-- número dele e pode ver o painel de qualquer licenciado.
--
--   painel_config   qual instância da Evolution manda os códigos (uma linha)
--   acessos_painel  cada código pedido: só o hash, 10 min, 5 tentativas
--   sessoes_painel  sessões de 30 dias: só o hash do token
--
-- Tudo fechado para o navegador: quem lê e grava é a Edge Function `painel`
-- (service role), que também atende o /admin (login do Jimmy) para escolher
-- a instância e ligar/desligar o acesso de cada licenciado.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.licenciados
  add column if not exists painel_ativo         boolean not null default true,
  add column if not exists ultimo_acesso_painel timestamptz;

create table if not exists public.painel_config (
  id                int primary key default 1 check (id = 1),
  instancia_codigos text check (instancia_codigos is null or length(instancia_codigos) between 1 and 80),
  atualizado_em     timestamptz not null default now()
);
-- pedido do Jimmy (04/11/2026): os códigos saem do número dele final 1575 (instância "1575")
insert into public.painel_config (id, instancia_codigos) values (1, '1575') on conflict (id) do nothing;

create table if not exists public.acessos_painel (
  id          uuid primary key,
  criado_em   timestamptz not null default now(),
  whatsapp    text not null,
  codigo_hash text not null,
  expira_em   timestamptz not null,
  tentativas  int not null default 0,
  usado_em    timestamptz,
  envio_ok    boolean,
  envio_erro  text check (coalesce(length(envio_erro), 0) <= 300)
);
create index if not exists acessos_painel_whatsapp_idx on public.acessos_painel (whatsapp, criado_em desc);

create table if not exists public.sessoes_painel (
  id           uuid primary key default gen_random_uuid(),
  criado_em    timestamptz not null default now(),
  whatsapp     text not null,
  token_hash   text not null unique,
  expira_em    timestamptz not null,
  ultimo_uso   timestamptz,
  encerrada_em timestamptz
);
create index if not exists sessoes_painel_whatsapp_idx on public.sessoes_painel (whatsapp);

alter table public.painel_config  enable row level security;
alter table public.acessos_painel enable row level security;
alter table public.sessoes_painel enable row level security;
revoke all on public.painel_config, public.acessos_painel, public.sessoes_painel from anon, authenticated;

notify pgrst, 'reload schema';
