-- =========================================================
-- A NOVA PROFISSÃO — base de leads
--
-- Cole este arquivo INTEIRO no SQL Editor do Supabase e rode.
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  criado_em      timestamptz not null default now(),

  nome           text not null,
  whatsapp       text not null,
  whatsapp_e164  text,
  cidade         text,
  uf             text,

  objetivo       text,
  tempo          text,
  experiencia    text,
  solucao        text,
  perfil         text,

  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  utm_term       text,
  landing        text,
  referrer       text,
  device         text,

  status         text not null default 'novo'
                 check (status in ('novo','contatado','em_conversa','ganho','sem_retorno','descartado')),
  anotacoes      text,
  contatado_em   timestamptz,
  atualizado_em  timestamptz not null default now(),

  constraint nome_preenchido     check (length(trim(nome)) between 2 and 120),
  constraint whatsapp_preenchido check (length(trim(whatsapp)) between 8 and 40)
);

create index if not exists leads_criado_em_idx on public.leads (criado_em desc);
create index if not exists leads_status_idx    on public.leads (status);
create index if not exists leads_origem_idx    on public.leads (utm_source);

create or replace function public.touch_leads() returns trigger
language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_leads();

-- =========================================================
-- SEGURANÇA
-- O site público só GRAVA, e só nas colunas do formulário.
-- Não lê a base, não altera status, não mexe em anotações.
-- Ler e editar exigem login no painel (/admin).
-- =========================================================

alter table public.leads enable row level security;

drop policy if exists "site grava lead"       on public.leads;
drop policy if exists "painel le os leads"    on public.leads;
drop policy if exists "painel edita os leads" on public.leads;
drop policy if exists "painel atualiza os leads" on public.leads;

create policy "site grava lead"
  on public.leads for insert
  to anon with check (true);

create policy "painel le os leads"
  on public.leads for select
  to authenticated using (true);

create policy "painel edita os leads"
  on public.leads for update
  to authenticated using (true) with check (true);

revoke all on public.leads from anon, authenticated;

grant insert (nome, whatsapp, whatsapp_e164, cidade, uf,
              objetivo, tempo, experiencia, solucao, perfil,
              utm_source, utm_medium, utm_campaign, utm_content, utm_term,
              landing, referrer, device)
  on public.leads to anon;

grant select, update on public.leads to authenticated;
