-- =========================================================
-- A NOVA PROFISSÃO — contador de visitas
--
-- Uma linha por visita (sessão do navegador), sem IP e sem
-- dado pessoal: o "vid" é um código aleatório guardado no
-- navegador do visitante, só para separar visitas de visitantes.
--
-- O site (anon) só GRAVA. Ler os números exige login no painel,
-- que chama a função resumo_visitas() já com tudo somado.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

create table if not exists public.visitas (
  id            uuid primary key default gen_random_uuid(),
  criado_em     timestamptz not null default now(),
  vid           text not null,
  landing       text,
  referrer      text,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  device        text,

  -- o endpoint é público: limites de tamanho para ninguém encher o banco de lixo
  constraint visitas_vid_ok      check (length(vid) between 8 and 64),
  constraint visitas_campos_ok   check (
    coalesce(length(landing),0)      <= 300 and
    coalesce(length(referrer),0)     <= 200 and
    coalesce(length(utm_source),0)   <= 120 and
    coalesce(length(utm_medium),0)   <= 120 and
    coalesce(length(utm_campaign),0) <= 200 and
    coalesce(length(device),0)       <= 20)
);

create index if not exists visitas_criado_em_idx on public.visitas (criado_em desc);

alter table public.visitas enable row level security;

drop policy if exists "site conta visita"   on public.visitas;
drop policy if exists "painel le as visitas" on public.visitas;

create policy "site conta visita"
  on public.visitas for insert
  to anon, authenticated with check (true);

create policy "painel le as visitas"
  on public.visitas for select
  to authenticated using (true);

revoke all on public.visitas from anon, authenticated;
grant insert (vid, landing, referrer, utm_source, utm_medium, utm_campaign, device)
  on public.visitas to anon, authenticated;
grant select on public.visitas to authenticated;

-- ---------------------------------------------------------
-- Resumo para o painel. Dias contados no horário de Brasília.
-- security invoker: roda com o login de quem chama, então a
-- RLS continua valendo — anon chamando recebe zeros.
-- ---------------------------------------------------------
create or replace function public.resumo_visitas()
returns jsonb
language sql stable security invoker set search_path = public
as $$
with
ref as (select (now() at time zone 'America/Sao_Paulo')::date as hoje),
v as (
  select vid, device,
         (criado_em at time zone 'America/Sao_Paulo')::date as dia,
         coalesce(nullif(utm_source,''), nullif(referrer,''), 'direto') as origem
  from visitas
  where criado_em >= now() - interval '32 days'
),
l as (
  select (criado_em at time zone 'America/Sao_Paulo')::date as dia
  from leads
  where criado_em >= now() - interval '32 days'
)
select jsonb_build_object(
  'hoje', (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid))
           from v, ref where v.dia = ref.hoje),
  'd7',   (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid))
           from v, ref where v.dia > ref.hoje - 7),
  'd30',  (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid))
           from v, ref where v.dia > ref.hoje - 30),
  'leads_d30', (select count(*) from l, ref where l.dia > ref.hoje - 30),
  'total', (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid),
                                      'desde', min(criado_em))
            from visitas),
  'serie', (
    select jsonb_agg(jsonb_build_object(
             'dia', g.dia,
             'visitas', coalesce(x.visitas, 0),
             'visitantes', coalesce(x.visitantes, 0),
             'leads', coalesce(y.leads, 0)) order by g.dia)
    from (select generate_series(ref.hoje - 29, ref.hoje, interval '1 day')::date as dia from ref) g
    left join (select dia, count(*) visitas, count(distinct vid) visitantes from v group by dia) x using (dia)
    left join (select dia, count(*) leads from l group by dia) y using (dia)
  ),
  'origens', (
    select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'visitas', n) order by n desc), '[]'::jsonb)
    from (select origem, count(*) n from v, ref where v.dia > ref.hoje - 30
          group by origem order by n desc limit 10) o
  ),
  'dispositivos', (
    select coalesce(jsonb_agg(jsonb_build_object('device', device, 'visitas', n) order by n desc), '[]'::jsonb)
    from (select coalesce(device, '?') device, count(*) n from v, ref where v.dia > ref.hoje - 30
          group by 1) d
  )
);
$$;

revoke all on function public.resumo_visitas() from public, anon;
grant execute on function public.resumo_visitas() to authenticated;

notify pgrst, 'reload schema';
