-- =========================================================
-- 26 — Grupos do WhatsApp: imagem ou vídeo nos envios programados (05/11/2026)
--
-- Pedido do Jimmy: anexar uma imagem ou um vídeo ao envio, com a mensagem como legenda
-- e o "mencionar todos" valendo junto.
--
--   grupo_envios.midia_*   o arquivo do envio (bucket grupos-midia, pasta envios/)
--   grupo_envios.pendentes os grupos que ainda faltam na vez atual: um vídeo para muitos
--                          grupos não cabe numa chamada só, e a próxima chamada continua
--                          de onde parou em vez de mandar de novo para os primeiros
--   grupo_envios.ocorrencia_em  quando a vez atual começou (junta os erros dela)
--
-- O bucket é público (a Evolution baixa o arquivo pelo link) com nomes aleatórios; quem
-- cria o link de envio é a função `grupos`, só com o login do painel. Só JPEG (o painel
-- converte qualquer imagem) e MP4, até 50 MB.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.grupo_envios
  add column if not exists midia_path    text,
  add column if not exists midia_tipo    text,
  add column if not exists midia_nome    text,
  add column if not exists midia_bytes   bigint,
  add column if not exists pendentes     text[],
  add column if not exists ocorrencia_em timestamptz;

-- com mídia, a legenda pode ficar vazia
alter table public.grupo_envios drop constraint if exists grupo_envios_texto_check;
alter table public.grupo_envios add constraint grupo_envios_texto_check
  check (length(texto) <= 4096 and (length(texto) >= 1 or midia_path is not null));

alter table public.grupo_envios drop constraint if exists grupo_envios_midia_check;
alter table public.grupo_envios add constraint grupo_envios_midia_check
  check ((midia_path is null) = (midia_tipo is null)
         and (midia_tipo is null or midia_tipo in ('imagem', 'video'))
         and (midia_path is null or midia_path ~ '^envios/[0-9a-f-]{36}\.(jpg|mp4)$'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('grupos-midia', 'grupos-midia', true, 52428800, array['image/jpeg', 'video/mp4'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
