-- =========================================================
-- A NOVA PROFISSÃO — API de Conversões da Meta para o lead de integrador
--
-- 1) leads ganha os identificadores de cookie da Meta (meta_fbp, meta_fbc) e o
--    resultado do envio (meta_conversao_enviada: vazio = não tentou).
-- 2) O site passa a gerar o id do lead, para mandar o mesmo id ao pixel como
--    eventID: é ele que impede a Meta de contar a conversão em dobro.
-- 3) notificacoes_log aceita o canal "meta": toda tentativa vira uma linha.
-- 4) Gatilho só para tipo integrador, chamando a Edge Function conversao-meta.
--    IP e navegador vêm dos cabeçalhos da gravação e seguem só para a função:
--    não ficam em nenhuma coluna. Como no aviso de lead, o erro é capturado,
--    porque uma conversão que falha jamais pode derrubar a gravação do lead.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.leads
  add column if not exists meta_fbp text,
  add column if not exists meta_fbc text,
  add column if not exists meta_conversao_enviada boolean;

alter table public.leads drop constraint if exists leads_meta_cookies_ok;
alter table public.leads add constraint leads_meta_cookies_ok check (
  coalesce(length(meta_fbp),0) <= 500 and coalesce(length(meta_fbc),0) <= 500);

-- meta_conversao_enviada fica de fora de propósito: só a função escreve nela
grant insert (id, meta_fbp, meta_fbc) on public.leads to anon;

alter table public.notificacoes_log drop constraint if exists notificacoes_log_canal_check;
alter table public.notificacoes_log add constraint notificacoes_log_canal_check
  check (canal in ('whatsapp','email','meta'));

create or replace function public.envia_conversao_meta()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'net'
as $$
declare
  k text;
  h jsonb;
begin
  select valor into k from private_config where chave = 'service_key';
  h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;

  perform net.http_post(
    url     := 'https://buapklmgdjcoyzrmhhcd.supabase.co/functions/v1/conversao-meta',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || k
               ),
    body    := jsonb_build_object(
                 'lead_id',    new.id,
                 'ip',         coalesce(h->>'cf-connecting-ip',
                                        nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''),
                                        h->>'x-real-ip'),
                 'user_agent', h->>'user-agent'
               )
  );

  return new;
exception when others then
  raise warning 'conversao da Meta falhou: %', sqlerrm;
  return new;
end $$;

drop trigger if exists envia_conversao_meta on public.leads;
create trigger envia_conversao_meta after insert on public.leads
  for each row when (new.tipo = 'integrador')
  execute function public.envia_conversao_meta();

notify pgrst, 'reload schema';
