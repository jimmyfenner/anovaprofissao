-- A NOVA PROFISSÃO — db/31: Conversa com o lead pelo iGreen Turbo (17/11/2026)
--
-- Pedido do Jimmy: no painel (anovaprofissao.com.br/admin e
-- querovendercarregador.com.br/admin) a mesma Conversa do igreencel e do
-- querocarregador: histórico dos dois números dele no Turbo, envio de texto,
-- áudio, vídeo redondo, foto, vídeo, documento e fluxo, agendamento e
-- mensagens prontas. As mensagens ficam no Turbo; aqui só o que o painel
-- precisa para a lista (função "conversa"):
--
--   conversa_resumo     selo de cada número (quantas, quando, quem falou por
--                       último) e o contato dele em cada número do Turbo.
--                       Não guarda o texto das mensagens.
--   conversa_agendadas  mensagens agendadas no Turbo para os leads, para o
--                       selo "Agendada" da lista sem perguntar ao Turbo a cada
--                       minuto. A função grava e atualiza; o painel lê e apaga.
--   mensagens_prontas   textos prontos da Conversa, com as variáveis do
--                       disparo ({primeiro_nome}, {saudacao}, {cidade}...) e
--                       {reuniao}. O painel lê e edita.
--
-- Excluir o lead (LGPD) apaga também o resumo e as agendadas do número.
-- Pode rodar de novo sem estrago.

create table if not exists public.conversa_resumo (
  numero              text primary key check (numero ~ '^55[0-9]{10,11}$'),
  enviadas            int not null default 0,
  recebidas           int not null default 0,
  ultima_enviada_em   timestamptz,
  ultima_recebida_em  timestamptz,
  ultima_direcao      text check (ultima_direcao in ('in', 'out')),
  ultima_em           timestamptz,
  -- contato do lead em cada número do Jimmy no Turbo: {"pessoal": "<uuid>", "carregador": "<uuid>"}
  contatos            jsonb not null default '{}'::jsonb,
  atualizado_em       timestamptz not null default now()
);

create table if not exists public.conversa_agendadas (
  id                     uuid primary key,              -- o id da agendada no Turbo (scheduled_messages)
  numero                 text not null check (numero ~ '^55[0-9]{10,11}$'),
  contato_id             uuid not null,                 -- contato no Turbo
  instancia              text,                          -- pessoal | carregador
  texto                  text not null,
  quando                 timestamptz not null,
  status                 text not null,                 -- pending | processing | sent | failed | cancelled (os do Turbo)
  cancelar_se_responder  boolean not null default false,
  erro                   text,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index if not exists conversa_agendadas_numero on public.conversa_agendadas (numero);
create index if not exists conversa_agendadas_pendentes on public.conversa_agendadas (status) where status in ('pending', 'processing');

create table if not exists public.mensagens_prontas (
  id             bigint generated always as identity primary key,
  titulo         text not null check (length(btrim(titulo)) between 1 and 60),
  texto          text not null check (length(btrim(texto)) between 1 and 4096),
  -- para quem aparece: todos, integrador (querovendercarregador), quiz, direto ou agendamento
  para           text not null default 'todos' check (para in ('todos', 'integrador', 'quiz', 'direto', 'agendamento')),
  ordem          int not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

alter table public.conversa_resumo    enable row level security;
alter table public.conversa_agendadas enable row level security;
alter table public.mensagens_prontas  enable row level security;

drop policy if exists "painel le conversa_resumo"      on public.conversa_resumo;
drop policy if exists "painel apaga conversa_resumo"   on public.conversa_resumo;
drop policy if exists "painel le conversa_agendadas"   on public.conversa_agendadas;
drop policy if exists "painel apaga conversa_agendadas" on public.conversa_agendadas;
drop policy if exists "painel usa mensagens_prontas"   on public.mensagens_prontas;
create policy "painel le conversa_resumo"       on public.conversa_resumo    for select to authenticated using (true);
create policy "painel apaga conversa_resumo"    on public.conversa_resumo    for delete to authenticated using (true);
create policy "painel le conversa_agendadas"    on public.conversa_agendadas for select to authenticated using (true);
create policy "painel apaga conversa_agendadas" on public.conversa_agendadas for delete to authenticated using (true);
create policy "painel usa mensagens_prontas"    on public.mensagens_prontas  for all    to authenticated using (true) with check (true);

revoke all on public.conversa_resumo, public.conversa_agendadas, public.mensagens_prontas from anon, authenticated;
grant select, delete                 on public.conversa_resumo, public.conversa_agendadas to authenticated;
grant select, insert, update, delete on public.mensagens_prontas                         to authenticated;
grant all on public.conversa_resumo, public.conversa_agendadas, public.mensagens_prontas to service_role;

-- As primeiras mensagens prontas são as do antigo botão "Chamar" do painel, que
-- a Conversa substitui (o texto que já saía no WhatsApp, agora com variável).
-- Só entram com a tabela vazia, para não voltar o que ele apagar.
insert into public.mensagens_prontas (titulo, texto, para, ordem)
select v.titulo, v.texto, v.para, v.ordem
from (values
  ('Primeiro contato', 'Olá {primeiro_nome}! Aqui é o Jimmy. Recebi suas respostas na página para integradores — posso te mostrar como a Conexão Mob se encaixa no seu trabalho?', 'integrador', 1),
  ('Primeiro contato', 'Olá {primeiro_nome}! Aqui é o Jimmy, do site A Nova Profissão. Vi que você terminou a avaliação de perfil — posso te explicar como funciona?', 'quiz', 2),
  ('Primeiro contato', 'Olá {primeiro_nome}! Aqui é o Jimmy, do site A Nova Profissão. Vi que você foi para o cadastro — estou aqui para te ajudar em qualquer passo.', 'direto', 3),
  ('Sobre a reunião', 'Olá {primeiro_nome}! Aqui é o Jimmy. É sobre a nossa reunião de {reuniao}, pelo Google Meet — o link está no convite que foi para o seu e-mail.', 'agendamento', 4)
) as v(titulo, texto, para, ordem)
where not exists (select 1 from public.mensagens_prontas);
