-- =========================================================
-- A NOVA PROFISSÃO — quanto da apresentação o lead assistiu
--
-- A página de integradores (querovendercarregador.com.br) mede quantos
-- segundos da apresentação em vídeo a pessoa realmente tocou (pular para o
-- fim não conta) e manda a porcentagem junto com o formulário.
--
--   video_pct = 0 a 100; 90 ou mais aparece como "assistiu completo"
--   null      = sem medição (lead antigo ou player bloqueado)
--
-- Enquanto esta migração não rodar, a página grava o lead sem a coluna,
-- então ninguém se perde.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode rodar mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.leads
  add column if not exists video_pct smallint
  check (video_pct is null or (video_pct between 0 and 100));

grant insert (video_pct) on public.leads to anon;
grant select (video_pct) on public.leads to authenticated;
