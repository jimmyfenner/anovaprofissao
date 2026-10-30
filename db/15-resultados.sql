-- =========================================================
-- A NOVA PROFISSÃO — painel de resultados (funil por anúncio e por etapa)
--
-- 1) visitas ganha conjunto (utm_term) e anúncio (utm_content), para o quadro
--    "Por anúncio" comparar visitas e leads no mesmo nível de detalhe.
-- 2) eventos_funil: uma linha por etapa por sessão (começou o quiz, deu play,
--    começou o formulário), com o mesmo código anônimo das visitas. Sem dado
--    pessoal. O site (anon) só grava; ler exige login.
-- 3) resumo_resultados(pagina, desde): visitas, visitantes, pessoas por etapa
--    e visitas por anúncio. Os números de leads o painel soma na tela, para
--    mudarem na hora em que o status muda.
--
-- Enquanto ela não rodar, o site grava a visita sem os campos novos e o painel
-- mostra só os números de leads, então nada se perde.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

alter table public.visitas
  add column if not exists utm_term    text,
  add column if not exists utm_content text;

alter table public.visitas drop constraint if exists visitas_anuncio_ok;
alter table public.visitas add constraint visitas_anuncio_ok check (
  coalesce(length(utm_term),0) <= 200 and coalesce(length(utm_content),0) <= 200);

grant insert (utm_term, utm_content) on public.visitas to anon, authenticated;

create table if not exists public.eventos_funil (
  id         uuid primary key default gen_random_uuid(),
  criado_em  timestamptz not null default now(),
  vid        text not null check (length(vid) between 8 and 64),
  landing    text check (coalesce(length(landing),0) <= 300),
  evento     text not null check (evento ~ '^[a-z0-9_]{2,40}$')
);

create index if not exists eventos_funil_criado_em_idx on public.eventos_funil (criado_em desc);

alter table public.eventos_funil enable row level security;

drop policy if exists "site marca etapa"     on public.eventos_funil;
drop policy if exists "painel le as etapas"  on public.eventos_funil;

create policy "site marca etapa"
  on public.eventos_funil for insert
  to anon, authenticated with check (true);

create policy "painel le as etapas"
  on public.eventos_funil for select
  to authenticated using (true);

revoke all on public.eventos_funil from anon, authenticated;
grant insert (vid, landing, evento) on public.eventos_funil to anon, authenticated;
grant select on public.eventos_funil to authenticated;

create or replace function public.resumo_resultados(pagina text default null, desde timestamptz default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
with
v as (
  select vid, utm_source, utm_campaign, utm_term, utm_content, referrer
  from visitas
  where (desde is null or criado_em >= desde)
    and (pagina is null or visita_pagina(landing) = pagina)
),
e as (
  select vid, evento
  from eventos_funil
  where (desde is null or criado_em >= desde)
    and (pagina is null or visita_pagina(landing) = pagina)
)
select jsonb_build_object(
  'visitas',    (select count(*) from v),
  'visitantes', (select count(distinct vid) from v),
  'eventos', (
    select coalesce(jsonb_object_agg(evento, n), '{}'::jsonb)
    from (select evento, count(distinct vid) n from e group by evento) x
  ),
  'anuncios', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'fonte', fonte, 'campanha', campanha, 'conjunto', conjunto, 'anuncio', anuncio, 'visitas', n)), '[]'::jsonb)
    from (
      select coalesce(nullif(utm_source,''), nullif(referrer,''), 'direto') as fonte,
             nullif(utm_campaign,'') as campanha,
             nullif(utm_term,'')     as conjunto,
             nullif(utm_content,'')  as anuncio,
             count(*) n
      from v group by 1, 2, 3, 4
    ) a
  )
);
$$;

revoke all on function public.resumo_resultados(text, timestamptz) from public, anon;
grant execute on function public.resumo_resultados(text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
