-- =========================================================
-- A NOVA PROFISSÃO — agendamento de reunião (nov/2026)
--
-- anovaprofissao.com.br/agendar (apresentação da iGreen Energy) e
-- querovendercarregador.com.br/agendar (Conexão Mob para integradores).
-- Quem agenda vira um lead comum (tipo 'agendamento'), então aparece no
-- painel, na fila e no contador, e o aviso sai pelo mesmo gatilho dos outros
-- leads, já com o horário e o link do Meet.
--
-- Só a função `agenda` (service role) grava essas colunas: o site público
-- (anon) não tem grant nelas, e um lead 'agendamento' sem horário é
-- recusado — ninguém marca reunião sem passar pela agenda do Google.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.leads
  add column if not exists agenda_inicio timestamptz,
  add column if not exists agenda_fim    timestamptz,
  add column if not exists agenda_meet   text,
  add column if not exists agenda_evento text,
  add column if not exists agenda_aceite text;

alter table public.leads drop constraint if exists leads_tipo_check;
alter table public.leads
  add constraint leads_tipo_check check (tipo in ('quiz', 'direto', 'integrador', 'agendamento'));

-- 'agendamento' sempre com horário; horário só em 'agendamento'
alter table public.leads drop constraint if exists leads_agenda_ok;
alter table public.leads
  add constraint leads_agenda_ok check (
    (tipo is distinct from 'agendamento' or (agenda_inicio is not null and agenda_fim is not null))
    and (agenda_inicio is null or tipo = 'agendamento')
    and coalesce(length(agenda_meet), 0) <= 300
    and coalesce(length(agenda_evento), 0) <= 300
    and coalesce(length(agenda_aceite), 0) <= 300
  );

-- dois agendamentos no mesmo horário: o segundo é recusado (a função devolve 409)
create unique index if not exists leads_agenda_inicio_uk
  on public.leads (agenda_inicio) where agenda_inicio is not null;

-- o painel já lê e altera a tabela inteira (grant de tabela para authenticated);
-- anon continua só com o INSERT por coluna, que não inclui as colunas acima.

notify pgrst, 'reload schema';
