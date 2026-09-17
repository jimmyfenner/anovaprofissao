-- =========================================================
-- A NOVA PROFISSÃO — permitir excluir lead pelo painel
--
-- Necessário para atender pedido de exclusão (LGPD) e para
-- limpar registros de teste. Só quem está logado no painel
-- apaga; o site público continua apenas gravando.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- =========================================================

drop policy if exists "painel apaga os leads" on public.leads;
create policy "painel apaga os leads"
  on public.leads for delete
  to authenticated using (true);

grant delete on public.leads to authenticated;

notify pgrst, 'reload schema';
