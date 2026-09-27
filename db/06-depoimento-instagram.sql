-- =========================================================
-- A NOVA PROFISSÃO — Instagram no depoimento
--
-- Guarda o perfil da pessoa e se ele deve aparecer. O link
-- só é exibido quando os dois estiverem preenchidos/ligados.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- =========================================================

alter table public.depoimentos add column if not exists instagram         text;
alter table public.depoimentos add column if not exists instagram_mostrar boolean not null default true;

notify pgrst, 'reload schema';
