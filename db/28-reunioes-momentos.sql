-- 28 · Diário de reuniões: momentos para short e autorização do cliente (nov/2026)
--
-- Pedido do Jimmy em 12/11/2026: a rotina que já lê toda transcrição do Meet passa a marcar
-- os trechos bons para short (minutagem, o que foi dito, por que vale), e cada lead guarda se
-- autorizou aparecer. A sessão que monta os shorts parte dessa lista
-- (Reunioes/Momentos para shorts.md, gerada pelo assistente do Mac).
--
--   reunioes.momentos       null = a rotina ainda não olhou; [] = olhou e não achou nada;
--                           lista de {ini, fim, quem, tipo, fala, porque, cuidado, forca, fonte, usado}
--                           (regras em supabase/functions/_shared/momentos.mjs)
--   reunioes.gravacao_id    id do vídeo da gravação no Drive do contato@ (mesma pasta das anotações)
--   reunioes_leads.short_ok null = não pedido; 'pedido' = perguntou, sem resposta; 'sim'; 'nao'
-- Idempotente: pode rodar de novo.

alter table public.reunioes add column if not exists momentos jsonb;
alter table public.reunioes add column if not exists gravacao_id text;

alter table public.reunioes drop constraint if exists reunioes_momentos_check;
alter table public.reunioes add constraint reunioes_momentos_check
  check (momentos is null or jsonb_typeof(momentos) = 'array');
alter table public.reunioes drop constraint if exists reunioes_gravacao_check;
alter table public.reunioes add constraint reunioes_gravacao_check
  check (gravacao_id is null or gravacao_id ~ '^[A-Za-z0-9_-]{10,200}$');

alter table public.reunioes_leads add column if not exists short_ok text;
alter table public.reunioes_leads add column if not exists short_ok_em timestamptz;
alter table public.reunioes_leads drop constraint if exists reunioes_leads_short_ok_check;
alter table public.reunioes_leads add constraint reunioes_leads_short_ok_check
  check (short_ok is null or short_ok in ('pedido', 'sim', 'nao'));

comment on column public.reunioes.momentos is
  'Trechos bons para short marcados pela rotina do diário (null = ainda não olhou; [] = nada).';
comment on column public.reunioes_leads.short_ok is
  'Autorização para aparecer em short: null não pedido, pedido, sim, nao.';
