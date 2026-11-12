-- 27 · Diário de reuniões: tarefas e lembretes que se repetem (nov/2026)
--
-- Pedido do Jimmy em 11/11/2026: além das reuniões, lembretes e tarefas pelo WhatsApp (1575),
-- criados também por comando lá ("tarefa ...", "lembrar toda segunda 10h ...").
--   tipo     'lembrete' (sempre com hora) ou 'tarefa' (lista do que fazer; prazo opcional)
--   avisar   false = não manda mensagem na hora (tarefa só com data ou sem prazo); a tarefa
--            aparece na agenda das 06:30 e no comando "tarefas"
--   repetir  regra de repetição do lembrete, ex. {"tipo":"semanal","dias":[1],"hora":"10:00"};
--            ao mandar, a função "reunioes" leva o "quando" para a próxima vez (regra em
--            supabase/functions/_shared/repeticao.mjs)
-- Idempotente: pode rodar de novo.

alter table public.reunioes_lembretes add column if not exists tipo text not null default 'lembrete';
alter table public.reunioes_lembretes add column if not exists avisar boolean not null default true;
alter table public.reunioes_lembretes add column if not exists repetir jsonb;
alter table public.reunioes_lembretes alter column quando drop not null;

alter table public.reunioes_lembretes drop constraint if exists reunioes_lembretes_tipo_check;
alter table public.reunioes_lembretes add constraint reunioes_lembretes_tipo_check
  check (tipo in ('lembrete', 'tarefa'));
-- lembrete sem hora não existe; tarefa pode não ter prazo
alter table public.reunioes_lembretes drop constraint if exists reunioes_lembretes_quando_check;
alter table public.reunioes_lembretes add constraint reunioes_lembretes_quando_check
  check (tipo = 'tarefa' or quando is not null);
-- só lembrete se repete, e a regra é um objeto com tipo conhecido
alter table public.reunioes_lembretes drop constraint if exists reunioes_lembretes_repetir_check;
alter table public.reunioes_lembretes add constraint reunioes_lembretes_repetir_check
  check (repetir is null or (tipo = 'lembrete' and jsonb_typeof(repetir) = 'object'
         and repetir->>'tipo' in ('diario', 'uteis', 'semanal', 'mensal')));

create index if not exists reunioes_lembretes_tarefas_idx on public.reunioes_lembretes (tipo, status);
