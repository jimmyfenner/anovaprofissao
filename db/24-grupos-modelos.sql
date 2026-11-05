-- =========================================================
-- Grupos do WhatsApp (nov/2026): modelo de IA por tarefa e triagem a cada 10 min.
--   modelo_triagem  lê as mensagens e marca instrução nova / precisa de você
--   modelo_resumo   resumo do dia e aba Perguntar
-- "claude-*" vai direto à API da Anthropic (ANTHROPIC_API_KEY); outro nome, à OpenRouter.
-- Começa no que já estava (Gemini pela OpenRouter); trocar só depois do teste de qualidade.
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================
alter table public.grupos_config add column if not exists modelo_triagem text not null default 'google/gemini-2.5-flash';
alter table public.grupos_config add column if not exists modelo_resumo  text not null default 'google/gemini-2.5-flash';
alter table public.grupos_config add column if not exists triagem_em     timestamptz;
alter table public.grupos_config add column if not exists teste_hash     text;  -- chave de uso único do teste de qualidade (ação comparar)
update public.grupos_config set resumo_hora = 21 where id = 1;
notify pgrst, 'reload schema';
