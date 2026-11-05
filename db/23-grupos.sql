-- =========================================================
-- A NOVA PROFISSÃO — grupos do WhatsApp do Jimmy (nov/2026)
--
-- Painel grupos.anovaprofissao.com.br (também em anovaprofissao.com.br/grupos):
-- lê os grupos da instância `pessoal` da Evolution (a mesma do iGreen Turbo, sem
-- mexer no webhook dele), resume o dia, avisa no WhatsApp quando aparece instrução
-- nova da empresa ou quando alguém fala com ele, responde perguntas sobre o que foi
-- dito e manda mensagens programadas (únicas ou repetidas) com "mencionar todos".
--
--   grupos             todos os grupos da pessoal; o Jimmy liga os que interessam
--   grupo_mensagens    mensagens dos grupos ligados (texto e legenda)
--   grupo_itens        instruções novas e "precisa de você", com status
--   grupo_resumos      resumo de cada grupo por dia
--   grupo_envios       mensagens programadas (únicas, diárias, semanais, mensais)
--   grupo_envios_log   cada envio feito, com o erro quando falha
--   grupos_config      instância, quem recebe os avisos, cursor da leitura, hora do resumo
--   ai_usage           tokens e custo de cada chamada de IA (padrão dos projetos do Jimmy)
--
-- RLS ligada e nenhuma policy: tudo passa pela Edge Function `grupos` (service role),
-- que confere a sessão do painel (sessoes_painel, login por código no WhatsApp) e só
-- aceita o número do Jimmy. O job `grupos-processar` chama a função a cada 2 minutos.
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

create table if not exists public.grupos (
  jid            text primary key check (jid like '%@g.us'),
  nome           text not null default '',
  tamanho        int,
  papel          text,                                   -- criador | admin | membro
  so_admins      boolean not null default false,         -- só admins falam
  ativo          boolean not null default false,         -- o painel acompanha este grupo
  tipo           text not null default 'licenciados'
                 check (tipo in ('instrucoes', 'licenciados', 'envios')),
  sugestao       text check (sugestao in ('instrucoes', 'licenciados', 'envios')),
  msgs_14d       int not null default 0,
  ultima_msg_em  timestamptz,
  ligado_em      timestamptz,
  atualizado_em  timestamptz not null default now(),
  criado_em      timestamptz not null default now()
);

create table if not exists public.grupo_mensagens (
  id              text primary key,                      -- key.id do WhatsApp
  jid             text not null,
  ts              timestamptz not null,
  autor           text,                                  -- jid/lid de quem mandou
  autor_nome      text,
  de_mim          boolean not null default false,
  tipo            text,                                  -- messageType da Evolution
  texto           text,
  cita_id         text,
  cita_autor      text,
  cita_texto      text,
  menciona_jimmy  boolean not null default false,
  responde_jimmy  boolean not null default false,
  triada          boolean not null default false,        -- já passou pela IA (ou não precisa)
  criado_em       timestamptz not null default now()
);
create index if not exists grupo_mensagens_jid_ts_idx on public.grupo_mensagens (jid, ts desc);
create index if not exists grupo_mensagens_ts_idx on public.grupo_mensagens (ts desc);
create index if not exists grupo_mensagens_triar_idx on public.grupo_mensagens (jid, ts) where not triada;
create index if not exists grupo_mensagens_busca_idx
  on public.grupo_mensagens using gin (to_tsvector('portuguese', coalesce(texto, '')));

create table if not exists public.grupo_itens (
  id           uuid primary key default gen_random_uuid(),
  jid          text not null,
  tipo         text not null check (tipo in ('instrucao', 'atencao')),
  origem       text not null default 'ia' check (origem in ('ia', 'mencao', 'resposta')),
  titulo       text not null check (length(titulo) between 1 and 300),
  detalhe      text,
  autor_nome   text,
  ts           timestamptz not null,
  msg_ids      text[] not null default '{}',
  status       text not null default 'novo' check (status in ('novo', 'visto', 'feito', 'ignorado')),
  avisado_em   timestamptz,
  aviso_erro   text,
  criado_em    timestamptz not null default now()
);
create index if not exists grupo_itens_status_idx on public.grupo_itens (tipo, status, ts desc);
create unique index if not exists grupo_itens_msg_unica_idx
  on public.grupo_itens (tipo, (msg_ids[1])) where origem in ('mencao', 'resposta');

create table if not exists public.grupo_resumos (
  jid        text not null,
  dia        date not null,                              -- dia em Brasília
  texto      text not null,
  msgs       int not null default 0,
  criado_em  timestamptz not null default now(),
  primary key (jid, dia)
);

create table if not exists public.grupo_envios (
  id           uuid primary key default gen_random_uuid(),
  texto        text not null check (length(texto) between 1 and 4096),
  jids         text[] not null check (cardinality(jids) between 1 and 50),
  mencionar    boolean not null default true,
  repetir      text not null default 'nao' check (repetir in ('nao', 'diario', 'semanal', 'mensal')),
  dias_semana  int[],                                    -- 0 = domingo ... 6 = sábado
  dia_mes      int check (dia_mes between 1 and 31),
  hora         text check (hora ~ '^[0-2][0-9]:[0-5][0-9]$'),  -- horário de Brasília
  proximo_em   timestamptz,
  ate          date,
  ativo        boolean not null default true,
  ultimo_em    timestamptz,
  ultimo_erro  text,
  enviando_ate timestamptz,                              -- trava enquanto uma chamada envia
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists grupo_envios_proximo_idx on public.grupo_envios (proximo_em) where ativo;

create table if not exists public.grupo_envios_log (
  id          bigserial primary key,
  envio_id    uuid references public.grupo_envios (id) on delete set null,
  jid         text not null,
  enviado_em  timestamptz not null default now(),
  ok          boolean not null,
  erro        text
);
create index if not exists grupo_envios_log_envio_idx on public.grupo_envios_log (envio_id, enviado_em desc);

create table if not exists public.grupos_config (
  id                int primary key default 1 check (id = 1),
  instancia         text not null default 'pessoal',
  instancia_avisos  text not null default '1575',
  numero_avisos     text not null default '5548991067007',
  avisar            boolean not null default true,
  resumo_hora       int not null default 20 check (resumo_hora between 0 and 23),
  resumo_dia        date,                               -- último dia com resumo mandado
  modelo            text not null default 'google/gemini-2.5-flash',
  meus_jids         text[] not null default '{554891067007@s.whatsapp.net,276158243422302@lid}',
  cursor_em         timestamptz,
  lista_em          timestamptz,
  processando_ate   timestamptz,
  ultimo_erro       text,
  atualizado_em     timestamptz not null default now()
);
insert into public.grupos_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.ai_usage (
  id          bigserial primary key,
  projeto     text not null default 'anovaprofissao',
  feature     text not null,
  modelo      text,
  tokens_in   int,
  tokens_out  int,
  custo_usd   numeric(12, 6),
  ok          boolean not null default true,
  erro        text,
  criado_em   timestamptz not null default now()
);
create or replace view public.ai_usage_daily as
  select (criado_em at time zone 'America/Sao_Paulo')::date as dia, feature,
         count(*) as chamadas, sum(tokens_in) as tokens_in, sum(tokens_out) as tokens_out,
         sum(custo_usd) as custo_usd
    from public.ai_usage group by 1, 2;

alter table public.grupos            enable row level security;
alter table public.grupo_mensagens   enable row level security;
alter table public.grupo_itens       enable row level security;
alter table public.grupo_resumos     enable row level security;
alter table public.grupo_envios      enable row level security;
alter table public.grupo_envios_log  enable row level security;
alter table public.grupos_config     enable row level security;
alter table public.ai_usage          enable row level security;

revoke all on public.grupos, public.grupo_mensagens, public.grupo_itens, public.grupo_resumos,
  public.grupo_envios, public.grupo_envios_log, public.grupos_config, public.ai_usage, public.ai_usage_daily
  from anon, authenticated;
revoke all on sequence public.grupo_envios_log_id_seq, public.ai_usage_id_seq from anon, authenticated;

-- Pergunta livre: mensagens que batem com as palavras, com nome do grupo (só service role).
create or replace function public.grupos_buscar(p_consulta text, p_desde timestamptz, p_jids text[], p_limite int)
returns table (id text, jid text, grupo text, ts timestamptz, autor_nome text, texto text, rank real)
language sql stable set search_path = public as $$
  select m.id, m.jid, g.nome, m.ts, m.autor_nome, m.texto,
         ts_rank(to_tsvector('portuguese', coalesce(m.texto, '')), websearch_to_tsquery('portuguese', p_consulta)) as rank
    from grupo_mensagens m join grupos g on g.jid = m.jid
   where m.ts >= p_desde
     and (p_jids is null or m.jid = any (p_jids))
     and to_tsvector('portuguese', coalesce(m.texto, '')) @@ websearch_to_tsquery('portuguese', p_consulta)
   order by rank desc, m.ts desc
   limit greatest(1, least(p_limite, 400));
$$;
revoke all on function public.grupos_buscar(text, timestamptz, text[], int) from public, anon, authenticated;

-- Job: lê as mensagens novas, tria, avisa, manda os envios programados e o resumo do dia.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'grupos-processar') then
    perform cron.unschedule('grupos-processar');
  end if;
  perform cron.schedule(
    'grupos-processar',
    '*/2 * * * *',
    $cmd$select net.http_post(
      url := 'https://buapklmgdjcoyzrmhhcd.supabase.co/functions/v1/grupos',
      body := '{"action":"processar"}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );$cmd$
  );
end $$;

notify pgrst, 'reload schema';
