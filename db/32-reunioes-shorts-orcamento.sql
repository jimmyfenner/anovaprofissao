-- 32 · Shorts do painel: orçamento de geração paga aprovado pelo Jimmy (nov/2026)
--
-- Pedido do Jimmy em 19/11/2026: num ajuste (ou no recado do pedido) ele pode pedir coisa que precisa ser
-- gerada (imagem ou vídeo na Higgsfield, música, efeito ou voz na ElevenLabs). A rotina do Mac nunca gera
-- sem o ok dele: ela calcula o custo, para o pedido em "orcamento" e o painel mostra o que quer gerar e
-- quanto custa, com "Gerar" e "Fazer sem gerar". A decisão devolve o pedido para a fila do Mac.
--
--   status       montando → orcamento (Mac) → ajustar/fila (painel decide) → montando …
--   orcamento    {itens: [{plataforma: higgsfield|elevenlabs, o_que, modelo, creditos, usd}],
--                 higgsfield, elevenlabs (totais em créditos de cada plataforma), usd, saldo, nota,
--                 pedido_em, decisao: null|aprovado|recusado, decidido_em,
--                 gasto: {higgsfield, elevenlabs} (o Mac grava ao subir a prévia), gasto_antes}
--   regras puras em supabase/functions/_shared/shorts.mjs (normalizarOrcamento, normalizarGasto)
-- Idempotente: pode rodar de novo.

alter table public.reunioes_shorts add column if not exists orcamento jsonb;

alter table public.reunioes_shorts drop constraint if exists reunioes_shorts_status_check;
alter table public.reunioes_shorts add constraint reunioes_shorts_status_check
  check (status in ('fila', 'montando', 'orcamento', 'pronto', 'ajustar', 'aprovado', 'publicando', 'publicado', 'erro', 'descartado'));

alter table public.reunioes_shorts drop constraint if exists reunioes_shorts_orcamento_check;
alter table public.reunioes_shorts add constraint reunioes_shorts_orcamento_check
  check (orcamento is null or (jsonb_typeof(orcamento) = 'object' and length(orcamento::text) <= 8000));

comment on column public.reunioes_shorts.orcamento is
  'Geração paga (Higgsfield/ElevenLabs) proposta pelo Mac e aprovada ou recusada pelo Jimmy no painel; gasto real gravado na prévia.';
