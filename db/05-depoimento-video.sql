-- =========================================================
-- A NOVA PROFISSÃO — depoimento em vídeo
--
-- Depoimento pode ter um vídeo (Vimeo ou YouTube) além do texto.
-- O site mostra a miniatura com o play dentro do card e abre no
-- mesmo player usado pelos outros vídeos da página.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- =========================================================

alter table public.depoimentos add column if not exists video_url     text;
alter table public.depoimentos add column if not exists video_formato text;

notify pgrst, 'reload schema';
