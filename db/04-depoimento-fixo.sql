-- =========================================================
-- A NOVA PROFISSÃO — depoimento sempre visível
--
-- Marca o depoimento que não entra no sorteio: ele aparece
-- sempre, e o rodízio preenche as vagas restantes.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- =========================================================

alter table public.depoimentos add column if not exists fixo boolean not null default false;

notify pgrst, 'reload schema';
