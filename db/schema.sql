-- ============================================================
-- A Nova Profissão — base de leads
-- Cole este arquivo inteiro no SQL Editor do Supabase e rode.
-- ============================================================

create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  criado_em      timestamptz not null default now(),

  -- identificação
  nome           text not null,
  whatsapp       text not null,
  whatsapp_e164  text,                  -- só dígitos, pronto pro wa.me
  cidade         text,
  uf             text,

  -- respostas do quiz
  objetivo       text,
  tempo          text,
  experiencia    text,
  solucao        text,
  perfil         text,

  -- origem
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  utm_term       text,
  landing        text,
  referrer       text,
  device         text,

  -- acompanhamento comercial
  status         text not null default 'novo'
                 check (status in ('novo','contatado','em_conversa','ganho','sem_retorno','descartado')),
  anotacoes      text,
  contatado_em   timestamptz,
  atualizado_em  timestamptz not null default now()
);

create index if not exists leads_criado_em_idx on public.leads (criado_em desc);
create index if not exists leads_status_idx    on public.leads (status);
create index if not exists leads_origem_idx    on public.leads (utm_source);

-- atualiza o carimbo sempre que a linha muda
create or replace function public.touch_leads() returns trigger
language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end $$;

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_leads();

-- ============================================================
-- Segurança: o site público NÃO lê e NÃO escreve direto.
-- A gravação passa pela Edge Function (service_role, ignora RLS).
-- A leitura exige login no painel.
-- ============================================================
alter table public.leads enable row level security;

drop policy if exists "painel le os leads"      on public.leads;
drop policy if exists "painel atualiza os leads" on public.leads;

create policy "painel le os leads"
  on public.leads for select
  to authenticated using (true);

create policy "painel atualiza os leads"
  on public.leads for update
  to authenticated using (true) with check (true);

-- anon não recebe nenhuma policy: sem leitura, sem escrita.
revoke all on public.leads from anon;
