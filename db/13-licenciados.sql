-- =========================================================
-- A NOVA PROFISSÃO — espelhos para licenciados (anovaprofissao.com.br/<slug>)
--
-- 1) leads.licenciado: de qual espelho o lead veio. Só aceita um slug que
--    exista em licenciados (chave estrangeira), então ninguém forja destino.
-- 2) licenciados: quem recebe os avisos do espelho (WhatsApp e e-mail). O
--    e-mail não vai para o site público; fica só aqui. Só o painel (login) lê.
-- 3) contador: visitas e leads dos espelhos viram a página 'licenciados'.
--
-- Cole INTEIRO no SQL Editor do Supabase e rode.
-- Pode ser executado mais de uma vez sem efeito colateral.
-- =========================================================

create table if not exists public.licenciados (
  slug       text primary key check (slug ~ '^[a-z0-9-]{3,40}$'),
  nome       text not null,
  whatsapp   text check (whatsapp is null or whatsapp ~ '^[0-9]{12,13}$'),
  email      text,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

alter table public.licenciados enable row level security;
drop policy if exists "painel le licenciados"    on public.licenciados;
drop policy if exists "painel edita licenciados" on public.licenciados;
create policy "painel le licenciados"    on public.licenciados for select to authenticated using (true);
create policy "painel edita licenciados" on public.licenciados for all    to authenticated using (true) with check (true);
revoke all on public.licenciados from anon;
grant select, insert, update, delete on public.licenciados to authenticated;

insert into public.licenciados (slug, nome, whatsapp, email)
values ('mariogomes', 'Mario Henrique Gomes da Silva', '5513981602345', 'mhenrike2003@yahoo.com.br')
on conflict (slug) do update
  set nome = excluded.nome, whatsapp = excluded.whatsapp, email = excluded.email, ativo = true;

alter table public.leads
  add column if not exists licenciado text
  references public.licenciados (slug) on update cascade on delete set null;
create index if not exists leads_licenciado_idx on public.leads (licenciado);
grant insert (licenciado) on public.leads to anon;
grant select (licenciado) on public.leads to authenticated;

-- visitas: o espelho grava landing "/<slug>" (ou "/<slug>/...")
create or replace function public.visita_pagina(landing text)
returns text language sql stable set search_path = public as $$
  select case
    when landing ilike '%transicaoenergetica%' or landing ilike '%/transicao-energetica%' then 'transicao'
    when landing ilike '%querovendercarregador%' or landing ilike '%/integradores%' then 'integradores'
    when exists (select 1 from licenciados l
                 where landing = '/' || l.slug or landing like '/' || l.slug || '/%') then 'licenciados'
    else 'home' end
$$;

create or replace function public.lead_pagina(tipo text, solucao text, utm_source text, licenciado text)
returns text language sql immutable as $$
  select case
    when licenciado is not null then 'licenciados'
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
    and (pagina is null or lead_pagina(tipo, solucao, utm_source, licenciado) = pagina)
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


drop function if exists public.lead_pagina(text, text, text);

revoke all on function public.resumo_visitas(text) from public, anon;
grant execute on function public.resumo_visitas(text) to authenticated;
revoke all on function public.visita_pagina(text) from public, anon;
grant execute on function public.visita_pagina(text) to authenticated;
revoke all on function public.lead_pagina(text, text, text, text) from public, anon;
grant execute on function public.lead_pagina(text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
