-- =========================================================
-- A NOVA PROFISSÃO — disparo de mensagens pelo painel (nov/2026)
--
-- O painel (anovaprofissao.com.br/admin, que também é o painel do
-- querovendercarregador) manda WhatsApp para um lead ou para vários, com
-- espera aleatória entre uma mensagem e a próxima. A fila mora aqui:
--
--   disparo_config  instância padrão e número de teste (uma linha só)
--   disparos        cada envio em massa (modelo, instância, intervalo, status)
--   disparo_envios  uma linha por pessoa, na ordem em que vai sair
--
-- Quem anda a fila é a Edge Function `disparos`: o pg_cron chama
-- {"action":"processar"} a cada minuto e a função, por até 55 s, reserva o
-- próximo envio (disparo_reservar), manda pela Evolution e devolve o resultado
-- (disparo_concluir / disparo_devolver). Uma mensagem por vez por instância.
-- O painel só lê e apaga (LGPD); gravar, só a função (service role).
--
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

create extension if not exists pg_cron with schema pg_catalog;

-- ---------- tabelas ----------
create table if not exists public.disparo_config (
  id            int primary key default 1 check (id = 1),
  instancia     text,
  numero_teste  text,
  atualizado_em timestamptz not null default now()
);
insert into public.disparo_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.disparos (
  id               uuid primary key default gen_random_uuid(),
  criado_em        timestamptz not null default now(),
  criado_por       uuid,
  instancia        text not null,
  modelo           text not null check (length(modelo) between 1 and 4096),
  intervalo_min    int not null check (intervalo_min between 5 and 3600),
  intervalo_max    int not null check (intervalo_max >= intervalo_min and intervalo_max <= 3600),
  marcar_contatado boolean not null default true,
  status           text not null default 'ativo'
                   check (status in ('ativo', 'pausado', 'cancelado', 'concluido')),
  motivo           text,
  total            int not null default 0,
  inicio           timestamptz not null default now()
);
-- chave gerada pelo compositor ao abrir: o mesmo pedido "criar" repetido (a
-- rede caiu depois que o servidor gravou, toque duplo) não vira dois disparos
alter table public.disparos add column if not exists chave text;
create unique index if not exists disparos_chave_key on public.disparos (chave);

create table if not exists public.disparo_envios (
  id            uuid primary key default gen_random_uuid(),
  disparo_id    uuid not null references public.disparos (id) on delete cascade,
  ordem         int not null,
  numero        text not null check (numero ~ '^[0-9]{10,15}$'),
  nome          text,
  cidade        text,
  uf            text,
  refs          jsonb not null default '[]',   -- [{"id": "<id do lead>"}]
  espera_s      int not null default 0,        -- espera ANTES deste envio, contada do fim do anterior
  agendado_para timestamptz,                   -- null = aguardando o anterior
  status        text not null default 'pendente'
                check (status in ('pendente', 'enviando', 'enviado', 'falhou', 'incerto', 'cancelado')),
  texto         text,
  tentado_em    timestamptz,
  enviado_em    timestamptz,
  erro          text,
  unique (disparo_id, numero)
);

create index if not exists disparo_envios_fila_idx
  on public.disparo_envios (agendado_para) where status in ('pendente', 'enviando');
create index if not exists disparo_envios_numero_idx on public.disparo_envios (numero);
create index if not exists disparos_criado_em_idx on public.disparos (criado_em desc);

-- ---------- acesso: o painel lê e apaga; só a função grava ----------
alter table public.disparo_config enable row level security;
alter table public.disparos       enable row level security;
alter table public.disparo_envios enable row level security;

drop policy if exists "painel le disparo_config"   on public.disparo_config;
drop policy if exists "painel le disparos"         on public.disparos;
drop policy if exists "painel apaga disparos"      on public.disparos;
drop policy if exists "painel le disparo_envios"   on public.disparo_envios;
drop policy if exists "painel apaga disparo_envios" on public.disparo_envios;
create policy "painel le disparo_config"    on public.disparo_config for select to authenticated using (true);
create policy "painel le disparos"          on public.disparos       for select to authenticated using (true);
create policy "painel apaga disparos"       on public.disparos       for delete to authenticated using (true);
create policy "painel le disparo_envios"    on public.disparo_envios for select to authenticated using (true);
create policy "painel apaga disparo_envios" on public.disparo_envios for delete to authenticated using (true);

revoke all on public.disparo_config, public.disparos, public.disparo_envios from anon, authenticated;
grant select         on public.disparo_config                  to authenticated;
grant select, delete on public.disparos, public.disparo_envios to authenticated;
grant all            on public.disparo_config, public.disparos, public.disparo_envios to service_role;

-- ---------- fila ----------

-- Agenda a próxima pessoa de um disparo ativo, contando a espera a partir de
-- agora (o fim do envio anterior). Sem ninguém pendente nem enviando, o
-- disparo termina.
create or replace function public.disparo_agendar_proximo(p_disparo uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  select d.status into v_status from disparos d where d.id = p_disparo for update;
  if v_status is null then return; end if;

  if not exists (select 1 from disparo_envios e
                  where e.disparo_id = p_disparo and e.status in ('pendente', 'enviando')) then
    if v_status in ('ativo', 'pausado') then
      update disparos set status = 'concluido', motivo = null where id = p_disparo;
    end if;
    return;
  end if;

  if v_status <> 'ativo' then return; end if;
  if exists (select 1 from disparo_envios e
              where e.disparo_id = p_disparo
                and (e.status = 'enviando' or (e.status = 'pendente' and e.agendado_para is not null))) then
    return;
  end if;

  -- skip locked: uma linha que o painel está apagando agora (LGPD) fica de
  -- fora, em vez de travar esperando por ela (ver o gatilho abaixo)
  update disparo_envios
     set agendado_para = now() + espera_s * interval '1 second'
   where id = (select e.id from disparo_envios e
                where e.disparo_id = p_disparo and e.status = 'pendente'
                order by e.ordem limit 1
                for update skip locked);
end $$;

-- LGPD: o painel apaga as linhas de um número a qualquer hora, inclusive no
-- meio de um disparo. Se a linha apagada era a próxima da vez, a que estava
-- saindo ou a última, ninguém mais chamaria disparo_agendar_proximo e o
-- disparo ficaria 'ativo' para sempre. O gatilho tira a pessoa do total e
-- reagenda a fila (ou conclui o disparo que ficou vazio). No apagamento em
-- cascata do disparo inteiro o pai já sumiu e nada acontece.
create or replace function public.disparo_envio_apagado()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update disparos set total = greatest(total - 1, 0) where id = old.disparo_id;
  perform disparo_agendar_proximo(old.disparo_id);
  return null;
end $$;

drop trigger if exists disparo_envios_apagado on public.disparo_envios;
create trigger disparo_envios_apagado
  after delete on public.disparo_envios
  for each row execute function public.disparo_envio_apagado();

-- Pega o próximo envio na hora (no máximo um), marcando 'enviando'. Antes,
-- quem ficou 'enviando' por mais de 4 min vira 'incerto' (a função caiu no
-- meio do envio) e a fila daquele disparo segue. Uma instância nunca tem dois
-- envios ao mesmo tempo, mesmo com dois disparos nela.
create or replace function public.disparo_reservar()
returns table (id uuid, disparo_id uuid, numero text, nome text, cidade text, uf text,
               refs jsonb, instancia text, modelo text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_presos uuid[];
  v_disp uuid;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('disparos'));

  with presos as (
    update disparo_envios e
       set status = 'incerto', erro = 'Sem confirmação da Evolution (pode ter saído)'
     where e.status = 'enviando' and e.tentado_em < now() - interval '4 minutes'
    returning e.disparo_id
  )
  select array_agg(distinct p.disparo_id) into v_presos from presos p;
  if v_presos is not null then
    foreach v_disp in array v_presos loop
      perform disparo_agendar_proximo(v_disp);
    end loop;
  end if;

  select e.id into v_id
    from disparo_envios e
    join disparos d on d.id = e.disparo_id
   where e.status = 'pendente'
     and e.agendado_para <= now()
     and d.status = 'ativo'
     and not exists (select 1 from disparo_envios x
                       join disparos dx on dx.id = x.disparo_id
                      where x.status = 'enviando' and dx.instancia = d.instancia)
   order by e.agendado_para, e.ordem
   limit 1
   for update of e skip locked;
  if v_id is null then return; end if;

  return query
    update disparo_envios e
       set status = 'enviando', tentado_em = now()
      from disparos d
     where e.id = v_id and d.id = e.disparo_id
    returning e.id, e.disparo_id, e.numero, e.nome, e.cidade, e.uf, e.refs, d.instancia, d.modelo;
end $$;

-- Resultado de um envio: 'enviado', 'falhou' (número sem WhatsApp, recusado)
-- ou 'incerto' (sem resposta). Saiu: o lead 'novo' passa a 'contatado'.
create or replace function public.disparo_concluir(p_id uuid, p_status text, p_texto text, p_erro text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_disp uuid;
  v_refs jsonb;
begin
  if p_status not in ('enviado', 'falhou', 'incerto') then
    raise exception 'status inválido: %', p_status;
  end if;

  update disparo_envios e
     set status = p_status,
         texto = left(p_texto, 4096),
         erro = left(p_erro, 500),
         enviado_em = case when p_status = 'enviado' then now() else e.enviado_em end
   where e.id = p_id and e.status in ('enviando', 'incerto')
  returning e.disparo_id, e.refs into v_disp, v_refs;
  if v_disp is null then return; end if;

  if p_status = 'enviado' and jsonb_typeof(v_refs) = 'array'
     and (select d.marcar_contatado from disparos d where d.id = v_disp) then
    update leads l
       set status = 'contatado', contatado_em = coalesce(l.contatado_em, now())
     where l.status = 'novo'
       and l.id in (select case when (r ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                                then (r ->> 'id')::uuid end
                      from jsonb_array_elements(v_refs) r);
  end if;

  perform disparo_agendar_proximo(v_disp);
end $$;

-- A instância falhou (caída, inexistente, sem permissão): a pessoa volta para
-- a fila sem perder a vez e o disparo pausa com o motivo.
create or replace function public.disparo_devolver(p_id uuid, p_motivo text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_disp uuid;
  v_status text;
begin
  select e.disparo_id, d.status into v_disp, v_status
    from disparo_envios e join disparos d on d.id = e.disparo_id
   where e.id = p_id and e.status = 'enviando'
   for update of d;
  if v_disp is null then return; end if;

  if v_status = 'cancelado' then
    update disparo_envios set status = 'cancelado', agendado_para = null where id = p_id;
    return;
  end if;
  update disparo_envios set status = 'pendente', agendado_para = null, erro = null where id = p_id;
  update disparos set status = 'pausado', motivo = left(p_motivo, 500)
   where id = v_disp and status in ('ativo', 'pausado');
end $$;

-- Pausa pelo painel. Quem está saindo agora termina; o resto espera.
create or replace function public.disparo_pausar(p_disparo uuid, p_motivo text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update disparos set status = 'pausado', motivo = left(p_motivo, 500)
   where id = p_disparo and status = 'ativo';
end $$;

-- Volta a andar: a próxima pessoa sai agora (ou logo depois de quem ainda
-- está saindo, com a espera dela).
create or replace function public.disparo_retomar(p_disparo uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update disparos set status = 'ativo', motivo = null where id = p_disparo and status = 'pausado';
  if not found then return; end if;

  update disparo_envios set agendado_para = null where disparo_id = p_disparo and status = 'pendente';
  if not exists (select 1 from disparo_envios e where e.disparo_id = p_disparo and e.status = 'enviando') then
    update disparo_envios set agendado_para = now()
     where id = (select e.id from disparo_envios e
                  where e.disparo_id = p_disparo and e.status = 'pendente'
                  order by e.ordem limit 1);
  end if;
  perform disparo_agendar_proximo(p_disparo);   -- sem ninguém na fila, termina
end $$;

-- Cancela: quem ainda não recebeu não recebe mais.
create or replace function public.disparo_cancelar(p_disparo uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update disparos set status = 'cancelado', motivo = null
   where id = p_disparo and status in ('ativo', 'pausado');
  update disparo_envios set status = 'cancelado', agendado_para = null
   where disparo_id = p_disparo and status = 'pendente';
end $$;

-- Hora do próximo envio marcado de um disparo ativo (a função dorme até lá).
create or replace function public.disparo_proximo()
returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(e.agendado_para)
    from disparo_envios e join disparos d on d.id = e.disparo_id
   where e.status = 'pendente' and e.agendado_para is not null and d.status = 'ativo';
$$;

-- Acompanhamento do painel: os 20 disparos mais recentes (em andamento
-- primeiro) com a contagem por status, o próximo envio e as primeiras falhas;
-- com p_disparo, também a lista das pessoas dele.
create or replace function public.disparo_painel(p_disparo uuid default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  with ds as (
    select d.*, case when d.status in ('ativo', 'pausado') then 0 else 1 end as grupo
      from disparos d
     order by grupo, d.criado_em desc
     limit 20
  )
  select jsonb_build_object(
    'disparos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ds.id, 'criado_em', ds.criado_em, 'instancia', ds.instancia, 'modelo', ds.modelo,
        'intervalo_min', ds.intervalo_min, 'intervalo_max', ds.intervalo_max,
        'marcar_contatado', ds.marcar_contatado, 'status', ds.status, 'motivo', ds.motivo,
        'total', ds.total, 'inicio', ds.inicio,
        'contagem', (select coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb)
                       from (select e.status, count(*) as n from disparo_envios e
                              where e.disparo_id = ds.id group by e.status) c),
        'proximo', (select min(e.agendado_para) from disparo_envios e
                     where e.disparo_id = ds.id and e.status = 'pendente' and ds.status = 'ativo'),
        'ultimo_envio', (select max(e.enviado_em) from disparo_envios e where e.disparo_id = ds.id),
        'erros', (select coalesce(jsonb_agg(jsonb_build_object('nome', f.nome, 'numero', f.numero, 'erro', f.erro)
                                            order by f.ordem), '[]'::jsonb)
                    from (select e.nome, e.numero, e.erro, e.ordem from disparo_envios e
                           where e.disparo_id = ds.id and e.status in ('falhou', 'incerto')
                           order by e.ordem limit 3) f)
      ) order by ds.grupo, ds.criado_em desc)
      from ds), '[]'::jsonb),
    'envios', case when p_disparo is null then null else coalesce((
      select jsonb_agg(jsonb_build_object(
        'ordem', e.ordem, 'nome', e.nome, 'numero', e.numero, 'status', e.status,
        'agendado_para', e.agendado_para, 'tentado_em', e.tentado_em,
        'enviado_em', e.enviado_em, 'erro', e.erro) order by e.ordem)
      from disparo_envios e where e.disparo_id = p_disparo), '[]'::jsonb) end
  );
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'disparo_agendar_proximo(uuid)', 'disparo_reservar()', 'disparo_concluir(uuid, text, text, text)',
    'disparo_devolver(uuid, text)', 'disparo_pausar(uuid, text)', 'disparo_retomar(uuid)',
    'disparo_cancelar(uuid)', 'disparo_proximo()', 'disparo_painel(uuid)', 'disparo_envio_apagado()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ---------- relógio: a cada minuto, a função anda a fila ----------
-- A chamada não leva chave: "processar" só envia o que já está na fila e no
-- horário (a função tem verify_jwt desligado e confere o login nas outras ações).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'disparos-processar') then
    perform cron.unschedule('disparos-processar');
  end if;
  perform cron.schedule(
    'disparos-processar',
    '* * * * *',
    $cmd$select net.http_post(
      url := 'https://buapklmgdjcoyzrmhhcd.supabase.co/functions/v1/disparos',
      body := '{"action":"processar"}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );$cmd$
  );
end $$;

notify pgrst, 'reload schema';
