-- 22 · Diário de reuniões: link da conversa do lead no iGreen Turbo (nov/2026)
--
-- Pedido do Jimmy em 04/11/2026: no lugar do "sem telefone" do /reunioes, poder pôr o
-- telefone e o link da conversa no Turbo (igreenturbo.com.br/app/inbox?contact=<id>).
-- O assistente do Mac também preenche sozinho quando a reunião veio de um evento que o
-- Turbo criou (a descrição do evento traz esse link). Quem valida o endereço é a função
-- "reunioes"; a coluna só aceita link do Turbo, por garantia.
-- Idempotente: pode rodar de novo.

alter table public.reunioes_leads add column if not exists turbo_url text;

-- {1,500} não serve: o Postgres só aceita repetição até 255, e o erro só aparece ao gravar.
-- Por isso o tamanho vai à parte. Idempotente: troca a checagem antiga, se existir.
alter table public.reunioes_leads drop constraint if exists reunioes_leads_turbo_url_check;
alter table public.reunioes_leads add constraint reunioes_leads_turbo_url_check
  check (turbo_url is null or (turbo_url ~ '^https://igreenturbo\.com\.br/[^[:space:]]+$' and char_length(turbo_url) <= 520));

comment on column public.reunioes_leads.turbo_url is
  'Link da conversa com o lead no iGreen Turbo (https://igreenturbo.com.br/app/inbox?contact=<id>).';
