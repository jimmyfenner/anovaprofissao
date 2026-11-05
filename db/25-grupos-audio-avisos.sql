-- =========================================================
-- Grupos do WhatsApp (nov/2026): áudio transcrito e avisos agrupados.
--   grupo_mensagens.audio_tentativas  quantas vezes tentou transcrever (para de tentar na 3ª)
--   grupos_config.aviso_min            minutos entre um aviso e o próximo no WhatsApp (0 = só o resumo diário)
--   grupos_config.aviso_em             quando saiu o último aviso
--   grupos_config.modelo_audio         modelo da transcrição (OpenRouter; o Claude não ouve áudio)
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================
alter table public.grupo_mensagens add column if not exists audio_tentativas int not null default 0;
alter table public.grupos_config add column if not exists aviso_min int not null default 30 check (aviso_min between 0 and 1440);
alter table public.grupos_config add column if not exists aviso_em timestamptz;
alter table public.grupos_config add column if not exists modelo_audio text not null default 'google/gemini-2.5-flash';
create index if not exists grupo_mensagens_audio_idx on public.grupo_mensagens (ts)
  where tipo = 'audioMessage' and texto in ('[áudio]', '[áudio de voz]');
notify pgrst, 'reload schema';
