-- 29 · Diário de reuniões: pedidos de short feitos no painel (nov/2026)
--
-- Pedido do Jimmy em 12/11/2026: "quero dar o comando de gerar os shorts no próprio painel das
-- reuniões". Na aba Shorts do /reunioes ele escolhe os trechos marcados pela rotina do diário
-- (reunioes.momentos, migração 28) e aperta "Gerar short". O pedido entra aqui; a rotina
-- "shorts-do-painel" do Mac (studio/tools/shorts-painel) pega, baixa as gravações, monta o vídeo
-- no pipeline dos shorts 021/026, sobe a prévia no bucket abaixo e devolve para o painel.
-- Ele revisa: aprova (com o texto da publicação e os destinos) ou pede ajuste. Aprovado e com o
-- ok de todos os clientes que aparecem (reunioes_leads.short_ok = 'sim'), o Mac publica.
--
--   status       fila → montando → pronto → aprovado → publicando → publicado
--                pronto → ajustar → montando (nova versão)   ·   montando/publicando → erro
--                qualquer um antes de publicar → descartado
--   trechos      cópia dos trechos escolhidos no momento do pedido (regras em
--                supabase/functions/_shared/shorts.mjs): editar a reunião depois não muda o pedido
--   video        caminho da prévia no bucket reunioes-shorts (<id>/v<versao>.mp4), privado
--   publicacao   {titulo, descricao, legenda}: o Mac propõe, o Jimmy revisa no painel antes de aprovar
--   destinos     {youtube, instagram}
--   avisado      último aviso mandado no WhatsApp (1575) pelo assistente do Mac, ex. "pronto:2"
-- RLS ligada e nenhuma policy, como as outras tabelas reunioes_*: só a função "reunioes" mexe.
-- Idempotente: pode rodar de novo.

create table if not exists public.reunioes_shorts (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  status        text not null default 'fila',
  status_em     timestamptz not null default now(),
  trechos       jsonb not null,
  titulo        text,
  pedido        text,
  ajuste        text,
  versao        integer not null default 0,
  video         text,
  duracao       numeric,
  roteiro       jsonb,
  publicacao    jsonb,
  destinos      jsonb,
  aprovado_em   timestamptz,
  publicado     jsonb,
  erro          text,
  avisado       text
);

alter table public.reunioes_shorts drop constraint if exists reunioes_shorts_status_check;
alter table public.reunioes_shorts add constraint reunioes_shorts_status_check
  check (status in ('fila', 'montando', 'pronto', 'ajustar', 'aprovado', 'publicando', 'publicado', 'erro', 'descartado'));
alter table public.reunioes_shorts drop constraint if exists reunioes_shorts_trechos_check;
alter table public.reunioes_shorts add constraint reunioes_shorts_trechos_check
  check (jsonb_typeof(trechos) = 'array' and jsonb_array_length(trechos) between 1 and 12);
alter table public.reunioes_shorts drop constraint if exists reunioes_shorts_textos_check;
alter table public.reunioes_shorts add constraint reunioes_shorts_textos_check
  check (coalesce(length(titulo), 0) <= 160 and coalesce(length(pedido), 0) <= 1000
         and coalesce(length(ajuste), 0) <= 1000 and coalesce(length(erro), 0) <= 1000);
alter table public.reunioes_shorts drop constraint if exists reunioes_shorts_video_check;
alter table public.reunioes_shorts add constraint reunioes_shorts_video_check
  check (video is null or video ~ '^[0-9a-f-]{36}/v[0-9]{1,3}\.mp4$');

create index if not exists reunioes_shorts_status_idx on public.reunioes_shorts (status, criado_em);
alter table public.reunioes_shorts enable row level security;

comment on table public.reunioes_shorts is
  'Pedidos de short feitos no painel /reunioes; quem monta e publica é a rotina shorts-do-painel do Mac.';

-- prévia para revisar no painel: privada (link assinado de 2 h), até 50 MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reunioes-shorts', 'reunioes-shorts', false, 52428800, array['video/mp4'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
