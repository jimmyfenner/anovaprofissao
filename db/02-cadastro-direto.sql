-- =========================================================
-- A NOVA PROFISSÃO — caminho do cadastro direto
--
-- Quem já chega decidido não faz o quiz: deixa nome, e-mail e
-- WhatsApp e segue para o cadastro oficial da iGreen.
-- Este lead precisa de duas coisas que a tabela ainda não tinha:
-- uma coluna de e-mail e uma marca dizendo de onde ele veio.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode rodar mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.leads add column if not exists email text;
alter table public.leads add column if not exists tipo  text not null default 'quiz';

do $$
begin
  alter table public.leads
    add constraint leads_tipo_check check (tipo in ('quiz', 'direto'));
exception
  when duplicate_object then null;
end $$;

create index if not exists leads_tipo_idx on public.leads (tipo);

-- o site continua só gravando, agora também nessas duas colunas
grant insert (email, tipo) on public.leads to anon;
