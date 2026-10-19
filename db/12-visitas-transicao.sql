-- =========================================================
-- A NOVA PROFISSÃO — terceira página no contador: transição energética
--
-- A página transicaoenergetica.com.br (fonte: transicao-energetica.html)
-- grava visitas com landing "transicaoenergetica.com.br/..." ou
-- ".../transicao-energetica". Ela não tem formulário próprio: manda para a
-- avaliação da home com utm_source = 'transicaoenergetica', e é por essa
-- origem que o lead é atribuído a ela.
--
--   visita_pagina(landing)                  → 'transicao' | 'integradores' | 'home'
--   lead_pagina(tipo, solucao, utm_source)  → mesma classificação para leads
--   resumo_visitas(pagina)                  → aceita também 'transicao'
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

create or replace function public.visita_pagina(landing text)
returns text language sql immutable as $$
  select case
    when landing ilike '%transicaoenergetica%' or landing ilike '%/transicao-energetica%' then 'transicao'
    when landing ilike '%querovendercarregador%' or landing ilike '%/integradores%' then 'integradores'
    else 'home' end
$$;

create or replace function public.lead_pagina(tipo text, solucao text, utm_source text)
returns text language sql immutable as $$
  select case
    when tipo = 'integrador' or coalesce(solucao,'') ilike '%página de integradores%' then 'integradores'
    when utm_source = 'transicaoenergetica' then 'transicao'
    else 'home' end
$$;

create or replace function public.resumo_visitas(pagina text default null)
returns jsonb
language sql stable security invoker set search_path = public
as $$
with
ref as (select (now() at time zone 'America/Sao_Paulo')::date as hoje),
todas as (
  select vid, device, visita_pagina(landing) as pag,
         (criado_em at time zone 'America/Sao_Paulo')::date as dia,
         coalesce(nullif(utm_source,''), nullif(referrer,''), 'direto') as origem
  from visitas
  where criado_em >= now() - interval '32 days'
),
v as (select * from todas where pagina is null or pag = pagina),
l as (
  select (criado_em at time zone 'America/Sao_Paulo')::date as dia
  from leads
  where criado_em >= now() - interval '32 days'
    and (pagina is null or lead_pagina(tipo, solucao, utm_source) = pagina)
)
select jsonb_build_object(
  'pagina', pagina,
  'hoje', (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid))
           from v, ref where v.dia = ref.hoje),
  'd7',   (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid))
           from v, ref where v.dia > ref.hoje - 7),
  'd30',  (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid))
           from v, ref where v.dia > ref.hoje - 30),
  'leads_d30', (select count(*) from l, ref where l.dia > ref.hoje - 30),
  'total', (select jsonb_build_object('visitas', count(*), 'visitantes', count(distinct vid),
                                      'desde', min(criado_em))
            from visitas where pagina is null or visita_pagina(landing) = pagina),
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
  ),
  -- sempre das duas páginas, independente do filtro: é o quadro de comparação
  'paginas', (
    select coalesce(jsonb_agg(jsonb_build_object('pagina', pag, 'visitas', n, 'visitantes', u) order by n desc), '[]'::jsonb)
    from (select pag, count(*) n, count(distinct vid) u from todas, ref where todas.dia > ref.hoje - 30
          group by pag) p
  )
);
$$;

revoke all on function public.resumo_visitas(text) from public, anon;
grant execute on function public.resumo_visitas(text) to authenticated;
revoke all on function public.visita_pagina(text) from public, anon;
grant execute on function public.visita_pagina(text) to authenticated;
revoke all on function public.lead_pagina(text, text, text) from public, anon;
grant execute on function public.lead_pagina(text, text, text) to authenticated;

notify pgrst, 'reload schema';
