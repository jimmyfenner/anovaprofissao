-- 30 · Diário de reuniões: lembrete "encaminhado" (nov/2026)
--
-- Pedido do Jimmy em 12/11/2026: "acabei de agendar uma mensagem para o Danilo mas ele ainda aparece no topo
-- dos lembretes e tarefas; o agendamento de follow-up ou o envio de mensagem tem que tirar da lista ou pôr
-- uma tag e jogar para outra parte da fila".
--
--   encaminhado  null = ainda na fila do que fazer.
--                {como: 'agendada'|'enviada'|'manual', em, para, agendada_id, texto}: o Jimmy já agiu.
--                A função "reunioes" marca sozinha, ao agendar no Turbo ou mandar mensagem pelo painel, os
--                lembretes abertos do lead que vencem até o dia da mensagem (regra em
--                supabase/functions/_shared/encaminhar.mjs); o botão "Já encaminhei" marca à mão.
--                Volta para a fila (null) com "Voltar para a fila", ao adiar, ao reabrir ou ao cancelar a
--                mensagem agendada.
-- O painel mostra os encaminhados numa seção à parte; o assistente do Mac não manda e não lista na agenda.
-- Idempotente: pode rodar de novo.

alter table public.reunioes_lembretes add column if not exists encaminhado jsonb;
alter table public.reunioes_lembretes drop constraint if exists reunioes_lembretes_encaminhado_check;
alter table public.reunioes_lembretes add constraint reunioes_lembretes_encaminhado_check
  check (encaminhado is null or (jsonb_typeof(encaminhado) = 'object'
         and encaminhado->>'como' in ('agendada', 'enviada', 'manual')));

comment on column public.reunioes_lembretes.encaminhado is
  'Já tratado pelo Jimmy (mensagem agendada/enviada ou marcado à mão): sai da fila do que fazer.';
