-- 22 · Diário de reuniões: link da conversa do lead no iGreen Turbo (nov/2026)
--
-- Pedido do Jimmy em 04/11/2026: no lugar do "sem telefone" do /reunioes, poder pôr o
-- telefone e o link da conversa no Turbo (igreenturbo.com.br/app/inbox?contact=<id>).
-- O assistente do Mac também preenche sozinho quando a reunião veio de um evento que o
-- Turbo criou (a descrição do evento traz esse link). Quem valida o endereço é a função
-- "reunioes"; a coluna só aceita link do Turbo, por garantia.
-- Idempotente: pode rodar de novo.

alter table public.reunioes_leads add column if not exists turbo_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reunioes_leads_turbo_url_check') then
    alter table public.reunioes_leads add constraint reunioes_leads_turbo_url_check
      check (turbo_url is null or turbo_url ~ '^https://igreenturbo\.com\.br/[^[:space:]]{1,500}$');
  end if;
end $$;

comment on column public.reunioes_leads.turbo_url is
  'Link da conversa com o lead no iGreen Turbo (https://igreenturbo.com.br/app/inbox?contact=<id>).';
